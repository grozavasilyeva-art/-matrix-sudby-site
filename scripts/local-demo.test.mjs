import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDemo } from '../dev/local-demo.mjs';

const json={'content-type':'application/json'};
async function request(url, path, method='GET', token=null, body=null, extra={}) {
  const headers={...extra};
  if(token) headers.authorization='Bearer '+token;
  if(body!==null) headers['content-type']='application/json';
  const response=await fetch(url+path,{
    method,headers,body:body!==null?JSON.stringify(body):undefined,redirect:'manual'
  });
  let data=null;
  if((response.headers.get('content-type')||'').includes('json')) data=await response.json();
  return {response,data};
}

test('LOCAL ONLY: mock order, fake payment, PDF, auth, restart', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-http-test-'));
  let app=await createLocalDemo({dataDir:dir});
  try {
    let url=await app.listen();
    const health=await request(url,'/health');
    assert.equal(health.response.status,200);
    assert.equal(health.data.payments,'simulated');
    const invalid=await request(url,'/api/orders','POST',null,{birthDate:'2025-02-29'});
    assert.equal(invalid.response.status,400);
    const created=await request(url,'/api/orders','POST',null,{birthDate:'1989-08-23',amount:'0.01'});
    assert.equal(created.response.status,201);
    const {orderId,accessToken}=created.data;
    assert.match(orderId,/^order_[a-z0-9]{32}$/);
    assert.match(accessToken,/^[A-Za-z0-9_-]{32,}$/);
    assert.equal(created.data.amount,'550.00');
    assert.equal(created.data.testOnly,true);

    let x=await request(url,'/api/orders/'+orderId);
    assert.equal(x.response.status,401);
    x=await request(url,'/api/orders/'+orderId,'GET','totallyinvalidtoken01234567890123456789');
    assert.equal(x.response.status,401);
    x=await request(url,'/api/orders/'+orderId,'GET',accessToken);
    assert.equal(x.data.status,'payment_pending');

    x=await request(url,'/api/orders/'+orderId+'/report','GET',accessToken);
    assert.equal(x.response.status,409); // no paid report before confirmation

    x=await request(url,'/api/dev/orders/'+orderId+'/confirm','POST',accessToken,{});
    assert.equal(x.response.status,404); // explicit local acknowledgement required

    x=await request(url,'/api/dev/orders/'+orderId+'/confirm','POST',accessToken,{}, {'x-local-demo':'acknowledge-fake-payment'});
    assert.equal(x.response.status,200);
    assert.equal(x.data.state,'ready');
    x=await request(url,'/api/orders/'+orderId+'/report','GET',accessToken);
    assert.equal(x.response.status,200);
    assert.equal(x.response.headers.get('content-type'),'application/pdf');
    const file=Buffer.from(await x.response.arrayBuffer());
    assert.equal(file.subarray(0,5).toString(),'%PDF-');
    assert.ok(file.includes(Buffer.from('%%EOF')));
    x=await request(url,'/api/dev/orders/'+orderId+'/confirm','POST',accessToken,{}, {'x-local-demo':'acknowledge-fake-payment'});
    assert.equal(x.response.status,200); // second event is idempotent

    // Browser from an unrelated origin is never permitted to use the API.
    x=await request(url,'/api/orders','POST',null,{birthDate:'2000-02-29'},{origin:'https://example.org'});
    assert.equal(x.response.status,403);

    await app.close();
    app=null;
    app=await createLocalDemo({dataDir:dir});
    url=await app.listen();
    x=await request(url,'/api/orders/'+orderId,'GET',accessToken);
    assert.equal(x.response.status,200);
    assert.equal(x.data.reportState,'ready');
    x=await request(url,'/api/orders/'+orderId+'/report','GET',accessToken);
    assert.equal(x.response.status,200);
  }finally {
    if(app)await app.close();
    await rm(dir,{recursive:true,force:true});
  }
});

test('Local demo cannot be created in production mode', async()=>{
  const original=process.env.NODE_ENV;
  process.env.NODE_ENV='production';
  try{
    await assert.rejects(createLocalDemo({dataDir:'/tmp/matrix-dev-never-create'}),/blocked in production/);
  }finally{
    if(original===undefined)delete process.env.NODE_ENV;
    else process.env.NODE_ENV=original;
  }
});
