import { db, reply, settings, pinHash, audit, incident, uuid, supabaseUrl, serviceKey } from '../_shared/product.ts';

function asset(value: unknown) {
  const s=String(value||'').trim().slice(0,1000);
  if(!s) return null;
  if(s.startsWith('/')&&!s.startsWith('//')) return s;
  const u=new URL(s); if(u.protocol!=='https:') throw new Error('Укажите HTTPS-ссылку на изображение'); return s;
}
export function normalizeGroups(input: any) {
  if(!Array.isArray(input)||input.length>12) throw new Error('Не больше 12 групп вариантов');
  const ids=new Set();
  return input.map((g:any)=>{
    const id=String(g.id||crypto.randomUUID()),name=String(g.name||'').trim().slice(0,80),min=Number(g.min||0),max=Number(g.max||1);
    if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id)||ids.has(id)||!name||!Number.isInteger(min)||!Number.isInteger(max)||min<0||max<1||max>20||min>max||!Array.isArray(g.options)||!g.options.length||g.options.length>20) throw new Error('Проверьте группу вариантов');
    ids.add(id);const optionIds=new Set();
    const options=g.options.map((o:any)=>{
      const oid=String(o.id||crypto.randomUUID()),label=String(o.name||'').trim().slice(0,80),price=Number(o.price_delta||0);
      if(!/^[a-zA-Z0-9_-]{1,80}$/.test(oid)||optionIds.has(oid)||!label||!Number.isInteger(price)||price<0||price>1000000) throw new Error('Проверьте название и доплату');
      optionIds.add(oid);return {id:oid,name:label,price_delta:price,is_available:o.is_available!==false};
    });
    if(min>options.filter((o:any)=>o.is_available).length||max>options.length) throw new Error('Недостаточно доступных вариантов');
    return {id,name,min,max,options};
  });
}
async function all(path:string) {
  const result:any[]=[];for(let offset=0;;offset+=500){const rows=await db(`${path}&limit=500&offset=${offset}`);result.push(...rows);if(rows.length<500)return result;}
}
export async function financial() {
  const since=new Date(Date.now()-30*86400000).toISOString();
  const [paid,unpaid,activity,shifts]=await Promise.all([
    all(`orders?select=id,table_session_id,total,paid_at,payment_method&paid_at=gte.${encodeURIComponent(since)}&order=paid_at.asc`),
    all('orders?select=id,table_session_id,total,status,created_at&paid_at=is.null&status=neq.cancelled&order=created_at.asc'),
    all(`operation_events?select=role,action,created_at&created_at=gte.${encodeURIComponent(since)}&order=created_at.asc`),
    db('shifts?select=*&order=opened_at.desc&limit=30')
  ]);
  const sum=(rows:any[])=>rows.reduce((s,o)=>s+Number(o.total),0);
  const current=shifts.find((s:any)=>!s.closed_at);
  const shiftPaid=current?await all(`orders?select=id,total,payment_method&paid_shift_id=eq.${current.id}&order=paid_at.asc`):[];
  const roles=['admin','waiter','kitchen'].map(role=>({role,actions:activity.filter(x=>x.role===role).length,payments:activity.filter(x=>x.role===role&&x.action==='confirm-payment').length}));
  return {paid30:sum(paid),paid24:sum(paid.filter(o=>Date.parse(o.paid_at)>Date.now()-86400000)),paidOrders30:paid.length,averagePaidCheck:paid.length?Math.round(sum(paid)/paid.length):0,unpaidTotal:sum(unpaid),unpaidOrders:unpaid.length,unpaidTables:new Set(unpaid.map(o=>o.table_session_id)).size,roles,shifts,shiftPaid:sum(shiftPaid),shiftPaidOrders:shiftPaid.length};
}
export async function productAction(req: Request,body:any):Promise<Response|null> {
  const action=String(body.action||'');
  const actions=['settings','save-settings','role-access','set-role-pin','incidents','resolve-incident','report-incident','financial','open-shift','close-shift','upload-image','save-modifiers','import-menu'];
  if(!actions.includes(action))return null;
  try {
    if(action==='settings')return reply({settings:await settings()});
    if(action==='save-settings') {
      const input=body.settings||{},clean:any={updated_at:new Date().toISOString()};
      for(const key of ['restaurant_name','subtitle','city','schedule_open','schedule_close','phone_number','whatsapp_number','address_text','map_url','instagram_url','canonical_url']) clean[key]=String(input[key]||'').trim().slice(0,key.endsWith('_url')?1000:200);
      if(!clean.restaurant_name)throw new Error('Укажите название ресторана');
      for(const key of ['map_url','instagram_url','canonical_url'])if(clean[key]&&new URL(clean[key]).protocol!=='https:')throw new Error('Ссылки должны начинаться с https://');
      clean.timezone=String(input.timezone||'Asia/Qyzylorda');new Intl.DateTimeFormat('ru',{timeZone:clean.timezone});
      if(input.currency&&input.currency!=='KZT')throw new Error('В этой версии расчёт в тенге');
      clean.currency='KZT';clean.logo_url=asset(input.logo_url);clean.banner_url=asset(input.banner_url);clean.public_menu_enabled=input.public_menu_enabled===true;
      await db('site_settings?on_conflict=id',{method:'POST',headers:{Prefer:'resolution=merge-duplicates'},body:JSON.stringify({id:1,...clean})});
      await audit(req,'admin',action);return reply({ok:true,settings:await settings()});
    }
    if(action==='role-access')return reply({roles:await db('role_access?select=role,updated_at&order=role.asc')});
    if(action==='set-role-pin') {
      const role=String(body.role),pin=String(body.newPin||'');
      if(!['admin','waiter','kitchen'].includes(role)||!/^\d{1,12}$/.test(pin))throw new Error('PIN должен содержать от 1 до 12 цифр');
      await db(`role_access?role=eq.${role}`,{method:'PATCH',body:JSON.stringify({pin_hash:await pinHash(pin),updated_at:new Date().toISOString()})});
      await audit(req,'admin',action,role);return reply({ok:true});
    }
    if(action==='incidents')return reply({incidents:await db('incidents?select=*&order=last_seen_at.desc&limit=100')});
    if(action==='resolve-incident') {
      const id=Number(body.id);if(!Number.isInteger(id)||id<=0)throw new Error('Некорректное уведомление');
      await db(`incidents?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({resolved_at:new Date().toISOString()})});return reply({ok:true});
    }
    if(action==='report-incident') {
      const source='browser:'+String(body.source||'admin').slice(0,50),message=String(body.message||'Ошибка соединения').slice(0,500);
      const fingerprint=source+':'+message;
      await db('rpc/record_incident',{method:'POST',body:JSON.stringify({p_source:source,p_message:message,p_fingerprint:fingerprint})});return reply({ok:true});
    }
    if(action==='financial')return reply({financial:await financial()});
    if(action==='open-shift'||action==='close-shift') {
      return reply({error:'Смены открываются и закрываются автоматически по времени ресторана'},409);
    }
    if(action==='upload-image') {
      const mime=String(body.mime||''),encoded=String(body.data||'');
      if(!['image/jpeg','image/png','image/webp'].includes(mime)||encoded.length>7000000)throw new Error('Фото должно быть JPG, PNG или WebP, до 5 МБ');
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      if(!bytes.length||bytes.length>5242880)throw new Error('Некорректное фото');
      const valid=mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/png'?bytes[0]===137&&bytes[1]===80&&bytes[2]===78: new TextDecoder().decode(bytes.slice(0,4))==='RIFF'&&new TextDecoder().decode(bytes.slice(8,12))==='WEBP';
      if(!valid)throw new Error('Содержимое файла не соответствует формату');
      const path=crypto.randomUUID()+'.'+({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[mime]);
      const r=await fetch(`${supabaseUrl}/storage/v1/object/restaurant-media/${path}`,{method:'POST',headers:{apikey:serviceKey,Authorization:`Bearer ${serviceKey}`,'Content-Type':mime},body:bytes});
      if(!r.ok)throw new Error('Не удалось загрузить фото');
      return reply({ok:true,url:`${supabaseUrl}/storage/v1/object/public/restaurant-media/${path}`});
    }
    if(action==='save-modifiers') {
      const id=Number(body.dishId);if(!Number.isInteger(id)||id<=0)throw new Error('Некорректное блюдо');
      const groups=normalizeGroups(body.groups);
      await db(`dishes?id=eq.${id}`,{method:'PATCH',body:JSON.stringify({modifier_groups:groups,updated_at:new Date().toISOString()})});
      await audit(req,'admin',action,id);return reply({ok:true,groups});
    }
    if(action==='import-menu') {
      const importId=uuid(body.importId);if(!importId)throw new Error('Некорректный номер импорта');
      if(!Array.isArray(body.rows)||!body.rows.length||body.rows.length>500)throw new Error('От 1 до 500 строк за импорт');
      const rows=body.rows.map((r:any)=>{
        const name=String(r.name||'').trim(),category=String(r.category||'').trim(),price=Number(r.price);
        if(!name||name.length>140||!category||!Number.isInteger(price)||price<0||price>1000000)throw new Error('Проверьте названия, категории и цены');
        const image=asset(r.image_url);return {name,category,price,weight:String(r.weight||'').slice(0,120),description:String(r.description||'').slice(0,2000),image_url:image,is_available:r.is_available!==false};
      });
      const result=await db('rpc/import_menu_once',{method:'POST',body:JSON.stringify({p_rows:rows,p_request_id:importId})});
      await audit(req,'admin',action,result);return reply({ok:true,imported:result});
    }
    return null;
  } catch(e) { if((e as any).status>=500) {await incident('admin-product',e);return reply({error:'Сервис временно недоступен'},500);} return reply({error:(e as Error).message||'Проверьте введённые данные'},(e as any).code==='23514'?409:400); }
}
