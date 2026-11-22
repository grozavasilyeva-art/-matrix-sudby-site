/**
 * Optional PRIVATE end-to-end regression.
 * Only runs on a developer machine with PRIVATE_PDF_DIR configured.
 * The private generator itself must never be placed in this GitHub repo.
 *
 * Usage: PRIVATE_PDF_DIR=/private/path node --test scripts/private-e2e.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLocalDemo } from '../dev/local-demo.mjs';
import { createPrivatePythonRenderer } from '../server/private-python-renderer.mjs';

test('real private V3 PDF after offline fake payment, without cloud or bank requests',{
  skip: !process.env.PRIVATE_PDF_DIR
},async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-private-e2e-'));
  const renderer=createPrivatePythonRenderer({
    bundleDir:process.env.PRIVATE_PDF_DIR,
    timeoutMs:60000,
    maxConcurrent:1,maxPending:1
  });
  let server;
  try{
    server=await createLocalDemo({dataDir:dir,renderer,ordersPerMinute:5});
    const url=await server.listen();
    const created=await fetch(url+'/api/orders',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({birthDate:'2000-02-29'})
    });
    assert.equal(created.status,201);
    const {orderId,accessToken,amount}=await created.json();
    assert.equal(amount,'550.00');
    const auth={Authorization:'Bearer '+accessToken};
    const before=await fetch(url+'/api/orders/'+orderId+'/report',{headers:auth});
    assert.equal(before.status,409);
    const confirmation=await fetch(url+'/api/dev/orders/'+orderId+'/confirm',{
      method:'POST',headers:{...auth,'Content-Type':'application/json',
        'X-Local-Demo':'acknowledge-fake-payment'},
      body:'{}'
    });
    assert.equal(confirmation.status,200);
    assert.equal((await confirmation.json()).state,'ready');
    const result=await fetch(url+'/api/orders/'+orderId+'/report',{headers:auth});
    assert.equal(result.status,200);
    const bytes=Buffer.from(await result.arrayBuffer());
    assert.ok(bytes.length>100000,'Expected full editorial PDF, not mock one-page file');
    assert.equal(bytes.subarray(0,5).toString(),'%PDF-');
    assert.ok(bytes.subarray(-2048).toString('latin1').includes('%%EOF'));
    const unauthorized=await fetch(url+'/api/orders/'+orderId+'/report');
    assert.equal(unauthorized.status,401);
  } finally {
    if(server)await server.close();
    await rm(dir,{recursive:true,force:true});
  }
});
