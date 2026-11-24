/**
 * Internal handler for payment.succeeded notifications.
 * Webhook contents are NOT proof of payment. Only known payment IDs can
 * trigger the independently verifying fulfillment worker.
 * No public HTTP route is installed; ingress limits and authentication
 * are required before deployment. No refunds or cancellation support yet.
 */
const PAYMENT=/^[A-Za-z0-9_-]{4,128}$/;
export function createPaymentNotificationHandler({orders,fulfillment}={}){
  if(typeof orders?.getByPaymentId!=='function'||typeof fulfillment?.fulfill!=='function')
    throw new TypeError('Notification dependencies required');
  async function handle(body){
    if(!body||body.type!=='notification'||body.event!=='payment.succeeded'||
       typeof body.object?.id!=='string'||!PAYMENT.test(body.object.id))
      return {status:400,state:'unsupported_notification'};
    const order=await orders.getByPaymentId(body.object.id);
    // An event may race the transaction linking a provider payment.
    // No provider lookup or generation for unknown payment IDs.
    if(!order)return {status:503,state:'unlinked_payment'};
    if(!['payment_pending','paid'].includes(order.status))
      return {status:200,state:'ignored'};
    if(order.status==='paid'&&order.reportState==='ready')
      return {status:200,state:'ready'};
    try{
      const result=await fulfillment.fulfill(order.orderId);
      // Acknowledge only completed work; without a durable worker queue,
      // processing or errors need a repeat delivery.
      return result.state==='ready'?{status:200,state:'ready'}:
        {status:503,state:'retry'};
    }catch{
      return {status:503,state:'retry'};
    }
  }
  return Object.freeze({handle});
}
