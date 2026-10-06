const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.MENU_DEV_PORT || 4173);
const origin = `http://127.0.0.1:${port}`;
const upstream = 'https://gelezvudpcsnhqgjaqkl.supabase.co';
const ago = minutes => new Date(Date.now() - minutes * 60000).toISOString();
const uuid = () => crypto.randomUUID();
const pinHash = crypto.createHash('sha256').update('1').digest('hex');
const categories = ['Фаст-фуд', 'Роллы', 'Сеты', 'Пицца', 'Соусы', 'Напитки'];
const categoryIds = ['f', 'r', 's', 'p', 'sc', 'd'];
let store;
const media=new Map();
function reset(empty = false) {
  media.clear();
  const dishes = JSON.parse(fs.readFileSync(path.join(root, 'ref-products-dom.json'), 'utf8')).map((d, i) => ({
    id: i + 1, category_id: categoryIds[categories.indexOf(d.cat)] || 'f', name: d.name,
    weight: d.weight, description: d.desc, price: d.price, image_url: d.img,
    detail_image_url: d.detailImg, modifier_groups: [], is_available: i !== 4, is_popular: i < 6, popular_order: i + 1, sort_order: i,
  }));
  const tables = Array.from({ length: 8 }, (_, i) => ({ id: uuid(), table_number: i + 1,
    label: i === 2 ? 'У окна' : `Стол ${i + 1}`, qr_token: uuid(), is_active: i !== 7, created_at: ago(300), updated_at: ago(30) }));
  const sessions = empty ? [] : tables.slice(0, 4).map((t, i) => ({ id: uuid(), table_id: t.id, status: 'open', opened_at: ago(35 + i * 8), updated_at: ago(5) }));
  const orders = sessions.map((s, i) => ({ id: 1041 + i, table_session_id: s.id, guest_token: uuid(), status: ['submitted', 'preparing', 'ready', 'served'][i],
    payment_method: ['kaspi', 'card', 'cash', 'kaspi'][i], total: 3300 + i * 100, comment: i === 0 ? 'Без лука. У гостя аллергия на кунжут.' : '', created_at: ago(6 + i * 8), updated_at: ago(2) }));
  store = { restaurant_tables: tables, table_sessions: sessions, orders,
    order_items: orders.flatMap(o => [{ id: o.id * 2, order_id: o.id, dish_id: 1, name: dishes[0].name, quantity: 2, unit_price: 1100, line_total: 2200 },
      { id: o.id * 2 + 1, order_id: o.id, dish_id: 2, name: dishes[1].name, quantity: 1, unit_price: 1100, line_total: 1100 }]),
    service_requests: empty ? [] : [{ id: 501, table_session_id: sessions[0].id, guest_token: uuid(), kind: 'waiter', status: 'open', created_at: ago(10) },
      { id: 502, table_session_id: sessions[3].id, guest_token: uuid(), kind: 'bill', status: 'open', created_at: ago(3) }],
    staff_access: [{ id: 1, pin_hash: pinHash }], role_access:['admin','waiter','kitchen'].map(role=>({role,pin_hash:pinHash})), operation_events:[],order_status_events:[],incidents:[],private_config:[],push_subscriptions:[],shifts:[],site_settings:[{id:1,restaurant_name:'Суши Крейзи',currency:'KZT',timezone:'Asia/Qyzylorda',public_menu_enabled:false,schedule_open:'11:00',schedule_close:'22:40'}], categories: categories.map((name, i) => ({ id: categoryIds[i], name, sort_order: i, is_visible: true })), dishes };
}
reset();

// Execute the production handlers against an in-memory PostgREST adapter. No remote requests are made.
async function database(url, init = {}) {
  const parsed = new URL(url);
  if(parsed.pathname.startsWith('/storage/v1/object/')){media.set(parsed.pathname.split('/').pop(),{bytes:Buffer.from(init.body),mime:init.headers['Content-Type']});return new Response('{}',{headers:{'Content-Type':'application/json'}});}
  const table = parsed.pathname.split('/').pop();
  if(parsed.pathname.includes('/rpc/'))return mockRpc(table,JSON.parse(init.body||'{}'));
  if (!store[table]) return new Response(JSON.stringify({ error: 'Unknown table' }), { status: 404 });
  const params = parsed.searchParams;
  const matches = row => [...params].every(([key, filter]) => {
    if (['select', 'order', 'limit','offset','on_conflict'].includes(key)) return true;
    const dot = filter.indexOf('.'), op = filter.slice(0, dot), value = filter.slice(dot + 1);
    if (op === 'is') return value === 'null' ? row[key] == null : String(row[key]) === value;
    if (op === 'neq') return String(row[key]) !== value;
    if (op === 'eq') return String(row[key]) === value;
    if (op === 'gte') return row[key] >= value;
    if (op === 'in') return value.slice(1, -1).split(',').includes(String(row[key]));
    return true;
  });
  let rows = store[table].filter(matches);
  const method = init.method || 'GET';
  if (method === 'POST') {
    const input = JSON.parse(init.body);
    const nextId = Math.max(0, ...store[table].map(r => Number(r.id) || 0)) + 1;
    rows = (Array.isArray(input) ? input : [input]).map((row, index) => ({
      id: ['orders', 'order_items', 'service_requests','dishes','shifts','incidents','operation_events'].includes(table) ? nextId + index : uuid(),
      created_at: ago(0), updated_at: ago(0), opened_at: ago(0), qr_token: uuid(), ...row,
    }));
    if (table === 'restaurant_tables' && rows.some(r => store[table].some(t => String(t.table_number) === String(r.table_number))))
      return new Response(JSON.stringify({ error: 'duplicate table number' }), { status: 409 });
    if(params.has('on_conflict')) {for(const row of rows){const key=params.get('on_conflict'),existing=store[table].find(r=>r[key]===row[key]);if(existing)Object.assign(existing,row);else store[table].push(row);}}else store[table].push(...rows);
  } else if (method === 'PATCH') {
    const patch = JSON.parse(init.body);
    if (table === 'restaurant_tables' && patch.table_number && store[table].some(t => !rows.includes(t) && String(t.table_number) === String(patch.table_number)))
      return new Response(JSON.stringify({ error: 'duplicate table number' }), { status: 409 });
    rows.forEach(row => Object.assign(row, patch));
  }
  if (params.has('order')) rows = [...rows].sort((a, b) => {
    for (const field of params.get('order').split(',')) {
      const [key, dir] = field.split('.');
      const compare = typeof a[key] === 'number' ? a[key] - b[key] : String(a[key]).localeCompare(String(b[key]));
      if (compare) return dir === 'desc' ? -compare : compare;
    }
    return 0;
  });
  if(params.has('offset')) rows=rows.slice(Number(params.get('offset')));
  if (params.has('limit')) rows = rows.slice(0, Number(params.get('limit')));
  if (params.get('select')?.includes('order_items(')) rows = rows.map(row => ({ ...row, order_items: store.order_items.filter(i => i.order_id === row.id) }));
  return new Response(JSON.stringify(rows), { headers: { 'Content-Type': 'application/json' } });
}
const handlers = {};
for (const name of ['admin-api', 'staff-orders', 'table-api']) {
  require('./edge-loader.cjs')(path.join(root,'supabase/functions',name,'index.ts'),{
    Deno:{env:{get:key=>({SUPABASE_URL:origin,SUPABASE_SERVICE_ROLE_KEY:'local-only'})[key]},serve:fn=>handlers[name]=fn},
    fetch:database,crypto:crypto.webcrypto,TextEncoder,TextDecoder,Response,Request,Headers,URL,console,atob,btoa,Uint8Array,AbortSignal,AbortController
  });
}
let fault = false;
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = http.createServer(async (req, res) => {
  try {
    // The Pages preview uses a separate local origin from this isolated fixture API.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'content-type,x-admin-pin,x-admin-role,x-staff-pin,x-staff-role,x-device-id,apikey,authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,HEAD,OPTIONS');
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
    const url = new URL(req.url, origin);
    if(url.pathname==='/api/config'){res.setHeader('Content-Type','application/javascript');res.end('window.MenuConfig='+JSON.stringify({supabaseUrl:origin,publishableKey:'local-only'})+';');return;}
    if(url.pathname.startsWith('/storage/v1/object/public/restaurant-media/')){const item=media.get(url.pathname.split('/').pop());if(!item){res.writeHead(404);res.end();return;}res.setHeader('Content-Type',item.mime);res.end(item.bytes);return;}
    if(url.pathname.startsWith('/storage/v1/object/')&&req.method==='POST'){res.setHeader('Content-Type','application/json');res.end('{}');return;}
    if (url.pathname === '/__dev/reset' && req.method === 'POST') { reset(url.searchParams.has('empty')); res.end('reset'); return; }
    if (url.pathname === '/__dev/fault' && req.method === 'POST') { fault = url.searchParams.get('on') === '1'; res.end('ok'); return; }
    if (url.pathname === '/__dev/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(store)); return; }
    if (url.pathname.startsWith('/functions/v1/') || url.pathname.startsWith('/rest/v1/')) {
      if (fault) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'Нет связи с сервером' })); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const response = url.pathname.startsWith('/rest/v1/') ? await database(url.href, { method: req.method, body }) :
        await handlers[url.pathname.split('/').pop()](new Request(url.href, { method: req.method, headers: req.headers, ...(body ? { body } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    let file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname).slice(1);
    if(url.pathname==='/api/branding')file='icons/app-512.png';
    if (['admin', 'staff', 'kitchen'].includes(file)) file += '.html';
    if (file.startsWith('apple-emoji/')) file = file.replace('apple-emoji/', 'assets/emoji/').replace('.png', '.svg');
    const resolved = path.resolve(root, file);
    if (!resolved.startsWith(root + path.sep) || file.startsWith('.') || file.startsWith('scripts/') || file.startsWith('supabase/')) { res.writeHead(403); res.end(); return; }
    let data = await fs.promises.readFile(resolved);
    if (/\.(html|js)$/.test(file)) data = Buffer.from(data.toString().replaceAll(upstream, origin));
    const headers = { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', Vary: 'Accept-Encoding' };
    if (/\.(html|css|js|json|svg)$/.test(file) && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
      data = zlib.gzipSync(data); headers['Content-Encoding'] = 'gzip';
    }
    res.writeHead(200, headers); res.end(data);
  } catch (error) { res.writeHead(404); res.end('Not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Local isolated preview: ${origin}\nAdmin PIN: 1. Staff PIN: 1. Data resets when the server restarts.`));
function mockRpc(name,p){
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(name==='consume_request_budget')return response(true);
  if(name==='record_incident'){store.incidents.push({id:store.incidents.length+1,source:p.p_source,message:p.p_message,occurrences:1,last_seen_at:ago(0)});return response(null);}
  if(name==='change_order_status'){
    const o=store.orders.find(o=>o.id===p.p_order_id);if(!o)return response('not_found');if(o.status!==p.p_expected)return response('changed');
    const transitions={submitted:['accepted','preparing','cancelled'],accepted:['preparing','cancelled'],preparing:['ready'],ready:['served']};
    if(!transitions[o.status]?.includes(p.p_next))return response({message:'Invalid order transition',code:'23514'},400);
    store.order_status_events.push({id:store.order_status_events.length+1,order_id:o.id,from_status:o.status,to_status:p.p_next,created_at:ago(0),actor_role:p.p_role,device_id:p.p_device});
    o.status=p.p_next;o.updated_at=ago(0);store.operation_events.push({id:store.operation_events.length+1,role:p.p_role,action:'update-order:'+p.p_next,created_at:ago(0)});return response('updated');
  }
  if(name==='request_guest_service'){
    const s=store.table_sessions.find(s=>s.id===p.p_session_id&&s.status==='open');if(!s)return response({message:'Table session is closed',code:'23514'},400);
    if(store.service_requests.some(r=>r.table_session_id===s.id&&r.kind===p.p_kind&&r.status==='open'))return response(false);
    store.service_requests.push({id:Math.max(0,...store.service_requests.map(r=>r.id))+1,table_session_id:s.id,guest_token:p.p_guest_token,kind:p.p_kind,status:'open',created_at:ago(0)});return response(true);
  }
  if(name==='place_guest_order'){
    const table=store.restaurant_tables.find(t=>t.qr_token===p.p_table_token&&t.is_active);if(!table)return response({message:'Table not found or QR disabled',code:'23514'},400);
    const duplicate=store.orders.find(o=>o.guest_token===p.p_guest_token&&o.client_request_id===p.p_request_id);if(duplicate)return response({orderId:duplicate.id,sessionId:duplicate.table_session_id,duplicate:true});
    let session=store.table_sessions.find(s=>s.table_id===table.id&&s.status==='open');
    if(p.p_session_id&&session?.id!==p.p_session_id)return response({message:'Table session is closed',code:'23514'},400);
    const rows=[];let total=0;
    for(const item of p.p_items||[]){const d=store.dishes.find(d=>d.id===item.id&&d.is_available);if(!d)return response({message:'One or more dishes are unavailable',code:'23514'},400);let price=d.price;const modifiers=[];
      for(const c of item.modifiers||[]){const g=d.modifier_groups.find(g=>g.id===c.groupId),o=g?.options.find(o=>o.id===c.optionId&&o.is_available);if(!o)return response({message:'Invalid dish options',code:'23514'},400);price+=o.price_delta;modifiers.push({...c,name:o.name,price_delta:o.price_delta});}
      if(price!==item.unitPrice||item.quantity<1||item.quantity>20)return response({message:'Menu prices changed',code:'23514'},400);
      for(const g of d.modifier_groups){const count=(item.modifiers||[]).filter(c=>c.groupId===g.id).length;if(count<g.min||count>g.max)return response({message:'Choose dish options',code:'23514'},400);}
      total+=price*item.quantity;rows.push({dish_id:d.id,name:d.name,quantity:item.quantity,unit_price:price,line_total:price*item.quantity,item_comment:modifiers.map(m=>m.name).join(', '),modifiers});}
    if(!rows.length)return response({message:'Invalid order items',code:'23514'},400);
    if(!session){session={id:uuid(),table_id:table.id,status:'open',opened_at:ago(0)};store.table_sessions.push(session);}
    const id=Math.max(0,...store.orders.map(o=>o.id))+1;
    store.orders.push({id,table_session_id:session.id,guest_token:p.p_guest_token,client_request_id:p.p_request_id,status:'submitted',payment_method:p.p_payment_method,comment:p.p_comment,total,created_at:ago(0),updated_at:ago(0)});
    store.order_items.push(...rows.map((r,i)=>({...r,id:store.order_items.length+i+1,order_id:id})));return response({orderId:id,sessionId:session.id,duplicate:false});
  }
  if(name==='confirm_order_payment'){const o=store.orders.find(o=>o.id===p.p_order_id);if(!o)return response('not_found');if(o.status==='cancelled')return response('cancelled');if(o.paid_at)return response('already_paid');o.paid_at=ago(0);o.paid_role=p.p_role;o.payment_method=p.p_method;o.paid_shift_id=store.shifts.find(s=>!s.closed_at)?.id||null;return response('paid');}
  if(name==='close_table_session_if_idle'){const s=store.table_sessions.find(s=>s.id===p.p_session_id&&s.status==='open');if(!s)return response('not_open');const orders=store.orders.filter(o=>o.table_session_id===s.id);if(orders.some(o=>['submitted','accepted','preparing','ready'].includes(o.status)))return response('active_orders');if(orders.some(o=>o.status!=='cancelled'&&!o.paid_at))return response('unpaid_orders');if(store.service_requests.some(r=>r.table_session_id===s.id&&r.status==='open'))return response('open_requests');s.status='closed';s.closed_at=ago(0);return response('closed');}
  if(name==='manage_shift'){let s=store.shifts.find(s=>!s.closed_at);if(p.p_action==='open'){if(!s){s={id:store.shifts.length+1,opened_at:ago(0)};store.shifts.push(s);}}else{if(!s||store.orders.some(o=>!o.paid_at&&o.status!=='cancelled'))return response({message:'Сначала завершите заказы и оплату',code:'23514'},400);s.closed_at=ago(0);s.summary={paid:store.orders.filter(o=>o.paid_shift_id===s.id).reduce((sum,o)=>sum+o.total,0),orders:store.orders.filter(o=>o.paid_shift_id===s.id).length};}return response(s.id);}
  if(name==='import_menu_rows'||name==='import_menu_once'){for(const r of p.p_rows){let c=store.categories.find(c=>c.name===r.category);if(!c){c={id:uuid(),name:r.category,is_visible:true,sort_order:store.categories.length};store.categories.push(c);}store.dishes.push({...r,id:Math.max(0,...store.dishes.map(d=>d.id))+1,category_id:c.id,modifier_groups:[]});}return response(p.p_rows.length);}
  return response({message:'Unknown RPC'},404);
}
