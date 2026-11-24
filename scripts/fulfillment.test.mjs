import test from 'node:test';
import assert from 'node:assert/strict';
import { createDraftOrder, markPaymentCreated } from '../server/order-domain.mjs';
import { createFulfillment } from '../server/fulfillment.mjs';

const pdf = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), ...new Uint8Array(250)]);
function setup({ paymentPatch = {}, blockedRender = null, renderBytes = pdf } = {}) {
  const draft = createDraftOrder({
    orderId: 'order_12345678',
    birthDate: '1989-08-23',
    nowIso: '2026-11-05T10:00:00Z'
  });
  let stored = markPaymentCreated(draft, 'payment_12345678');
  let claimState = 'new';
  const calls = { render: 0, put: 0, finish: 0, sign: 0, provider: 0 };
  const payment = {
    id: 'payment_12345678', paid: true, status: 'succeeded',
    amount: { value: '550.00', currency: 'RUB' },
    metadata: { order_id: 'order_12345678' }, ...paymentPatch
  };
  const orders = {
    async get(id) { return id === stored.orderId ? stored : null; },
    async saveVerifiedPayment(verified) { stored = { ...stored, ...verified }; },
    async claimReport() {
      if (claimState === 'new') { claimState = 'busy'; return { state: 'claimed', token: 'internal-fencing-token' }; }
      if (claimState === 'busy') return { state: 'busy' };
      if (claimState === 'ready') return { state: 'ready' };
      throw new Error('Unexpected state');
    },
    async finishReport(id, token, path) {
      assert.equal(token, 'internal-fencing-token');
      calls.finish += 1;
      stored = { ...stored, reportState: 'ready', privateObjectKey: path };
      claimState = 'ready';
    },
    async failReport() { claimState = 'new'; }
  };
  const provider = {
    async getPayment(id) { calls.provider += 1; assert.equal(id, 'payment_12345678'); return payment; }
  };
  const renderer = {
    async render(job) {
      calls.render += 1;
      assert.equal(job.orderId, 'order_12345678');
      if (blockedRender) await blockedRender;
      return renderBytes;
    }
  };
  const storage = {
    async putPrivate(key, data, options) {
      calls.put += 1;
      assert.equal(key, 'reports/order_12345678.pdf');
      assert.equal(data.byteLength, pdf.length);
      assert.equal(options.contentType, 'application/pdf');
    },
    async signPrivateGet(key, seconds) {
      calls.sign += 1;
      assert.equal(key, 'reports/order_12345678.pdf');
      assert.equal(seconds, 300);
      return 'https://private.example.invalid/signed-download';
    }
  };
  const authorize = {
    async assertAccess(order, proof) {
      if (!order || proof !== 'owner-secret') throw new Error('Unauthorized');
    }
  };
  return { service: createFulfillment({ orders, provider, renderer, storage, authorize }), calls };
}

test('в выдаче нет доверия к вебхуку: сервер запрашивает реальный платёж', async () => {
  const { service, calls } = setup();
  const response = await service.fulfill('order_12345678');
  assert.deepEqual(response, { state: 'ready' });
  assert.equal(calls.provider, 1);
  assert.equal(calls.render, 1);
  assert.equal(calls.put, 1);
  assert.equal(calls.finish, 1);
  const second = await service.fulfill('order_12345678');
  assert.deepEqual(second, { state: 'ready' });
  assert.equal(calls.render, 1);
});

test('отклоняются попытки подмены оплаты и чужого заказа', async () => {
  for (const paymentPatch of [
    { status: 'pending' },
    { paid: false },
    { id: 'wrong-payment' },
    { amount: { value: '1.00', currency: 'RUB' } },
    { amount: { value: '550.00', currency: 'USD' } },
    { metadata: { order_id: 'another-order' } }
  ]) {
    const { service, calls } = setup({ paymentPatch });
    await assert.rejects(service.fulfill('order_12345678'));
    assert.equal(calls.render, 0);
    assert.equal(calls.put, 0);
  }
});

test('без подтверждённой оплаты или авторизации ссылку скачать нельзя', async () => {
  const { service, calls } = setup();
  await assert.rejects(service.download('order_12345678', 'owner-secret'), /No paid report/);
  await service.fulfill('order_12345678');
  await assert.rejects(service.download('order_12345678', 'stranger'), /Unauthorized/);
  await assert.rejects(service.download('wrong-order', 'owner-secret'), /Unauthorized|Invalid order/);
  assert.equal(calls.sign, 0);
  const r = await service.download('order_12345678', 'owner-secret');
  assert.equal(r.expiresInSeconds, 300);
  assert.match(r.url, /^https:\/\//);
  assert.equal(calls.sign, 1);
});

test('одновременная обработка заказа не запускает две генерации', async () => {
  let release;
  const blockedRender = new Promise(resolve => { release = resolve; });
  const { service, calls } = setup({ blockedRender });
  const first = service.fulfill('order_12345678');
  // Wait until the first request reaches the blocking renderer.
  for (let i=0; i<30 && !calls.render; i++) await Promise.resolve();
  assert.equal(calls.render, 1);
  const second = await service.fulfill('order_12345678');
  assert.deepEqual(second, { state: 'processing' });
  assert.equal(calls.render, 1);
  release();
  assert.deepEqual(await first, { state: 'ready' });
  assert.equal(calls.put, 1);
});

test('невалидный PDF не сохраняется и не выдаётся', async () => {
  const { service, calls } = setup();
  const draft = createDraftOrder({
    orderId: 'order_12345678',
    birthDate: '1989-08-23',
    nowIso: '2026-11-05T10:00:00Z'
  });
  assert.ok(draft);
  await assert.rejects(service.fulfill('bad'), /Invalid order ID/);
  assert.equal(calls.provider, 0);
});


test('повреждённый PDF не становится доступным покупателю', async () => {
  const invalid = new Uint8Array(260).fill(55);
  const { service, calls } = setup({ renderBytes: invalid });
  await assert.rejects(service.fulfill('order_12345678'), /Invalid PDF file signature/);
  assert.equal(calls.put, 0);
  assert.equal(calls.finish, 0);
  await assert.rejects(service.download('order_12345678', 'owner-secret'), /No paid report/);
});
