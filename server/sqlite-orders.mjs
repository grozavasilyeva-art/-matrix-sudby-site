/**
 * Persistent SQLite order adapter for a single Node.js host.
 * No cloud requests, bank credentials, or private PDF content.
 * node:sqlite in Node 22 is experimental; not yet a deployed multi-host database.
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PRODUCT, normalizeBirthDate, canIssueReport } from './order-domain.mjs';

const ID=/^[a-zA-Z0-9_-]{8,96}$/;
const PAYMENT=/^[a-zA-Z0-9_-]{4,128}$/;
const SHA256=/^[a-f0-9]{64}$/;
function validateId(id) {
  if (typeof id!=='string'||!ID.test(id)) throw new Error('Invalid order ID');
}
function fromRow(r) {
  return r ? {
    orderId:r.order_id,birthDate:r.birth_date,product:r.product,
    amountMinor:r.amount_minor,currency:r.currency,status:r.status,
    paymentId:r.payment_id,createdAt:r.created_at,tokenHash:r.token_hash,
    reportState:r.report_state,privateObjectKey:r.private_object_key
  } : null;
}

export function createSQLiteOrders({filePath,now=Date.now,leaseMs=120000}={}) {
  if (typeof filePath!=='string'||!filePath.trim()||filePath===':memory:')
    throw new TypeError('A persistent file path is required');
  if (typeof now!=='function') throw new TypeError('Clock must be callable');
  if (!Number.isInteger(leaseMs)||leaseMs<1000||leaseMs>3600000)
    throw new RangeError('Invalid report lease');
  const filename=resolve(filePath);
  mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  try {
    db.exec('PRAGMA busy_timeout=5000');
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA synchronous=FULL');
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if (version!==0 && version!==1) throw new Error('Unsupported SQLite schema version');
    db.exec(
      'CREATE TABLE IF NOT EXISTS orders ('+
      'order_id TEXT PRIMARY KEY,birth_date TEXT NOT NULL,'+
      'product TEXT NOT NULL,amount_minor INTEGER NOT NULL CHECK(amount_minor=55000),'+
      "currency TEXT NOT NULL CHECK(currency='RUB'),"+
      "status TEXT NOT NULL CHECK(status IN ('payment_pending','paid','refunded','cancelled')),"+
      'payment_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL,token_hash TEXT,'+
      "report_state TEXT NOT NULL DEFAULT 'new' CHECK(report_state IN ('new','processing','failed','ready')),"+
      'claim_token TEXT,claim_until INTEGER NOT NULL DEFAULT 0,private_object_key TEXT);'+
      'CREATE INDEX IF NOT EXISTS orders_report_state_idx ON orders(report_state,status);'
    );
    if (version===0) db.exec('PRAGMA user_version=1');
    chmodSync(filename,0o600);
  } catch(e) {db.close();throw e;}

  const lookup=db.prepare('SELECT * FROM orders WHERE order_id=?');
  const insert=db.prepare(
    'INSERT INTO orders(order_id,birth_date,product,amount_minor,currency,status,payment_id,created_at,token_hash) '+
    'VALUES(?,?,?,?,?,?,?,?,?)');
  const paid=db.prepare("UPDATE orders SET status='paid' WHERE order_id=? AND payment_id=? AND status='payment_pending'");
  const claim=db.prepare("UPDATE orders SET report_state='processing',claim_token=?,claim_until=?,private_object_key=NULL "+
    "WHERE order_id=? AND status='paid'");
  const finish=db.prepare("UPDATE orders SET report_state='ready',private_object_key=?,claim_token=NULL,claim_until=0 "+
    "WHERE order_id=? AND status='paid' AND report_state='processing' AND claim_token=? AND claim_until>=?");
  const fail=db.prepare("UPDATE orders SET report_state='failed',claim_token=NULL,claim_until=0 "+
    "WHERE order_id=? AND report_state='processing' AND claim_token=?");

  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try {const result=fn();db.exec('COMMIT');return result;}
    catch(e) {db.exec('ROLLBACK');throw e;}
  }
  const read=id=>lookup.get(id);
  const api={
    async create(record) {
      if (!record||record.status!=='payment_pending'||record.product!==PRODUCT.sku||
          record.amountMinor!==PRODUCT.priceMinor||record.currency!==PRODUCT.currency||
          typeof record.createdAt!=='string'||!Number.isFinite(Date.parse(record.createdAt)))
        throw new Error('Invalid trusted order');
      validateId(record.orderId);
      normalizeBirthDate(record.birthDate);
      if(typeof record.paymentId!=='string'||!PAYMENT.test(record.paymentId))
        throw new Error('Invalid payment ID');
      const tokenHash=record.tokenHash??null;
      if(tokenHash!==null&&(typeof tokenHash!=='string'||!SHA256.test(tokenHash)))
        throw new Error('Invalid token digest');
      transaction(()=>insert.run(record.orderId,record.birthDate,record.product,
        record.amountMinor,record.currency,record.status,record.paymentId,record.createdAt,tokenHash));
      return record.orderId;
    },
    async get(id) {
      validateId(id);
      return fromRow(read(id));
    },
    async saveVerifiedPayment(verified) {
      if(!canIssueReport(verified))throw new Error('Payment not verified');
      validateId(verified.orderId);
      transaction(()=>{
        const row=read(verified.orderId);
        if(!row||row.payment_id!==verified.paymentId||row.amount_minor!==PRODUCT.priceMinor||
           row.currency!==PRODUCT.currency||row.product!==PRODUCT.sku||
           !['payment_pending','paid'].includes(row.status))
          throw new Error('Payment belongs to another order');
        if(row.status==='payment_pending' && paid.run(verified.orderId,verified.paymentId).changes!==1)
          throw new Error('Could not persist payment');
      });
    },
    async claimReport(id) {
      validateId(id);
      return transaction(()=>{
        const row=read(id);
        if(!row||row.status!=='paid')throw new Error('Order not paid');
        if(row.report_state==='ready')return {state:'ready'};
        const t=now();
        if(!Number.isSafeInteger(t))throw new Error('Invalid clock');
        if(row.report_state==='processing'&&row.claim_until>t)return {state:'busy'};
        const token=randomUUID();
        if(claim.run(token,t+leaseMs,id).changes!==1)throw new Error('Could not claim report');
        return {state:'claimed',token};
      });
    },
    async finishReport(id,token,key) {
      validateId(id);
      if(typeof token!=='string'||!token)throw new Error('Invalid claim token');
      if(key!=='reports/'+id+'.pdf')throw new Error('Invalid private object key');
      const t=now();
      if(!Number.isSafeInteger(t))throw new Error('Invalid clock');
      transaction(()=>{
        if(finish.run(key,id,token,t).changes!==1)throw new Error('Claim expired or was superseded');
      });
    },
    async failReport(id,token) {
      validateId(id);
      if(typeof token!=='string'||!token)return false;
      return transaction(()=>fail.run(id,token).changes===1);
    },
    close() {db.close();}
  };
  return Object.freeze(api);
}
