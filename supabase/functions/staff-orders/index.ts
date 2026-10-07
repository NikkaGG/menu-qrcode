import { authenticate, audit, incident, pushAction, notify, background, broadcastOrderChange, broadcastTableChange } from '../_shared/product.ts';
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-staff-pin, x-staff-role, x-device-id, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

type StaffRole = "owner" | "admin" | "waiter" | "kitchen";
type StaffActor = { id: number; name: string; role: StaffRole; temporary?: boolean };

const staffRoles = new Set<StaffRole>(["owner", "admin", "waiter", "kitchen"]);
const actionRoles: Record<string, StaffRole[]> = {
  dashboard: ["owner", "admin", "waiter", "kitchen"],
  "update-order": ["owner", "admin", "waiter", "kitchen"],
  "resolve-request": ["owner", "admin", "waiter"],
  "close-session": ["owner", "admin", "waiter"],
  "confirm-payment": ["admin", "waiter"],
};

function reply(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: cors });
}

async function db(path: string, init: RequestInit = {}) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let data: any = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = text; }
  }
  if (!res.ok) {
    const message = typeof data === "string" ? data : String(data?.message || data?.details || JSON.stringify(data));
    const error = new Error(message) as Error & { status?: number };
    error.status = res.status;
    throw error;
  }
  return data;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanRole(value: unknown): StaffRole | "" {
  const role = String(value || "").trim().toLowerCase() as StaffRole;
  return staffRoles.has(role) ? role : "";
}

async function authenticateStaff(req: Request, pin: string, requestedRole: unknown): Promise<StaffActor | null> {
  return authenticate(req,pin,String(requestedRole||''));
}

function isAllowed(actor: StaffActor, action: string) {
  return Boolean(actionRoles[action]?.includes(actor.role));
}

async function dashboard(actor: StaffActor) {
  const [tablesRaw, sessionsRaw] = await Promise.all([
    db("restaurant_tables?select=id,table_number,label,is_active&is_active=eq.true&order=table_number.asc"),
    db("table_sessions?select=id,table_id,status,opened_at,closed_at,updated_at&status=eq.open&order=opened_at.asc"),
  ]);
  const tables = Array.isArray(tablesRaw) ? tablesRaw : [];
  const sessions = Array.isArray(sessionsRaw) ? sessionsRaw : [];
  const sessionIds = sessions.map((session: any) => String(session.id)).filter(Boolean);

  if (!sessionIds.length) {
    return {
      actor: { id: actor.id, name: actor.name, role: actor.role },
      tables,
      sessions: [],
      orders: [],
      items: [],
      requests: [],
    };
  }

  const [ordersRaw, requestsRaw] = await Promise.all([
    db(`orders?select=id,table_session_id,status,payment_method,paid_at,paid_role,comment,total,created_at,updated_at&table_session_id=in.(${sessionIds.join(",")})&order=created_at.asc`),
    actor.role === "kitchen"
      ? Promise.resolve([])
      : db(`service_requests?select=id,table_session_id,kind,status,created_at,resolved_at,updated_at&table_session_id=in.(${sessionIds.join(",")})&status=eq.open&order=created_at.asc`),
  ]);

  const openOrders = Array.isArray(ordersRaw) ? ordersRaw : [];
  const visibleOrders = actor.role === "kitchen"
    ? openOrders
        .filter((order: any) => !["served", "cancelled"].includes(String(order.status || "")))
        .map((order: any) => ({
          id: order.id,
          table_session_id: order.table_session_id,
          status: order.status,
          comment: order.comment,
          created_at: order.created_at,
          updated_at: order.updated_at,
        }))
    : openOrders;

  const orderIds = visibleOrders.map((order: any) => Number(order.id))
    .filter((id: number) => Number.isInteger(id) && id > 0);
  const itemSelect = actor.role === "kitchen"
    ? "id,order_id,dish_id,name,quantity,item_comment"
    : "id,order_id,dish_id,name,quantity,unit_price,line_total,item_comment";
  const itemsRaw = orderIds.length
    ? await db(`order_items?select=${itemSelect}&order_id=in.(${orderIds.join(",")})&order=order_id.asc,id.asc`)
    : [];

  return {
    actor: { id: actor.id, name: actor.name, role: actor.role },
    tables,
    sessions,
    orders: visibleOrders,
    items: Array.isArray(itemsRaw) ? itemsRaw : [],
    requests: Array.isArray(requestsRaw) ? requestsRaw : [],
  };
}

const transitions: Record<string, string[]> = {
  submitted: ["accepted", "preparing", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready"],
  ready: ["served"],
  served: [],
  cancelled: [],
};

function roleCanTransition(role: StaffRole, current: string, next: string) {
  if (!transitions[current]?.includes(next)) return false;
  if (role === "owner" || role === "admin") return true;
  if (role === "kitchen") {
    if (next === "cancelled") return ["submitted", "accepted"].includes(current);
    return (current === "submitted" || current === "accepted") && next === "preparing"
      || current === "preparing" && next === "ready";
  }
  if (role === "waiter") return current === "ready" && next === "served"
    || ["submitted","accepted"].includes(current) && next === "cancelled";
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const pin = req.headers.get("x-staff-pin") || String(body?.pin || "");
    const requestedRole = req.headers.get("x-staff-role") || body?.role;
    const actor = await authenticateStaff(req, pin, requestedRole);
    if (!actor) return reply({ error: "Неверный PIN для выбранной роли" }, 401);

    const pushReply=await pushAction(req,body,actor.role); if(pushReply) return pushReply;
    const action = String(body?.action || "dashboard");
    if(action === "confirm-payment") {
      if(!["waiter","admin"].includes(actor.role)) return reply({error:"Доступ запрещён"},403);
      const id=Number(body.orderId);
      if(!Number.isInteger(id)||id<=0||!["cash","card","kaspi"].includes(String(body.paymentMethod))) return reply({error:"Проверьте заказ и способ оплаты"},400);
      const result=await db("rpc/confirm_order_payment",{method:"POST",body:JSON.stringify({p_order_id:id,p_method:String(body.paymentMethod||""),p_role:actor.role,p_device:req.headers.get("x-device-id")||""})});
      if(!["paid","already_paid"].includes(result)) return reply({error:result==="cancelled"?"Отменённый заказ нельзя оплатить":"Заказ не найден"},409);
      background(broadcastOrderChange(id));
      return reply({ok:true,...await dashboard(actor)});
    }
    if (!isAllowed(actor, action)) return reply({ error: "Недостаточно прав для этого действия" }, 403);
    if (action === "dashboard") return reply(await dashboard(actor));

    if (action === "update-order") {
      const orderId = Number(body?.orderId);
      const next = String(body?.status || "");
      if (!Number.isInteger(orderId) || orderId <= 0) return reply({ error: "Invalid order" }, 400);

      const rows = await db(`orders?select=id,status&id=eq.${orderId}&limit=1`);
      const order = Array.isArray(rows) ? rows[0] : null;
      if (!order) return reply({ error: "Order not found" }, 404);
      if (!roleCanTransition(actor.role, String(order.status || ""), next)) {
        return reply({ error: "Недостаточно прав или недопустимый переход статуса" }, 403);
      }

      const updated=await db("rpc/change_order_status",{method:"POST",body:JSON.stringify({p_order_id:orderId,p_expected:order.status,p_next:next,p_role:actor.role,p_device:req.headers.get("x-device-id")||""})});
      if(updated!=="updated") return reply({error:"Заказ уже изменён на другом экране. Обновите данные"},409);
      background(broadcastOrderChange(orderId));
      if(action==="update-order"&&body.status==="ready") background(notify(["waiter"],"Заказ готов",`Заказ #${body.orderId}`,"/staff"));
      return reply({ ok: true, ...(await dashboard(actor)) });
    }

    if (action === "resolve-request") {
      const requestId = Number(body?.requestId);
      if (!Number.isInteger(requestId) || requestId <= 0) return reply({ error: "Invalid request" }, 400);
      await db(`service_requests?id=eq.${requestId}&status=eq.open`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      await audit(req,actor.role,action,requestId);
      return reply({ ok: true, ...(await dashboard(actor)) });
    }

    if (action === "close-session") {
      const sessionId = String(body?.sessionId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return reply({ error: "Invalid session" }, 400);

      const result = await db("rpc/close_table_session_if_idle", {
        method: "POST",
        body: JSON.stringify({ p_session_id: sessionId }),
      });
      const outcome = typeof result === "string" ? result : Array.isArray(result) ? result[0] : result;
      if (outcome === "active_orders") return reply({ error: "Сначала завершите активные заказы этого стола" }, 409);
      if (outcome === "unpaid_orders") return reply({ error: "Сначала подтвердите оплату всех заказов" }, 409);
      if (outcome === "open_requests") return reply({ error: "Сначала выполните запросы гостей" }, 409);
      if (outcome !== "closed") return reply({ error: "Стол уже закрыт или недоступен" }, 409);

      await audit(req,actor.role,action,sessionId);
      background(broadcastTableChange(sessionId));
      return reply({ ok: true, ...(await dashboard(actor)) });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    if((error as any).status===429) return reply({error:(error as Error).message},429);
    if((error as any).code==="23514") return reply({error:"Заказ уже изменён или отмена запрещена"},409);
    await incident("staff-orders",error);
    return reply({ error: "Сервис временно недоступен" }, 500);
  }
});
