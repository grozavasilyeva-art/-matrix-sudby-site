/**
 * LOCAL DEMO ONLY. Never deploy this server on the public Internet.
 * It binds exclusively to 127.0.0.1, uses fake payment events, and has no
 * YooKassa, mail, analytics or cloud credentials.
 * SQLite provides durable orders for single-host tests; NOT production web payments.
 */
import { createServer } from 'node:http';
import { randomBytes, randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createDraftOrder, markPaymentCreated, canIssueReport } from '../server/order-domain.mjs';
import { createFulfillment } from '../server/fulfillment.mjs';
import { createFixedWindowLimiter } from '../server/request-limiter.mjs';
import { createSQLiteOrders } from '../server/sqlite-orders.mjs';

const MAX_BODY = 2048;
function sha(token) { return createHash('sha256').update(token).digest('hex'); }
function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,96}$/.test(value); }
function verifyToken(stored, supplied) {
  if (!stored || typeof supplied !== 'string' || supplied.length > 128) return false;
  if (!/^[a-zA-Z0-9_-]{32,128}$/.test(supplied)) return false;
  const left = Buffer.from(stored.tokenHash || '', 'hex');
  const right = Buffer.from(sha(supplied), 'hex');
  return left.length === 32 && timingSafeEqual(left, right);
}
function asJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(value));
}
async function bodyJson(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) {
    const err = new Error('JSON content type required'); err.status = 415; throw err;
  }
  let size=0, data='';
  for await (const part of req) {
    size += part.length;
    if (size > MAX_BODY) { const err=new Error('Request too large'); err.status=413; throw err; }
    data += part.toString('utf8');
  }
  try {
    const value=JSON.parse(data || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch {
    const err=new Error('Invalid JSON');err.status=400;throw err;
  }
}
function fakePdf(date) {
  // Minimal valid A4 PDF for local tests. NOT the private 31-page commercial report.
  const content = 'BT /F1 24 Tf 55 760 Td (LOCAL TEST ONLY) Tj 0 -42 Td /F1 13 Tf (Birth date: ' + date + ') Tj ET';
  const objects=[
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Length ' + Buffer.byteLength(content) + ' >>\nstream\n' + content + '\nendstream'
  ];
  let pdf='%PDF-1.4\n', offsets=[0];
  for(let i=0;i<objects.length;i++){
    offsets.push(Buffer.byteLength(pdf));
    pdf += (i+1) + ' 0 obj\n' + objects[i] + '\nendobj\n';
  }
  const xref=Buffer.byteLength(pdf);
  pdf += 'xref\n0 ' + (objects.length+1) + '\n0000000000 65535 f \n';
  for(let i=1;i<offsets.length;i++) pdf+=String(offsets[i]).padStart(10,'0')+' 00000 n \n';
  pdf += 'trailer\n<< /Size '+(objects.length+1)+' /Root 1 0 R >>\nstartxref\n'+xref+'\n%%EOF\n';
  return new Uint8Array(Buffer.from(pdf));
}

export async function createLocalDemo({ dataDir, renderer, ordersPerMinute=30 }={}) {
  if (process.env.NODE_ENV === 'production') throw new Error('Local demo is blocked in production mode');
  if (typeof dataDir !== 'string' || !dataDir.trim()) throw new TypeError('dataDir required');
  const limiter=createFixedWindowLimiter({limit:ordersPerMinute});
  const root=resolve(dataDir);
  const reportsPath=join(root,'reports');
  await mkdir(reportsPath,{recursive:true,mode:0o700});
  const db=createSQLiteOrders({filePath:join(root,'orders.sqlite')});
  // Only a LOCAL click on the fake confirmation endpoint authorizes this
  // in-memory mock. After fulfillment, status='paid' persists in SQLite.
  const simulatedConfirmed=new Set();
  const authorize={
    async assertAccess(stored, token){
      if(!verifyToken(stored,token)){const e=Error('Unauthorized');e.status=401;throw e;}
    }
  };
  const provider={
    async getPayment(paymentId) {
      const order=await db.getByPaymentId(paymentId);
      if(!order)throw Error('Unknown fake payment');
      const approved=order.status==='paid'||simulatedConfirmed.has(order.orderId);
      return {
        id:paymentId,
        status:approved?'succeeded':'pending',
        paid:approved,
        amount:{value:'550.00',currency:'RUB'},
        metadata:{order_id:order.orderId}
      };
    }
  };
  const storage={
    async putPrivate(key,bytes){
      const m=/^reports\/([a-zA-Z0-9_-]{8,96})\.pdf$/.exec(key);
      if(!m) throw Error('Invalid report key');
      const target=join(reportsPath,m[1]+'.pdf');
      const temp=target+'.'+randomUUID()+'.tmp';
      await writeFile(temp,bytes,{mode:0o600});
      await rename(temp,target);
    },
    async signPrivateGet(){throw Error('HTTPS signed links require real private storage');}
  };
  const safeRenderer=renderer??{async render(job){return fakePdf(job.birthDate);}};
  const service=createFulfillment({orders:db,provider,renderer:safeRenderer,storage,authorize});
  const server=createServer(async(req,res)=>{
    for(const [name,value] of Object.entries({
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer','X-Frame-Options':'DENY',
      'Content-Security-Policy':"default-src 'none'"
    })) res.setHeader(name,value);
    try{
      const host='127.0.0.1:'+server.address().port;
      if(req.headers.host!==host) return asJson(res,403,{error:'Invalid host'});
      if(req.headers.origin && req.headers.origin!=='http://'+host) return asJson(res,403,{error:'Cross-origin requests disabled'});
      const path=new URL(req.url,'http://'+host).pathname;
      if(req.method==='GET' && path==='/health') return asJson(res,200,{status:'ok',mode:'local-demo',payments:'simulated'});
      if(req.method==='POST' && path==='/api/orders'){
        // Only a local loopback source address is trusted. Do not trust X-Forwarded-For.
        const gate=limiter.check(req.socket.remoteAddress || 'unknown');
        if(!gate.allowed){
          res.setHeader('Retry-After',String(gate.retryAfterSeconds));
          return asJson(res,429,{error:'Too many test orders; retry later'});
        }
        const body=await bodyJson(req);
        const id='order_'+randomUUID().replaceAll('-','');
        const token=randomBytes(32).toString('base64url');
        let order=createDraftOrder({orderId:id,birthDate:body.birthDate,nowIso:new Date().toISOString()});
        order=markPaymentCreated(order,'demo_'+randomUUID().replaceAll('-',''));
        await db.create({...order,tokenHash:sha(token)});
        return asJson(res,201,{orderId:id,accessToken:token,status:'payment_pending',amount:'550.00',currency:'RUB',testOnly:true});
      }
      const match=/^\/api\/(?:dev\/)?orders\/([a-zA-Z0-9_-]{8,96})(?:\/(confirm|report))?$/.exec(path);
      if(!match) return asJson(res,404,{error:'Not found'});
      const [,id,verb]=match;
      const stored=await db.get(id);
      const token=/^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(req.headers.authorization||'')?.[1];
      await authorize.assertAccess(stored,token);
      if(req.method==='GET' && !verb){
        return asJson(res,200,{orderId:id,status:stored.status,reportState:stored.reportState,amount:'550.00',currency:'RUB'});
      }
      if(req.method==='POST' && verb==='confirm' && path.startsWith('/api/dev/') &&
          req.headers['x-local-demo']==='acknowledge-fake-payment'){
        await bodyJson(req);
        simulatedConfirmed.add(id);
        const result=await service.fulfill(id);
        return asJson(res,200,{orderId:id,...result,testOnly:true});
      }
      if(req.method==='GET' && verb==='report' && !path.startsWith('/api/dev/')){
        if(!canIssueReport(stored)||stored.reportState!=='ready' ||
           stored.privateObjectKey!=='reports/'+id+'.pdf') return asJson(res,409,{error:'Report not ready'});
        const pdf=await readFile(join(reportsPath,id+'.pdf'));
        if(pdf.subarray(0,5).toString()!=='%PDF-') throw Error('Invalid stored PDF');
        res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="matrix-demo.pdf"'});
        return res.end(pdf);
      }
      return asJson(res,404,{error:'Not found'});
    }catch(err){
      const code=Number(err.status)||(/Invalid birth date|Birth date|Invalid date/.test(err.message)?400:500);
      // Never expose token, payment objects, filesystem paths or stack traces.
      return asJson(res,code,{error:code===500?'Local demo operation failed':err.message});
    }
  });
  async function listen(){
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    return 'http://127.0.0.1:'+server.address().port;
  }
  async function close(){await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));db.close();}
  return Object.freeze({server,listen,close});
}
