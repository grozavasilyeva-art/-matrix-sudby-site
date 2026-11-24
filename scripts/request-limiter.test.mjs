import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createFixedWindowLimiter } from '../server/request-limiter.mjs';
import { createLocalDemo } from '../dev/local-demo.mjs';

test('fixed window guard blocks excess requests and renews after expiration',()=>{
  let t=10000;
  const limiter=createFixedWindowLimiter({limit:2,windowMs:1000,now:()=>t});
  assert.deepEqual(limiter.check('client-A'),{allowed:true,remaining:1});
  assert.deepEqual(limiter.check('client-A'),{allowed:true,remaining:0});
  assert.deepEqual(limiter.check('client-A'),{allowed:false,retryAfterSeconds:1});
  assert.deepEqual(limiter.check('client-B'),{allowed:true,remaining:1});
  t=11000;
  assert.deepEqual(limiter.check('client-A'),{allowed:true,remaining:1});
});

test('local checkout refuses bot-like order floods but preserves healthy order read',async()=>{
  const dataDir=await mkdtemp(join(tmpdir(),'matrix-guard-test-'));
  let server;
  try {
    server=await createLocalDemo({dataDir,ordersPerMinute:2});
    const url=await server.listen();
    async function createOrder(){
      const res=await fetch(url+'/api/orders',{
        method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({birthDate:'1989-08-23'})
      });
      return {res,data:await res.json()};
    }
    const one=await createOrder();
    const two=await createOrder();
    const three=await createOrder();
    assert.equal(one.res.status,201);
    assert.equal(two.res.status,201);
    assert.equal(three.res.status,429);
    const retry=Number(three.res.headers.get('Retry-After'));
    assert.ok(retry>=1 && retry<=60);
    const health=await fetch(url+'/health');
    assert.equal(health.status,200);
    const own=await fetch(url+'/api/orders/'+one.data.orderId,{
      headers:{Authorization:'Bearer '+one.data.accessToken}
    });
    assert.equal(own.status,200);
  }finally{
    if(server)await server.close();
    await rm(dataDir,{recursive:true,force:true});
  }
});

test('invalid rate configurations are rejected',()=>{
  for(const limit of [0,-1,1.5,100001])assert.throws(()=>createFixedWindowLimiter({limit}));
  assert.throws(()=>createFixedWindowLimiter({windowMs:999}));
});
