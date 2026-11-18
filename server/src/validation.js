export const positiveId = x => Number.isSafeInteger(Number(x)) && Number(x) > 0;
export const uuidValid = x => typeof x === 'string' && /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(x);
export function credentialsValid(body, register=false) {
  return body && typeof body.username === 'string' && /^[a-zA-Z0-9_]{3,24}$/.test(body.username)
    && typeof body.password === 'string' && body.password.length >= 6 && Buffer.byteLength(body.password) <= 72
    && (!register || typeof body.displayName === 'string' && body.displayName.trim().length > 0 && body.displayName.length <= 80);
}
export function messageValid(m) {
  return m && uuidValid(m.uuid) && positiveId(m.conversationId) && ['text','voice','file'].includes(m.kind ?? 'text')
    && typeof m.body === 'string' && m.body.trim().length > 0 && m.body.length <= 4000
    && (m.replyTo == null || uuidValid(m.replyTo));
}
export function signalValid(p) {
  return p && positiveId(p.to) && ['offer','answer','ice'].includes(p.kind) && p.data && typeof p.data === 'object'
    && JSON.stringify(p.data).length <= 16000
    && (p.kind === 'ice' ? typeof p.data.candidate === 'string' : p.data.type === p.kind && typeof p.data.sdp === 'string');
}
// Fixed-window limiter with bounded keys. Tests inject time without waiting.
export function createLimiter(limit, windowMs, maxKeys=10000) {
  const entries = new Map();
  return (key, now=Date.now()) => {
    if (entries.size >= maxKeys) for (const [k,v] of entries) if (v.until <= now) entries.delete(k);
    let entry=entries.get(key);
    if (!entry || entry.until <= now) {
      if (!entry && entries.size >= maxKeys) return false;
      entry={count:0,until:now+windowMs};entries.set(key,entry);
    }
    return ++entry.count <= limit;
  };
}
