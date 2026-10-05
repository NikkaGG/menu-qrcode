declare const EdgeRuntime: {waitUntil(promise:Promise<unknown>):void};
export const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
export const serviceKey = keys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
export const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,x-admin-pin,x-admin-role,x-staff-pin,x-staff-role,x-device-id,apikey,authorization', 'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
export function reply(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: cors }); }
export async function db(path: string, init: RequestInit = {}) {
  const r = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...init, signal:init.signal||AbortSignal.timeout(8000), headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers || {}) } });
  const result = await r.json().catch(() => null);
  if (!r.ok) throw Object.assign(new Error(result?.message || 'Database unavailable'), { status: r.status, code: result?.code });
  return result;
}
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2, '0')).join('');
}
export function uuid(value: unknown) { const s = String(value || '').toLowerCase(); return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s) ? s : ''; }
export async function budget(req: Request, scope: string, limit = 120) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  return db('rpc/consume_request_budget', { method: 'POST', body: JSON.stringify({ p_key: await hash(ip + ':' + scope), p_limit: limit }) });
}
export async function authenticate(req: Request, pin: string, role: string):Promise<{id:number,name:string,role:'admin'|'waiter'|'kitchen'}|null> {
  if (!['admin','waiter','kitchen'].includes(role) || !/^\d{1,12}$/.test(pin)) return null;
  if (!(await budget(req, 'access:' + role, 600))) throw Object.assign(new Error('Слишком много попыток. Подождите минуту.'), { status: 429 });
  const rows = await db(`role_access?select=pin_hash&role=eq.${role}&limit=1`);
  if (!rows?.[0]) return null;
  const saved = rows[0].pin_hash;
  let valid = false;
  if (saved.startsWith('pbkdf2:')) {
    const [, salt, expected] = saved.split(':');
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bytes = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
    valid = Array.from(new Uint8Array(bytes), x => x.toString(16).padStart(2,'0')).join('') === expected;
  } else valid = await hash(pin) === saved;
  if(!valid&&!(await budget(req,'invalid-pin:'+role,30))) throw Object.assign(new Error('Слишком много попыток. Подождите минуту.'),{status:429});
  const selected=role as 'admin'|'waiter'|'kitchen';
  return valid ? { id: 0, name: {admin:'Администратор',waiter:'Официант',kitchen:'Кухня'}[selected], role:selected } : null;
}
export async function pinHash(pin: string) {
  const salt = crypto.randomUUID();
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bytes = await crypto.subtle.deriveBits({ name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000 }, key, 256);
  return 'pbkdf2:' + salt + ':' + Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
export async function audit(req: Request, role: string, action: string, entity: unknown = '') {
  await db('operation_events', { method:'POST',body:JSON.stringify({role,action,entity_id:String(entity),device_id:(req.headers.get('x-device-id')||'').slice(0,100)}) });
}
export async function incident(source: string, error: unknown) {
  const message = String((error as Error)?.message || 'Unexpected error').slice(0,500);
  console.error(source, message);
  await db('rpc/record_incident',{method:'POST',body:JSON.stringify({p_source:source,p_message:message,p_fingerprint:await hash(source+':'+message)})}).catch(()=>{});
}
export async function settings() {
  const rows = await db('site_settings?select=*&id=eq.1&limit=1');
  return rows?.[0] || {restaurant_name:'Суши Крейзи',currency:'KZT',timezone:'Asia/Qyzylorda',public_menu_enabled:false};
}
export async function pushConfig() {
  const found = await db('private_config?select=value&key=eq.vapid&limit=1');
  if(found?.[0]) return found[0].value;
  const webpush = (await import('npm:web-push@3.6.7')).default;
  const value = webpush.generateVAPIDKeys();
  await db('private_config?on_conflict=key',{method:'POST',headers:{Prefer:'resolution=ignore-duplicates'},body:JSON.stringify({key:'vapid',value})});
  return (await db('private_config?select=value&key=eq.vapid&limit=1'))[0].value;
}
export async function notify(roles: string[], title: string, body: string, url: string) {
  const subscriptions = await db(`push_subscriptions?select=id,subscription&role=in.(${roles.join(',')})`).catch(()=>[]);
  if(!subscriptions.length) return;
  const config = await pushConfig();
  const webpush = (await import('npm:web-push@3.6.7')).default;
  await Promise.allSettled(subscriptions.map(async (row: any)=>{
    try { await webpush.sendNotification(row.subscription,JSON.stringify({title,body,url}),{vapidDetails:{subject:supabaseUrl,publicKey:config.publicKey,privateKey:config.privateKey},TTL:120,timeout:5000}); }
    catch(e) { if([404,410].includes((e as any).statusCode)) await db(`push_subscriptions?id=eq.${row.id}`,{method:'DELETE'}); else await incident('push',e); }
  }));
}
export function background(promise: Promise<unknown>) {
  if(typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(promise.catch(()=>{}));
  else promise.catch(()=>{});
}
export async function pushAction(req: Request, body: any, role: string) {
  if(body.action==='report-client-incident'){
    if(!(await budget(req,'client-report:'+role,30)))return reply({error:'Слишком много сообщений'},429);
    await incident('browser:'+role,new Error(String(body.message||'Ошибка приложения').slice(0,500)));return reply({ok:true});
  }
  if(body.action==='push-config') return reply({publicKey:(await pushConfig()).publicKey});
  if(body.action!=='push-subscribe') return null;
  const subscription=body.subscription; let endpoint: URL;
  try { endpoint=new URL(subscription?.endpoint); } catch { return reply({error:'Некорректная подписка'},400); }
  const allowed=['fcm.googleapis.com','push.services.mozilla.com','updates.push.services.mozilla.com','web.push.apple.com'];
  if(endpoint.protocol!=='https:' || (!allowed.includes(endpoint.hostname) && !endpoint.hostname.endsWith('.notify.windows.com')) || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return reply({error:'Некорректная подписка'},400);
  await db('push_subscriptions?on_conflict=endpoint',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({endpoint:endpoint.href,subscription,role,device_id:(req.headers.get('x-device-id')||'').slice(0,100)})});
  return reply({ok:true});
}
