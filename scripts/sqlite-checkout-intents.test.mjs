import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDraftOrder } from '../server/order-domain.mjs';
import { createSQLiteCheckoutIntents } from '../server/sqlite-checkout-intents.mjs';
import { createYooKassaCheckout } from '../server/yookassa-checkout.mjs';

const draft=()=>createDraftOrder({
  orderId:'order_12345678',birthDate:'1989-08-23',nowIso:'2026-11-23T10:00:00Z'
});
const paymentId='2855940e-000f-5000-8000-abcdef123456';
function creator(transport){
  return createYooKassaCheckout({
    shopId:'123456',secretKey:'fake-secret-for-offline-tests',
    returnUrl:'https://example.org/payment/return',transport
  });
}

test('SQLite persists the SAME idempotency key through restart and only one checkout result', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-intent-test-'));
  const file=join(dir,'intent.sqlite');
  let a,b;
  try{
    a=createSQLiteCheckoutIntents({filePath:file});
    b=createSQLiteCheckoutIntents({filePath:file});
    const first=await a.getOrCreate(draft());
    const second=await b.getOrCreate(draft());
    assert.equal(first.status,'started');
    assert.match(first.idempotencyKey,/^[a-f0-9-]{36}$/);
    assert.equal(second.idempotencyKey,first.idempotencyKey);
    const recordedHeaders=[];
    const transport=async(uri,opts)=>{
      assert.equal(uri,'https://api.yookassa.ru/v3/payments');
      recordedHeaders.push(opts.headers['Idempotence-Key']);
      return {ok:true,status:200,json:async()=>({
        id:paymentId,status:'pending',paid:false,
        amount:{value:'550.00',currency:'RUB'},
        metadata:{order_id:'order_12345678'},
        confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/pay/demo'}
      })};
    };
    const api=creator(transport);
    // Reusing the durable key protects an ambiguous network retry from
    // creating a second payment.
    const networkResponse=await api.createPayment(draft(),first.idempotencyKey);
    const sameResult=await api.createPayment(draft(),second.idempotencyKey);
    assert.deepEqual(networkResponse,sameResult);
    assert.deepEqual(recordedHeaders,[first.idempotencyKey,first.idempotencyKey]);
    const stored=await a.markCreated(first.orderId,first.idempotencyKey,networkResponse);
    assert.equal(stored.status,'created');
    assert.equal(stored.paymentId,paymentId);
    assert.deepEqual(await b.markCreated(first.orderId,first.idempotencyKey,sameResult),stored);
    await assert.rejects(a.markCreated(first.orderId,'8ea8ae37-aaaa-4dad-bbbb-111111111111',networkResponse),/mismatch/);
    a.close();a=null;b.close();b=null;
    a=createSQLiteCheckoutIntents({filePath:file});
    const resumed=await a.getOrCreate(draft());
    assert.equal(resumed.paymentId,paymentId);
    assert.equal(resumed.idempotencyKey,first.idempotencyKey);
  }finally{
    if(a)a.close();
    if(b)b.close();
    await rm(dir,{recursive:true,force:true});
  }
});

test('Intents reject forged amounts, wrong order IDs and different payment on retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-intent-bad-'));
  const store=createSQLiteCheckoutIntents({filePath:join(dir,'intent.sqlite')});
  try{
    const doc=draft();
    await assert.rejects(store.getOrCreate({...doc,amountMinor:1}),/Trusted draft/);
    await assert.rejects(store.getOrCreate({...doc,status:'paid'}),/Trusted draft/);
    const intent=await store.getOrCreate(doc);
    const good={
      orderId:doc.orderId,
      paymentId,
      status:'payment_pending',
      confirmationUrl:'https://yoomoney.ru/pay/demo'
    };
    await assert.rejects(store.markCreated(doc.orderId,intent.idempotencyKey,{...good,orderId:'other_order'}),/Unexpected/);
    await assert.rejects(store.markCreated(doc.orderId,intent.idempotencyKey,{...good,confirmationUrl:'http://evil.org/'}),/Invalid/);
    assert.equal((await store.get(doc.orderId)).status,'started');
    await store.markCreated(doc.orderId,intent.idempotencyKey,good);
    await assert.rejects(store.markCreated(doc.orderId,intent.idempotencyKey,{...good,paymentId:'other_payment'}),/Conflicting/);
    assert.equal((await store.get(doc.orderId)).paymentId,paymentId);
  }finally{store.close();await rm(dir,{recursive:true,force:true});}
});
