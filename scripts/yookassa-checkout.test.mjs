import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftOrder, markPaymentCreated } from '../server/order-domain.mjs';
import { createYooKassaCheckout } from '../server/yookassa-checkout.mjs';

const SHOP='123456';
const SECRET='example-nonworking-test-secret';
const RETURN='https://example.org/payment/return';
const PAYMENT='2a9f0bc5-000f-5000-8000-12345acdef12';
const order=()=>createDraftOrder({
  orderId:'order_12345678',birthDate:'1989-08-23',nowIso:'2026-11-23T10:00:00Z'
});
const providerResponse=()=>({
  id:PAYMENT,status:'pending',paid:false,
  amount:{value:'550.00',currency:'RUB'},
  metadata:{order_id:'order_12345678'},
  confirmation:{type:'redirect',confirmation_url:'https://yoomoney.ru/checkout/1234'}
});

test('Checkout requests EXACTLY 550 RUB and redirects without trusting browser-supplied price',async()=>{
  let calls=0;
  const transport=async(uri,options)=>{
    calls++;
    assert.equal(uri,'https://api.yookassa.ru/v3/payments');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.cache,'no-store');
    assert.equal(options.headers['Idempotence-Key'],'server_saved_uuid_12345678');
    assert.equal(Buffer.from(options.headers.Authorization.slice(6),'base64').toString(),SHOP+':'+SECRET);
    const payload=JSON.parse(options.body);
    assert.deepEqual(payload.amount,{value:'550.00',currency:'RUB'});
    assert.equal(payload.capture,true);
    assert.deepEqual(payload.confirmation,{type:'redirect',return_url:RETURN});
    assert.deepEqual(payload.metadata,{order_id:'order_12345678'});
    assert.equal(JSON.stringify(payload).includes('1989-08-23'),false);
    return {ok:true,status:200,json:async()=>providerResponse()};
  };
  const creator=createYooKassaCheckout({shopId:SHOP,secretKey:SECRET,returnUrl:RETURN,transport});
  const draft={...order(), amountMinor:55000};
  const result=await creator.createPayment(draft,'server_saved_uuid_12345678');
  assert.equal(calls,1);
  assert.deepEqual(result,{
    paymentId:PAYMENT,
    orderId:'order_12345678',
    status:'payment_pending',
    confirmationUrl:'https://yoomoney.ru/checkout/1234'
  });
  assert.ok(Object.isFrozen(result));
  assert.equal(JSON.stringify(result).includes(SECRET),false);
});

test('Checkout rejects client-price changes, linked orders, and invalid idempotency keys BEFORE network',async()=>{
  let calls=0;
  const creator=createYooKassaCheckout({
    shopId:SHOP,secretKey:SECRET,returnUrl:RETURN,
    transport:async()=>{calls++;throw Error('Must not be called');}
  });
  const good=order();
  const invalidOrders=[
    {...good,amountMinor:1},
    {...good,currency:'USD'},
    {...good,product:'unknown'},
    {...good,orderId:'../../secret'},
    {...good,status:'paid'},
    markPaymentCreated(good,PAYMENT),
    {...good,paymentId:'already-linked'}
  ];
  for(const data of invalidOrders)await assert.rejects(creator.createPayment(data,'server_saved_uuid_12345678'));
  for(const key of ['', 'x', '../../path', 'contains spaces', 'x'.repeat(65)]) {
    await assert.rejects(creator.createPayment(good,key),/idempotency/);
  }
  assert.equal(calls,0);
});

test('Provider cannot return a mismatched, overcharged or unsafe redirect',async()=>{
  for(const changed of [
    {id:'bad'},
    {status:'succeeded'},
    {paid:true},
    {amount:{value:'1.00',currency:'RUB'}},
    {amount:{value:'550.00',currency:'USD'}},
    {metadata:{order_id:'different-order'}},
    {confirmation:{type:'redirect',confirmation_url:'http://attacker.test/pay'}},
    {confirmation:{type:'redirect',confirmation_url:'https://user:pass@evil.test/pay'}},
    {confirmation:{type:'redirect',confirmation_url:'https://evil.test:444/pay'}}
  ]){
    const payload={...providerResponse(),...changed};
    const creator=createYooKassaCheckout({
      shopId:SHOP,secretKey:SECRET,returnUrl:RETURN,
      transport:async()=>({ok:true,status:200,json:async()=>payload})
    });
    await assert.rejects(creator.createPayment(order(),'server_saved_uuid_12345678'));
  }
});

test('Checkout safely handles network, HTTP and malformed responses without leaking API secret',async()=>{
  const transports=[
    async()=>{throw Error('SECRET: '+SECRET);},
    async()=>({ok:false,status:403}),
    async()=>({ok:true,status:201,json:async()=>providerResponse()}),
    async()=>({ok:true,status:200,json:async()=>{throw Error(SECRET);}})
  ];
  for(const transport of transports){
    const creator=createYooKassaCheckout({shopId:SHOP,secretKey:SECRET,returnUrl:RETURN,transport});
    await assert.rejects(creator.createPayment(order(),'server_saved_uuid_12345678'),error=>{
      assert.equal(error.message.includes(SECRET),false);
      return true;
    });
  }
});

test('Refuses arbitrary callback URLs and missing credentials',()=>{
  for(const invalidUrl of [
    'http://example.org/return','http://127.0.0.1/return',
    'https://user:pass@example.org/callback',
    'https://example.org:8443/return',
    'javascript:alert(1)'
  ])assert.throws(()=>createYooKassaCheckout({shopId:SHOP,secretKey:SECRET,returnUrl:invalidUrl,transport:async()=>{}}));
  assert.throws(()=>createYooKassaCheckout({shopId:'',secretKey:SECRET,returnUrl:RETURN}),/shop ID/);
  assert.throws(()=>createYooKassaCheckout({shopId:SHOP,secretKey:'',returnUrl:RETURN}),/secret/);
});
