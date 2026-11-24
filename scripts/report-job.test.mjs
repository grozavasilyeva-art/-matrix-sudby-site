import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftOrder, markPaymentCreated, markPaymentVerified } from '../server/order-domain.mjs';
import { prepareReportJob, REPORT_SCHEMA_VERSION } from '../server/report-job.mjs';

const d=createDraftOrder({
  orderId:'example_202610290001',
  birthDate:'1989-08-23',
  nowIso:'2026-10-29T20:00:00Z'
});
const pending=markPaymentCreated(d,'payment_example_001');
const paid=markPaymentVerified(pending,{
  id:'payment_example_001',paid:true,status:'succeeded',
  amount:{value:'550.00',currency:'RUB'}
});

test('не выдаём полный отчёт без проверенной оплаты',()=>{
  assert.throws(()=>prepareReportJob(d),/not verified/);
  assert.throws(()=>prepareReportJob(pending),/not verified/);
});

test('подтверждённый заказ получает задание для ПРИВАТНОГО генератора',()=>{
  const job=prepareReportJob(paid);
  assert.equal(job.schemaVersion,REPORT_SCHEMA_VERSION);
  assert.equal(job.birthDate,'1989-08-23');
  assert.equal(job.orderId,'example_202610290001');
  assert.equal(job.privateObjectKey,'reports/example_202610290001.pdf');
  assert.ok(Object.isFrozen(job));
  assert.equal(JSON.stringify(job).includes('550.00'),false);
});

test('задание не содержит ключей, текста отчёта и публичной ссылки',()=>{
  const text=JSON.stringify(prepareReportJob(paid));
  for(const forbidden of ['secret','token','reportHtml','confirmation_url','https://','privateKey']){
    assert.equal(text.includes(forbidden),false,forbidden);
  }
});
