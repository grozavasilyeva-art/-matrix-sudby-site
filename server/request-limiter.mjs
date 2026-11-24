/**
 * Fixed-window limiter for application-level safety.
 * Never trust client-supplied X-Forwarded-For on an exposed Node server.
 * This LOCAL implementation is process memory, not a distributed WAF.
 * Edge protection is still required before billable cloud invocations.
 */
export function createFixedWindowLimiter({ limit=30, windowMs=60000, now=Date.now }={}) {
  if(!Number.isInteger(limit)||limit<1||limit>100000)throw new RangeError('Invalid request limit');
  if(!Number.isInteger(windowMs)||windowMs<1000||windowMs>3600000)throw new RangeError('Invalid window');
  if(typeof now!=='function')throw new TypeError('Clock must be a function');
  const slots=new Map();
  return Object.freeze({
    check(key) {
      if(typeof key!=='string'||!key||key.length>128)throw new Error('Invalid rate-limit key');
      const time=now();
      if(!Number.isFinite(time))throw new Error('Clock is invalid');
      // Prevent unbounded memory use from repeated distinct keys.
      if(slots.size>4096) for(const [k,v] of slots) if(time>=v.until)slots.delete(k);
      // Fail closed when the key table fills, rather than resetting all existing limits.
      if(slots.size>=8192 && !slots.has(key)) {
        return {allowed:false,retryAfterSeconds:Math.ceil(windowMs/1000)};
      }
      let slot=slots.get(key);
      if(!slot||time>=slot.until){
        slot={count:0,until:time+windowMs};
        slots.set(key,slot);
      }
      if(slot.count>=limit) {
        return {allowed:false,retryAfterSeconds:Math.max(1,Math.ceil((slot.until-time)/1000))};
      }
      slot.count++;
      return {allowed:true,remaining:limit-slot.count};
    }
  });
}
