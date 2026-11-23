/**
 * Server-only YooKassa redirect checkout creator. NOT wired to a public route.
 *
 * The caller supplies a TRUSTED database order and a persisted idempotency key.
 * No browser-supplied amount, order ID, redirect URL, or idempotency key is accepted.
 * Official API: https://yookassa.ru/developers/payment-acceptance/getting-started/payment-process
 */
import { PRODUCT } from './order-domain.mjs';

const API = 'https://api.yookassa.ru/v3/payments';
const ORDER_ID = /^[a-zA-Z0-9_-]{8,96}$/;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;

function secureUrl(value, name) {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(name + ' must be an HTTPS URL'); }
  if (url.protocol !== 'https:' || !url.hostname ||
      url.username || url.password || url.hash || url.port) {
    throw new Error(name + ' must be a safe HTTPS URL');
  }
  return url;
}

function validateTrustedOrder(order) {
  if (!order || typeof order !== 'object' ||
      typeof order.orderId !== 'string' || !ORDER_ID.test(order.orderId) ||
      order.status !== 'draft' || order.paymentId !== null ||
      order.product !== PRODUCT.sku ||
      order.amountMinor !== PRODUCT.priceMinor ||
      order.currency !== PRODUCT.currency) {
    throw new Error('Order is not an eligible trusted draft');
  }
}

/**
 * Caller MUST store the idempotency key in durable order storage BEFORE the API
 * request, and reuse the same key with precisely the same request on retries.
 * Before a production checkout, implement atomic draft -> payment_pending
 * storage and reconciliation for a crash between API creation and DB update.
 */
export function createYooKassaCheckout({
  shopId, secretKey, returnUrl, transport = globalThis.fetch
} = {}) {
  if (typeof shopId !== 'string' || !/^[0-9]{3,20}$/.test(shopId)) {
    throw new TypeError('YooKassa shop ID is required');
  }
  if (typeof secretKey !== 'string' || secretKey.length < 8) {
    throw new TypeError('YooKassa secret is required');
  }
  if (typeof transport !== 'function') throw new TypeError('HTTPS transport is required');
  const returnUri=secureUrl(returnUrl,'Return URL');
  const authorization='Basic '+Buffer.from(shopId+':'+secretKey,'utf8').toString('base64');

  async function createPayment(order, idempotencyKey) {
    validateTrustedOrder(order);
    if (typeof idempotencyKey !== 'string' || !KEY.test(idempotencyKey)) {
      throw new Error('Invalid persisted idempotency key');
    }
    const body = {
      amount:{value:PRODUCT.priceRub,currency:PRODUCT.currency},
      capture:true,
      confirmation:{type:'redirect',return_url:returnUri.href},
      description:'Персональный отчёт «Матрица судьбы», заказ '+order.orderId,
      metadata:{order_id:order.orderId}
    };
    let response;
    try {
      response = await transport(API,{
        method:'POST',
        headers:{
          'Authorization':authorization,
          'Idempotence-Key':idempotencyKey,
          'Content-Type':'application/json',
          'Accept':'application/json'
        },
        body:JSON.stringify(body),
        cache:'no-store',
        redirect:'error',
        signal:AbortSignal.timeout(10000)
      });
    } catch {
      throw new Error('YooKassa checkout request unavailable; retry with the SAME idempotency key');
    }
    if (!response || !response.ok || response.status !== 200) {
      throw new Error('YooKassa checkout request rejected; verify order state before retry');
    }
    let payment;
    try { payment=await response.json(); }
    catch { throw new Error('YooKassa checkout returned malformed JSON'); }
    if (!payment || typeof payment.id !== 'string' ||
        !/^[A-Za-z0-9_-]{4,128}$/.test(payment.id) ||
        payment.status !== 'pending' || payment.paid !== false ||
        payment.amount?.value !== PRODUCT.priceRub ||
        payment.amount?.currency !== PRODUCT.currency ||
        payment.metadata?.order_id !== order.orderId ||
        payment.confirmation?.type !== 'redirect') {
      throw new Error('YooKassa checkout response did not match the trusted order');
    }
    const redirectUri=secureUrl(payment.confirmation.confirmation_url,'Confirmation URL');
    // Do not expose the provider's raw JSON or credentials to the caller.
    return Object.freeze({
      paymentId:payment.id,
      orderId:order.orderId,
      status:'payment_pending',
      confirmationUrl:redirectUri.href
    });
  }
  return Object.freeze({createPayment});
}
