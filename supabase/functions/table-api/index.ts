import { db, reply, cors, uuid, budget, incident, notify, background, settings } from '../_shared/product.ts';

async function state(sessionId: string, guest: string) {
  if(!sessionId) return {orders:[],requests:[]};
  const [orders,requests] = await Promise.all([
    db(`orders?select=id,guest_token,status,payment_method,paid_at,comment,total,created_at,updated_at,order_items(id,dish_id,name,quantity,unit_price,line_total,item_comment,modifiers)&table_session_id=eq.${sessionId}&order=created_at.desc`),
    db(`service_requests?select=id,kind,status,created_at,resolved_at&table_session_id=eq.${sessionId}&order=created_at.desc`)
  ]);
  return {orders:orders.map((o: any)=>{const {guest_token,...rest}=o; return {...rest,isMine:guest_token===guest};}),requests};
}
Deno.serve(async (req: Request)=>{
  if(req.method==='OPTIONS') return new Response('',{headers:cors});
  if(req.method!=='POST') return reply({error:'Method not allowed'},405);
  try {
    const body=await req.json();
    if(body.action==='public-settings') return reply({settings:await settings()});
    const tableToken=uuid(body.tableToken),guestToken=uuid(body.guestToken);
    if(!tableToken||!guestToken) return reply({error:'Invalid table or guest token'},400);
    if(!(await budget(req,'guest:'+guestToken,90))) return reply({error:'Слишком много запросов. Подождите минуту.'},429);
    const tables=await db(`restaurant_tables?select=id,table_number,label&qr_token=eq.${tableToken}&is_active=eq.true&limit=1`);
    const table=tables?.[0]; if(!table) return reply({error:'Table not found or QR disabled'},404);
    let session=(await db(`table_sessions?select=id,table_id,status,opened_at&table_id=eq.${table.id}&status=eq.open&limit=1`))?.[0]||null;
    if(body.action==='bootstrap'||body.action==='status') return reply({table,session,...await state(session?.id||'',guestToken)});
    if(body.action==='place-order') {
      const requestId=uuid(body.clientRequestId);
      if(!requestId) return reply({error:'Invalid order request id'},400);
      const result=await db('rpc/place_guest_order',{method:'POST',body:JSON.stringify({p_table_token:tableToken,p_guest_token:guestToken,p_request_id:requestId,p_session_id:uuid(body.sessionId)||null,p_payment_method:body.paymentMethod,p_comment:String(body.comment||''),p_items:body.items})});
      session=(await db(`table_sessions?select=id,table_id,status,opened_at&id=eq.${result.sessionId}&limit=1`))[0];
      if(!result.duplicate) background(notify(['kitchen'],'Новый заказ',`Стол ${table.table_number} · #${result.orderId}`,'/kitchen'));
      return reply({ok:true,...result,table,session,...await state(session.id,guestToken)},result.duplicate?200:201);
    }
    if(body.action==='service') {
      if(!session) return reply({error:'Сначала отправьте первый заказ'},409);
      if(!['waiter','bill','cutlery'].includes(body.kind)) return reply({error:'Invalid service request'},400);
      if(body.sessionId&&uuid(body.sessionId)!==session.id)return reply({error:'Table session is closed'},409);
      const inserted=await db('rpc/request_guest_service',{method:'POST',body:JSON.stringify({p_session_id:session.id,p_guest_token:guestToken,p_kind:body.kind})});
      if(inserted)background(notify(['waiter'],'Запрос гостя',`Стол ${table.table_number}`,'/staff'));
      return reply({ok:true,table,session,...await state(session.id,guestToken)});
    }
    return reply({error:'Unknown action'},400);
  } catch(e) {
    if((e as any).code==='23514'||(e as any).code==='22P02') return reply({error:(e as Error).message},409);
    if(e instanceof SyntaxError) return reply({error:'Invalid JSON body'},400);
    await incident('table-api',e); return reply({error:'Сервис временно недоступен'},500);
  }
});
