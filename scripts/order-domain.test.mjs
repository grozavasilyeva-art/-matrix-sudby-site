import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRODUCT, createDraftOrder, markPaymentCreated,
  markPaymentVerified, canIssueReport, normalizeBirthDate
} from '../server/order-domain.mjs';

const draft=()=>createDraftOrder({
  orderId:'local_order_12345678', birthDate:'1989-08-23',
  nowIso:'2026-10-29T19:00:00.000Z'
});
const providerPayment=(id='pay_12345678')=>({
  id, status:'succeeded', paid:true, amount:{value:'550.00',currency:'RUB'}
});

test('цена задаётся на сервере и не приходит из заявки', () => {
  const order=createDraftOrder({
    orderId:'local_order_12345678',
    birthDate:'1989-08-23',
    nowIso:'2026-10-29T19:00:00.000Z',
    priceMinor:1,
    currency:'USD'
  });
  assert.equal(PRODUCT.priceMinor,55000);
  assert.equal(order.amountMinor,55000);
  assert.equal(order.currency,'RUB');
  assert.equal(order.status,'draft');
  assert.equal(canIssueReport(order),false);
  assert.ok(Object.isFrozen(order));
});

test('защита от невалидных дат и идентификаторов', () => {
  assert.equal(normalizeBirthDate('2000-02-29'),'2000-02-29');
  for (const date of ['1900-02-29','2026-13-01','2025-02-29','01.01.2000','']) {
    assert.throws(()=>normalizeBirthDate(date));
  }
  assert.throws(()=>createDraftOrder({
    orderId:'x',birthDate:'1989-08-23',nowIso:'2026-10-29T19:00:00Z'
  }));
});

test('неподтверждённый платёж не выдаёт доступ к PDF', () => {
  const linked=markPaymentCreated(draft(),'pay_12345678');
  assert.equal(linked.status,'payment_pending');
  assert.equal(canIssueReport(linked),false);
  for (const variant of [
    {...providerPayment(),status:'pending'},
    {...providerPayment(),paid:false},
    {...providerPayment(),id:'someone_elses_payment'},
    {...providerPayment(),amount:{value:'1.00',currency:'RUB'}},
    {...providerPayment(),amount:{value:'550.00',currency:'USD'}},
    null
  ]) {
    assert.throws(()=>markPaymentVerified(linked,variant));
    assert.equal(canIssueReport(linked),false);
  }
});

test('подтверждённая полная оплата разрешает отчёт, повтор безопасен', () => {
  const linked=markPaymentCreated(draft(),'pay_12345678');
  const paid=markPaymentVerified(linked,providerPayment());
  assert.equal(paid.status,'paid');
  assert.equal(canIssueReport(paid),true);
  assert.strictEqual(markPaymentVerified(paid,providerPayment()),paid);
  assert.throws(()=>markPaymentVerified(draft(),providerPayment()));
});

test('не разрешаем связать другой платёж с ожидающим заказом', () => {
  const linked=markPaymentCreated(draft(),'pay_12345678');
  assert.throws(()=>markPaymentCreated(linked,'pay_wrong'));
});
