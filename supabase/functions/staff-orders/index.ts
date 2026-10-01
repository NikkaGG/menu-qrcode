const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-staff-pin, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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
  if (!res.ok) throw new Error(`DB ${res.status}: ${typeof data === "string" ? data : JSON.stringify(data)}`);
  return data;
}

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function staffPinOk(pin: string) {
  if (!/^\d{4,10}$/.test(pin)) return false;
  const rows = await db("staff_access?select=pin_hash&id=eq.1&limit=1");
  const expected = Array.isArray(rows) ? rows[0]?.pin_hash : "";
  return Boolean(expected) && (await sha256(pin)) === expected;
}

async function dashboard() {
  const [tables, sessions, orders, items, requests] = await Promise.all([
    db("restaurant_tables?select=id,table_number,label,is_active&is_active=eq.true&order=table_number.asc"),
    db("table_sessions?select=id,table_id,status,opened_at,closed_at,updated_at&status=eq.open&order=opened_at.asc"),
    db("orders?select=id,table_session_id,status,payment_method,comment,total,created_at,updated_at&order=created_at.asc"),
    db("order_items?select=id,order_id,dish_id,name,quantity,unit_price,line_total,item_comment&order=id.asc"),
    db("service_requests?select=id,table_session_id,kind,status,created_at,resolved_at,updated_at&status=eq.open&order=created_at.asc"),
  ]);
  const openIds = new Set((Array.isArray(sessions) ? sessions : []).map((s: any) => s.id));
  const openOrders = (Array.isArray(orders) ? orders : []).filter((o: any) => openIds.has(o.table_session_id));
  const orderIds = new Set(openOrders.map((o: any) => Number(o.id)));
  return {
    tables: Array.isArray(tables) ? tables : [],
    sessions: Array.isArray(sessions) ? sessions : [],
    orders: openOrders,
    items: (Array.isArray(items) ? items : []).filter((i: any) => orderIds.has(Number(i.order_id))),
    requests: (Array.isArray(requests) ? requests : []).filter((r: any) => openIds.has(r.table_session_id)),
  };
}

const transitions: Record<string, string[]> = {
  submitted: ["accepted", "preparing", "cancelled"],
  accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["served"],
  served: [],
  cancelled: [],
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const pin = req.headers.get("x-staff-pin") || String(body?.pin || "");
    if (!(await staffPinOk(pin))) return reply({ error: "Неверный PIN" }, 401);

    const action = String(body?.action || "dashboard");
    if (action === "dashboard") return reply(await dashboard());

    if (action === "update-order") {
      const orderId = Number(body?.orderId);
      const next = String(body?.status || "");
      if (!Number.isInteger(orderId) || orderId <= 0) return reply({ error: "Invalid order" }, 400);

      const rows = await db(`orders?select=id,status&id=eq.${orderId}&limit=1`);
      const order = Array.isArray(rows) ? rows[0] : null;
      if (!order) return reply({ error: "Order not found" }, 404);
      if (!(transitions[order.status] || []).includes(next)) return reply({ error: "Недопустимый переход статуса" }, 409);

      await db(`orders?id=eq.${orderId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: next, updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await dashboard()) });
    }

    if (action === "resolve-request") {
      const requestId = Number(body?.requestId);
      if (!Number.isInteger(requestId) || requestId <= 0) return reply({ error: "Invalid request" }, 400);
      await db(`service_requests?id=eq.${requestId}&status=eq.open`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await dashboard()) });
    }

    if (action === "close-session") {
      const sessionId = String(body?.sessionId || "").trim();
      if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return reply({ error: "Invalid session" }, 400);
      const active = await db(
        `orders?select=id,status&table_session_id=eq.${encodeURIComponent(sessionId)}&status=in.(submitted,accepted,preparing,ready)&limit=1`
      );
      if (Array.isArray(active) && active.length) return reply({ error: "Сначала завершите активные заказы этого стола" }, 409);

      await db(`table_sessions?id=eq.${encodeURIComponent(sessionId)}&status=eq.open`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "closed", closed_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      await db(`service_requests?table_session_id=eq.${encodeURIComponent(sessionId)}&status=eq.open`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "resolved", resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await dashboard()) });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return reply({ error: "Server error" }, 500);
  }
});