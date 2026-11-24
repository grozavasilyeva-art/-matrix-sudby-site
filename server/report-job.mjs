/**
 * Integration contract for a separate PRIVATE PDF renderer.
 *
 * IMPORTANT: Call only with an order loaded from the trusted order database.
 * Never pass a browser-supplied object here as proof of payment.
 * This code does not trigger PDF generation, touch a payment provider, or store data.
 * Editorial texts, fonts, rendering templates, and finished PDF must NOT be public.
 */
import { canIssueReport, normalizeBirthDate } from './order-domain.mjs';

export const REPORT_SCHEMA_VERSION = 'matrix-report-v1';
export const REPORT_TEMPLATE_VERSION = 'editorial-2026-10';

export function prepareReportJob(trustedOrder) {
  if (!canIssueReport(trustedOrder)) {
    throw new Error('PDF unavailable: order payment is not verified');
  }
  const date = normalizeBirthDate(trustedOrder.birthDate);
  if (typeof trustedOrder.orderId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,96}$/.test(trustedOrder.orderId)) {
    throw new Error('Invalid order identifier');
  }
  return Object.freeze({
    schemaVersion: REPORT_SCHEMA_VERSION,
    templateVersion: REPORT_TEMPLATE_VERSION,
    orderId: trustedOrder.orderId,
    birthDate: date,
    product: trustedOrder.product,
    privateObjectKey: 'reports/' + trustedOrder.orderId + '.pdf'
  });
}

/**
 * The adapter called by an HTTP controller should:
 * 1. load order and payment data from trusted server storage;
 * 2. verify payment independently with the payment provider;
 * 3. prepareReportJob(verifiedOrder);
 * 4. call a private renderer (not exposed as a URL);
 * 5. put the PDF into NON-PUBLIC storage;
 * 6. issue a short-lived authenticated download link.
 */
