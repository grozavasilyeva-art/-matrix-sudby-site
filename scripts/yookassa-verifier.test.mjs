import test from 'node:test';
import assert from 'node:assert/strict';
import { createYooKassaVerifier } from '../server/yookassa-verifier.mjs';

const ID='2855940e-000f-5000-9000-1ef78d597562';
const SHOP='123456';
const KEY='test-only-key-not-valid';
const succeeded={
  id:ID,status:'succeeded',paid:true,amount:{value:'550.00',currency:'RUB'},
  metadata:{order_id:'order_12345678'}
};

test('GET payment with Basic Auth uses the exact official endpoint and does not modify anything',async()=>{
  let calls=0;
  const verifier=createYooKassaVerifier({
    shopId:SHOP,secretKey:KEY,
    transport:async(url,opts)=>{
      calls++;
      assert.equal(url,'https://api.yookassa.ru/v3/payments/'+ID);
      assert.equal(opts.method,'GET');
      assert.equal(opts.redirect,'error');
      assert.equal(opts.cache,'no-store');
      assert.equal(opts.headers.Accept,'application/json');
      assert.equal(Buffer.from(opts.headers.Authorization.slice(6),'base64').toString(),SHOP+':'+KEY);
      assert.ok(opts.signal);
      return {status:200,ok:true,json:async()=>succeeded};
    }
  });
  assert.deepEqual(await verifier.getPayment(ID),succeeded);
  assert.equal(calls,1);
});

test('invalid payment identifiers cannot trigger provider calls',async()=>{
  let calls=0;
  const verifier=createYooKassaVerifier({
    shopId:SHOP,secretKey:KEY,
    transport:async()=>{calls++;throw Error('Unexpected');}
  });
  for(const id of ['', 'x', '../payments', 'abc?token=value', 'too many spaces', null]) {
    await assert.rejects(verifier.getPayment(id),/Invalid/);
  }
  assert.equal(calls,0);
});

test('provider HTTP and response errors are safe and never expose credentials',async()=>{
  for(const transport of [
    async()=>({status:401,ok:false}),
    async()=>({status:200,ok:true,json:async()=>{throw Error('secret from provider');}}),
    async()=>({status:200,ok:true,json:async()=>({...succeeded,id:'other-payment'})}),
    async()=>{throw Error('network failure includes '+KEY);}
  ]){
    const verifier=createYooKassaVerifier({shopId:SHOP,secretKey:KEY,transport});
    await assert.rejects(verifier.getPayment(ID),err=>{
      assert.equal(err.message.includes(KEY),false);
      return true;
    });
  }
});

test('YooKassa credentials and transport must be injected explicitly',()=>{
  assert.throws(()=>createYooKassaVerifier({shopId:'',secretKey:KEY}),/shop ID/);
  assert.throws(()=>createYooKassaVerifier({shopId:SHOP,secretKey:''}),/secret/);
  assert.throws(()=>createYooKassaVerifier({shopId:SHOP,secretKey:KEY,transport:null}),/transport/);
});
