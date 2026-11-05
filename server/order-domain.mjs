/**
 * Provider-neutral order rules. NO payment API, network call, secret or user database.
 * The HTTP layer must generate IDs server-side and authenticate itself to the payment provider.
 * A payment object may only be passed here after fetching it independently from the provider.
 */
import { calculateMatrix } from '../src/calculator.mjs';

export const PRODUCT = Object.freeze({
  sku: 'matrix-full-report-v1',
  priceMinor: 55000,
  priceRub: '550.00',
  currency: 'RUB'
});

export function normalizeBirthDate(isoDate) {
  if (typeof isoDate !== 'string') throw new Error('Invalid date');
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!m) throw new Error('Birth date must be YYYY-MM-DD');
  const [,year,month,day]=m;
  if (!calculateMatrix(+day,+month,+year)) throw new Error('Invalid birth date');
  return year+'-'+month+'-'+day;
}

export function createDraftOrder({ orderId, birthDate, nowIso }) {
  // These arguments MUST come from trusted server code, not from checkout JSON.
  if (typeof orderId!=='string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(orderId)) {
    throw new Error('Invalid server-generated order ID');
  }
  if (typeof nowIso!=='string' || !Number.isFinite(Date.parse(nowIso))) {
    throw new Error('Invalid creation timestamp');
  }
  return Object.freeze({
    orderId,
    birthDate: normalizeBirthDate(birthDate),
    product: PRODUCT.sku,
    amountMinor: PRODUCT.priceMinor,
    currency: PRODUCT.currency,
    status: 'draft',
    paymentId: null,
    createdAt: nowIso
  });
}

export function markPaymentCreated(order, paymentId) {
  if (order?.status!=='draft') throw new Error('Payment can only be linked to draft orders');
  if (typeof paymentId!=='string' || paymentId.trim().length<4 || paymentId.length>128) {
    throw new Error('Invalid provider payment ID');
  }
  return Object.freeze({ ...order, status: 'payment_pending', paymentId });
}

export function markPaymentVerified(order, fetchedPayment) {
  // fetchedPayment must be loaded by the backend from the payment provider's
  // authenticated API, NOT from browser input or unverified webhook payload.
  if (!order || !['payment_pending','paid'].includes(order.status) ||
      typeof order.paymentId!=='string' || !order.paymentId) {
    throw new Error('Order is not linked to a verified provider payment');
  }
  const matching = fetchedPayment?.id===order.paymentId &&
    fetchedPayment?.status==='succeeded' &&
    fetchedPayment?.paid===true &&
    fetchedPayment?.amount?.value===PRODUCT.priceRub &&
    fetchedPayment?.amount?.currency===PRODUCT.currency;
  if (!matching) throw new Error('Payment is not verified: paid status, ID, amount and currency must match');
  return order.status==='paid' ? order : Object.freeze({ ...order, status:'paid' });
}

export function canIssueReport(order) {
  return order?.status==='paid' && order?.product===PRODUCT.sku &&
    order?.amountMinor===PRODUCT.priceMinor && order?.currency===PRODUCT.currency &&
    typeof order?.paymentId==='string' && order.paymentId.length>0;
}
