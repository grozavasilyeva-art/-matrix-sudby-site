/**
 * Private report orchestration, provider-neutral and offline-testable.
 *
 * Production injects authenticated provider/database/storage implementations.
 * No HTTP endpoint, credentials, PDF text, or payment API are included here.
 * Never call fulfill() with a browser-supplied order object: only an order ID.
 */
import { markPaymentVerified, canIssueReport } from './order-domain.mjs';
import { prepareReportJob } from './report-job.mjs';

export function createFulfillment({ orders, provider, renderer, storage, authorize }) {
  for (const [label, dependency, methods] of [
    ['orders', orders, ['get', 'saveVerifiedPayment', 'claimReport', 'finishReport', 'failReport']],
    ['provider', provider, ['getPayment']],
    ['renderer', renderer, ['render']],
    ['storage', storage, ['putPrivate', 'signPrivateGet']],
    ['authorize', authorize, ['assertAccess']]
  ]) {
    if (!dependency || methods.some(name => typeof dependency[name] !== 'function')) {
      throw new TypeError('Missing dependency: ' + label);
    }
  }

  async function fulfill(orderId) {
    if (typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(orderId)) {
      throw new Error('Invalid order ID');
    }
    const stored = await orders.get(orderId); // Trusted database, not checkout input
    if (!stored || !['payment_pending', 'paid'].includes(stored.status) ||
        !stored.paymentId) throw new Error('Order is not awaiting verified payment');

    // Always fetch payment from the payment provider's authenticated API.
    // A webhook body can only notify this worker that it should perform the lookup.
    const payment = await provider.getPayment(stored.paymentId);
    if (payment?.metadata?.order_id !== stored.orderId) {
      throw new Error('Payment belongs to a different order');
    }
    const verified = markPaymentVerified(stored, payment);
    await orders.saveVerifiedPayment(verified); // Atomic, idempotent in production

    const job = prepareReportJob(verified);
    // The database MUST implement this as an atomic compare-and-set claim,
    // with a lease timeout and token fencing for crashed/competing workers.
    const claim = await orders.claimReport(job.orderId);
    if (claim?.state === 'ready') return { state: 'ready' };
    if (claim?.state === 'busy') return { state: 'processing' };
    if (claim?.state !== 'claimed' || typeof claim.token !== 'string') {
      throw new Error('Invalid report claim');
    }
    try {
      const pdf = await renderer.render(job); // Private package, never on public CI
      if (!(pdf instanceof Uint8Array) || pdf.byteLength < 100) {
        throw new Error('Private renderer did not return PDF bytes');
      }
      const head = new TextDecoder().decode(pdf.subarray(0, 5));
      if (head !== '%PDF-') throw new Error('Invalid PDF file signature');
      await storage.putPrivate(job.privateObjectKey, pdf, {
        contentType: 'application/pdf', cacheControl: 'private, no-store'
      });
      await orders.finishReport(job.orderId, claim.token, job.privateObjectKey);
      return { state: 'ready' }; // Do not expose object path to users
    } catch (err) {
      await orders.failReport(job.orderId, claim.token).catch(() => {});
      throw err;
    }
  }

  async function download(orderId, accessProof) {
    if (typeof orderId !== 'string' || !/^[a-zA-Z0-9_-]{8,96}$/.test(orderId)) {
      throw new Error('Invalid order ID');
    }
    const stored = await orders.get(orderId);
    // Any failure in authentication must be fail-closed.
    await authorize.assertAccess(stored, accessProof);
    if (!canIssueReport(stored) || stored.reportState !== 'ready' ||
        stored.privateObjectKey !== 'reports/' + stored.orderId + '.pdf') {
      throw new Error('No paid report available');
    }
    // Short-lived, signed HTTPS URL. Never return the unprotected object path.
    const url = await storage.signPrivateGet(stored.privateObjectKey, 300);
    if (typeof url !== 'string' || !url.startsWith('https://')) {
      throw new Error('Invalid private download URL');
    }
    return { url, expiresInSeconds: 300 };
  }

  return Object.freeze({ fulfill, download });
}
