/**
 * Checkout coordinator: trusted order DB + provider adapter.
 * No HTTP listener; this module is not a deployed payment endpoint.
 * The caller must rate-limit before reserving orders and starting provider calls.
 */
import {randomBytes,randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {createDraftOrder} from './order-domain.mjs';

const ID=/^[A-Za-z0-9_-]{8,96}$/;
const TOKEN=/^[A-Za-z0-9_-]{43}$/;
const MAX_RETRY_AGE=23*60*60*1000;
const hash=value=>createHash('sha256').update(value).digest('hex');

export function createCheckoutService({orders,checkout,configurationId,now=Date.now}={}){
  for(const method of ['reserveCheckout','getCheckout','linkCheckout','get']){
    if(typeof orders?.[method]!=='function')throw new TypeError('Order store missing '+method);
  }
  if(typeof checkout?.createPayment!=='function')throw new TypeError('Checkout adapter required');
  // Must identify the exact merchant, return URL and immutable request format.
  // Change this identifier whenever any of these settings changes.
  if(typeof configurationId!=='string'||configurationId.length<8||configurationId.length>1024)
    throw new TypeError('Stable checkout configuration ID required');
  if(typeof now!=='function')throw new TypeError('Clock required');
  const scope=hash(configurationId);
  const active=new Map();
  function clock(){
    const value=now();
    if(!Number.isSafeInteger(value)||value<0)throw new Error('Invalid clock');
    return value;
  }
  async function reserve(birthDate){
    const time=clock();
    const orderId='order_'+randomUUID().replaceAll('-','');
    const accessToken=randomBytes(32).toString('base64url');
    const draft=createDraftOrder({orderId,birthDate,nowIso:new Date(time).toISOString()});
    await orders.reserveCheckout(draft,hash(accessToken),scope);
    return {orderId,accessToken,amount:'550.00',currency:'RUB',status:'draft'};
  }
  async function authorized(id,token){
    if(typeof id!=='string'||!ID.test(id)||typeof token!=='string'||!TOKEN.test(token))
      throw new Error('Unauthorized checkout');
    const draft=await orders.getCheckout(id);
    if(!draft||typeof draft.tokenHash!=='string'||!/^[a-f0-9]{64}$/.test(draft.tokenHash)||
       !timingSafeEqual(Buffer.from(draft.tokenHash,'hex'),Buffer.from(hash(token),'hex')))
      throw new Error('Unauthorized checkout');
    return draft;
  }
  async function start(id,token){
    const draft=await authorized(id,token);
    if(draft.paymentId){
      const order=await orders.get(id);
      if(!order||order.paymentId!==draft.paymentId)throw new Error('Order link unavailable');
      return {orderId:id,status:order.status,
        confirmationUrl:order.status==='payment_pending'?draft.confirmationUrl:null};
    }
    if(draft.requestScope!==scope)throw new Error('Checkout configuration changed; reconcile manually');
    const age=clock()-draft.createdMs;
    // YooKassa guarantees idempotency for 24 hours after the first request.
    // Start the conservative 23-hour window at durable reservation, not the last retry.
    if(!Number.isSafeInteger(age)||age<0||age>=MAX_RETRY_AGE)
      throw new Error('Checkout retry window expired; reconcile manually');
    if(active.has(id))return active.get(id);
    const task=(async()=>{
      const result=await checkout.createPayment(draft,draft.idempotencyKey);
      await orders.linkCheckout(id,draft.idempotencyKey,result);
      return {orderId:id,status:'payment_pending',confirmationUrl:result.confirmationUrl};
    })();
    active.set(id,task);
    try{return await task;}finally{active.delete(id);}
  }
  return Object.freeze({reserve,start});
}
