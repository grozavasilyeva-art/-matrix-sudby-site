/**
 * YooKassa read-only payment verifier.
 * Server-side module. Never bundle this with the public frontend.
 * Credentials are passed in at runtime; no secrets are kept in GitHub.
 *
 * Official docs: https://yookassa.ru/developers/using-api/interaction-format
 * This module DOES NOT create, capture, refund, or modify payments.
 */
const API='https://api.yookassa.ru/v3/payments/';
const PAYMENT_ID=/^[a-zA-Z0-9_-]{4,128}$/;

export function createYooKassaVerifier({shopId,secretKey,transport=globalThis.fetch}={}) {
  if(typeof shopId!=='string'||!/^[0-9]{3,20}$/.test(shopId))
    throw new TypeError('YooKassa shop ID is required');
  if(typeof secretKey!=='string'||secretKey.length<8)
    throw new TypeError('YooKassa API secret is required');
  if(typeof transport!=='function')throw new TypeError('HTTPS transport is required');
  const auth='Basic '+Buffer.from(shopId+':'+secretKey,'utf8').toString('base64');
  return Object.freeze({
    async getPayment(paymentId) {
      if(typeof paymentId!=='string'||!PAYMENT_ID.test(paymentId))
        throw new Error('Invalid YooKassa payment ID');
      let response;
      try {
        response=await transport(API+encodeURIComponent(paymentId),{
          method:'GET',
          headers:{
            'Authorization':auth,
            'Accept':'application/json',
            'Cache-Control':'no-store'
          },
          redirect:'error',
          cache:'no-store',
          signal:AbortSignal.timeout(10000)
        });
      } catch {
        // No URL, token, or provider response body is included in errors.
        throw new Error('YooKassa payment lookup unavailable');
      }
      if(!response || response.status!==200 || !response.ok)
        throw new Error('YooKassa payment lookup rejected');
      let data;
      try { data=await response.json(); }
      catch {throw new Error('YooKassa returned malformed JSON');}
      if(!data || typeof data!=='object' || data.id!==paymentId ||
         typeof data.status!=='string' || typeof data.paid!=='boolean' ||
         !data.amount || typeof data.amount.value!=='string' ||
         typeof data.amount.currency!=='string') {
        throw new Error('YooKassa returned invalid payment data');
      }
      // Amount, currency, paid status, and metadata.order_id are rechecked by
      // fulfillment against the trusted order; never trust the return URL.
      return data;
    }
  });
}
