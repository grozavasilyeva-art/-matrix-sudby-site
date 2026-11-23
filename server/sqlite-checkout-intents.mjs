/**
 * Durable checkout-intent store for a single Node host.
 * Stores the IDEMPOTENCE KEY BEFORE requesting a payment from YooKassa.
 * NOT a payment provider, HTTP route, or proof of payment.
 *
 * On a multi-instance/serverless deployment use a shared transactional DB.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRODUCT } from './order-domain.mjs';

const ORDER_ID=/^[A-Za-z0-9_-]{8,96}$/;
const UUID=/^[a-f0-9-]{36}$/i;
function assertOrder(order) {
  if(!order || typeof order.orderId!=='string' || !ORDER_ID.test(order.orderId) ||
     order.status!=='draft' || order.paymentId!==null ||
     order.product!==PRODUCT.sku || order.amountMinor!==PRODUCT.priceMinor ||
     order.currency!==PRODUCT.currency) {
    throw new Error('Trusted draft required to create payment intent');
  }
}
function checkId(id) {
  if(typeof id!=='string'||!ORDER_ID.test(id))throw new Error('Invalid order ID');
}
function toIntent(row) {
  return row?Object.freeze({
    orderId:row.order_id,
    idempotencyKey:row.idempotency_key,
    status:row.status,
    paymentId:row.payment_id,
    confirmationUrl:row.confirmation_url
  }):null;
}
export function createSQLiteCheckoutIntents({filePath}={}) {
  if(typeof filePath!=='string'||!filePath.trim()||filePath===':memory:')
    throw new TypeError('Persistent checkout-intent database required');
  const file=resolve(filePath);
  mkdirSync(dirname(file),{recursive:true,mode:0o700});
  const db=new DatabaseSync(file);
  try {
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=FULL');
    db.exec('PRAGMA busy_timeout=5000');
    db.exec(
      "CREATE TABLE IF NOT EXISTS checkout_intents ("+
      "order_id TEXT PRIMARY KEY,"+
      "idempotency_key TEXT NOT NULL UNIQUE,"+
      "status TEXT NOT NULL CHECK(status IN ('started','created')),"+
      "payment_id TEXT UNIQUE,"+
      "confirmation_url TEXT,"+
      "CHECK ((status='started' AND payment_id IS NULL AND confirmation_url IS NULL) OR "+
      "(status='created' AND payment_id IS NOT NULL AND confirmation_url IS NOT NULL))"+
      ")"
    );
    chmodSync(file,0o600);
  }catch(e){db.close();throw e;}
  const lookup=db.prepare('SELECT * FROM checkout_intents WHERE order_id=?');
  const insert=db.prepare(
    "INSERT INTO checkout_intents(order_id,idempotency_key,status) VALUES(?,?,'started')");
  const finish=db.prepare(
    "UPDATE checkout_intents SET status='created',payment_id=?,confirmation_url=? "+
    "WHERE order_id=? AND idempotency_key=? AND status='started'");
  function txn(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const result=fn();db.exec('COMMIT');return result;}
    catch(e){db.exec('ROLLBACK');throw e;}
  }
  const api={
    async get(orderId) {
      checkId(orderId);
      return toIntent(lookup.get(orderId));
    },
    async getOrCreate(trustedDraft) {
      assertOrder(trustedDraft);
      return txn(()=>{
        const existing=lookup.get(trustedDraft.orderId);
        if(existing) return toIntent(existing);
        const key=randomUUID();
        if(!UUID.test(key))throw new Error('Invalid generated key');
        insert.run(trustedDraft.orderId,key);
        return toIntent(lookup.get(trustedDraft.orderId));
      });
    },
    async markCreated(orderId,idempotencyKey,checkoutResult) {
      checkId(orderId);
      if(typeof idempotencyKey!=='string'||!UUID.test(idempotencyKey))
        throw new Error('Invalid stored idempotency key');
      if(!checkoutResult || checkoutResult.orderId!==orderId ||
         checkoutResult.status!=='payment_pending' ||
         typeof checkoutResult.paymentId!=='string' ||
         !/^[a-zA-Z0-9_-]{4,128}$/.test(checkoutResult.paymentId))
        throw new Error('Unexpected provider checkout result');
      let uri;
      try {uri=new URL(checkoutResult.confirmationUrl);}
      catch {throw new Error('Invalid provider confirmation URL');}
      if(uri.protocol!=='https:'||!uri.hostname||uri.username||uri.password||uri.port||uri.hash)
        throw new Error('Invalid provider confirmation URL');
      return txn(()=>{
        const existing=lookup.get(orderId);
        if(!existing || existing.idempotency_key!==idempotencyKey)
          throw new Error('Checkout intent mismatch');
        if(existing.status==='created') {
          if(existing.payment_id!==checkoutResult.paymentId ||
             existing.confirmation_url!==uri.href)
            throw new Error('Conflicting payment result');
          return toIntent(existing);
        }
        if(finish.run(checkoutResult.paymentId,uri.href,orderId,idempotencyKey).changes!==1)
          throw new Error('Failed to persist provider payment ID');
        return toIntent(lookup.get(orderId));
      });
    },
    close(){db.close();}
  };
  return Object.freeze(api);
}
