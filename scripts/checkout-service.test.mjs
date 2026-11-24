import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createSQLiteOrders} from '../server/sqlite-orders.mjs';
import {createCheckoutService} from '../server/checkout-service.mjs';
import {createPaymentNotificationHandler} from '../server/payment-notifications.mjs';
import {createFulfillment} from '../server/fulfillment.mjs';

const paymentId='test_payment_12345678';
const configurationId='test-merchant/https://example.org/return/v1';
const event={type:'notification',event:'payment.succeeded',object:{id:paymentId,paid:true}};
const result=order=>({orderId:order.orderId,paymentId,status:'payment_pending',confirmationUrl:'https://yoomoney.ru/test-payment'});
async function fixture(fn){
  const dir=await mkdtemp(join(tmpdir(),'matrix-checkout-'));
  try{await fn(join(dir,'orders.sqlite'));}finally{await rm(dir,{recursive:true,force:true});}
}

test('durable checkout survives ambiguous provider response and restart with the same key',async()=>{
  await fixture(async file=>{
    const keys=[];let db=createSQLiteOrders({filePath:file});let fail=true;
    const checkout={async createPayment(order,key){keys.push(key);if(fail)throw Error('network lost');return result(order);}};
    try{
      let service=createCheckoutService({orders:db,checkout,configurationId});
      const draft=await service.reserve('2000-02-29');
      assert.equal(draft.amount,'550.00');
      assert.equal(await db.get(draft.orderId),null);
      await assert.rejects(service.start(draft.orderId,'x'.repeat(43)),/Unauthorized/);
      assert.equal(keys.length,0);
      await assert.rejects(service.start(draft.orderId,draft.accessToken),/network lost/);
      const saved=await db.getCheckout(draft.orderId);
      assert.equal(saved.status,'draft');
      db.close();db=createSQLiteOrders({filePath:file});
      fail=false;
      service=createCheckoutService({orders:db,checkout,configurationId});
      const completed=await service.start(draft.orderId,draft.accessToken);
      assert.equal(completed.status,'payment_pending');
      assert.deepEqual(keys,[saved.idempotencyKey,saved.idempotencyKey]);
      assert.equal((await db.get(draft.orderId)).paymentId,paymentId);
      assert.equal((await db.getByPaymentId(paymentId)).birthDate,'2000-02-29');
      assert.deepEqual(await service.start(draft.orderId,draft.accessToken),completed);
      assert.equal(keys.length,2);
    }finally{db.close();}
  });
});

test('expired retries and changed merchant configuration cannot call provider',async()=>{
  await fixture(async file=>{
    let clock=1000000,calls=0;
    const now=()=>clock;
    const db=createSQLiteOrders({filePath:file,now});
    try{
      const checkout={async createPayment(o){calls++;return result(o);}};
      const service=createCheckoutService({orders:db,checkout,configurationId,now});
      const d=await service.reserve('2001-01-01');
      const changed=createCheckoutService({orders:db,checkout,configurationId:configurationId+'/changed',now});
      await assert.rejects(changed.start(d.orderId,d.accessToken),/configuration changed/);
      clock+=23*60*60*1000;
      await assert.rejects(service.start(d.orderId,d.accessToken),/retry window expired/);
      assert.equal(calls,0);
    }finally{db.close();}
  });
});

test('notification cannot unlock a PDF until separate payment verification; repeated event is safe',async()=>{
  await fixture(async file=>{
    const db=createSQLiteOrders({filePath:file});
    try{
      const service=createCheckoutService({orders:db,checkout:{async createPayment(o){return result(o);}},configurationId});
      const draft=await service.reserve('2000-02-29');
      await service.start(draft.orderId,draft.accessToken);
      let paid=false,renders=0,lookups=0;
      const fulfillment=createFulfillment({
        orders:db,
        provider:{async getPayment(id){lookups++;return {
          id,paid,status:paid?'succeeded':'pending',amount:{value:'550.00',currency:'RUB'},
          metadata:{order_id:draft.orderId}
        };}},
        renderer:{async render(){renders++;return new TextEncoder().encode('%PDF-'+ 'x'.repeat(800));}},
        storage:{async putPrivate(){},async signPrivateGet(){return 'https://example.invalid/private';}},
        authorize:{async assertAccess(){}}
      });
      const handler=createPaymentNotificationHandler({orders:db,fulfillment});
      assert.equal((await handler.handle({...event,object:{id:'unknown_payment'}})).status,503);
      assert.equal(lookups,0);
      assert.equal((await handler.handle(event)).status,503);
      assert.equal(renders,0);
      assert.equal((await db.get(draft.orderId)).status,'payment_pending');
      paid=true;
      assert.deepEqual(await handler.handle(event),{status:200,state:'ready'});
      assert.equal(renders,1);
      assert.equal((await db.get(draft.orderId)).reportState,'ready');
      assert.equal((await handler.handle(event)).status,200);
      assert.equal(renders,1);
      assert.equal(lookups,2);
      assert.equal((await service.start(draft.orderId,draft.accessToken)).confirmationUrl,null);
    }finally{db.close();}
  });
});
