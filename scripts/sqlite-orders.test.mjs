import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDraftOrder, markPaymentCreated, markPaymentVerified } from '../server/order-domain.mjs';
import { createSQLiteOrders } from '../server/sqlite-orders.mjs';

function pending(id='order_12345678', paymentId='payment_12345678') {
  const draft=createDraftOrder({
    orderId:id,birthDate:'1989-08-23',nowIso:'2026-11-22T08:00:00.000Z'
  });
  return {...markPaymentCreated(draft,paymentId),tokenHash:'a'.repeat(64)};
}
function succeeded(order) {
  return markPaymentVerified(order,{
    id:order.paymentId,status:'succeeded',paid:true,
    amount:{value:'550.00',currency:'RUB'}
  });
}

test('SQLite persists a paid order, prevents competing generators and fences expired claims',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-sqlite-test-'));
  const file=join(dir,'private-orders.sqlite');
  let clock=10000;
  let first,second,again;
  try{
    first=createSQLiteOrders({filePath:file,now:()=>clock,leaseMs:1000});
    second=createSQLiteOrders({filePath:file,now:()=>clock,leaseMs:1000});
    const order=pending();
    await first.create(order);
    assert.equal((await second.get(order.orderId)).status,'payment_pending');
    await assert.rejects(second.claimReport(order.orderId),/not paid/);
    const paid=succeeded(order);
    await second.saveVerifiedPayment(paid);
    await first.saveVerifiedPayment(paid); // idempotent
    assert.equal((await first.get(order.orderId)).status,'paid');

    const c1=await first.claimReport(order.orderId);
    assert.equal(c1.state,'claimed');
    assert.deepEqual(await second.claimReport(order.orderId),{state:'busy'});
    clock=11001;
    const c2=await second.claimReport(order.orderId);
    assert.equal(c2.state,'claimed');
    assert.notEqual(c2.token,c1.token);
    await assert.rejects(first.finishReport(order.orderId,c1.token,'reports/'+order.orderId+'.pdf'),/superseded/);
    await second.finishReport(order.orderId,c2.token,'reports/'+order.orderId+'.pdf');
    assert.deepEqual(await first.claimReport(order.orderId),{state:'ready'});
    assert.equal((await first.get(order.orderId)).privateObjectKey,'reports/'+order.orderId+'.pdf');
    const info=await stat(file);
    assert.ok(info.size>100);
    assert.equal(info.mode & 0o077,0,'Database file must not have group/world read permission');
    first.close();first=null;second.close();second=null;

    again=createSQLiteOrders({filePath:file});
    const recovered=await again.get(order.orderId);
    assert.equal(recovered.status,'paid');
    assert.equal(recovered.reportState,'ready');
    assert.equal(recovered.tokenHash,'a'.repeat(64));
  }finally{
    if(first)first.close();
    if(second)second.close();
    if(again)again.close();
    await rm(dir,{recursive:true,force:true});
  }
});

test('SQLite rejects duplicate payment IDs, invalid dates and client-supplied prices',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-sqlite-bad-'));
  const db=createSQLiteOrders({filePath:join(dir,'orders.sqlite')});
  try{
    const p=pending();
    await db.create(p);
    await assert.rejects(db.create(p),/UNIQUE/);
    await assert.rejects(db.create(pending('order_99999999',p.paymentId)),/UNIQUE/);
    await assert.rejects(db.create({...pending('order_88888888','payment_88888888'),amountMinor:1}),/Invalid trusted order/);
    await assert.rejects(db.create({...pending('order_77777777','payment_77777777'),birthDate:'2026-02-29'}),/Invalid birth date/);
    assert.equal(await db.get('order_88888888'),null);
    await assert.rejects(db.get('not valid'),/Invalid order/);
  }finally{db.close();await rm(dir,{recursive:true,force:true});}
});

test('SQLite failed generation releases only its own lease; new worker may retry',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'matrix-sqlite-retry-'));
  const db=createSQLiteOrders({filePath:join(dir,'orders.sqlite'),leaseMs:60000});
  try{
    const p=pending();
    await db.create(p);
    await db.saveVerifiedPayment(succeeded(p));
    const first=await db.claimReport(p.orderId);
    assert.equal(await db.failReport(p.orderId,'invalid-fencing-token'),false);
    assert.deepEqual(await db.claimReport(p.orderId),{state:'busy'});
    assert.equal(await db.failReport(p.orderId,first.token),true);
    const retry=await db.claimReport(p.orderId);
    assert.equal(retry.state,'claimed');
    assert.notEqual(retry.token,first.token);
    await assert.rejects(db.finishReport(p.orderId,retry.token,'wrong/path.pdf'),/Invalid private object/);
    await db.finishReport(p.orderId,retry.token,'reports/'+p.orderId+'.pdf');
  }finally{db.close();await rm(dir,{recursive:true,force:true});}
});
