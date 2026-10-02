const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, apikey, authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const secretKeys = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}");
const serviceKey = secretKeys.default || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function response(body: unknown, status = 200) {
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

function cleanUuid(value: unknown) {
  const s = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s) ? s : "";
}

async function resolveTable(tableToken: string) {
  const rows = await db(
    `restaurant_tables?select=id,table_number,label&qr_token=eq.${encodeURIComponent(tableToken)}&is_active=eq.true&limit=1`
  );
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function getOrCreateSession(tableId: string) {
  let rows = await db(
    `table_sessions?select=id,table_id,status,opened_at&table_id=eq.${encodeURIComponent(tableId)}&status=eq.open&order=opened_at.desc&limit=1`
  );
  if (Array.isArray(rows) && rows[0]) return rows[0];

  try {
    rows = await db("table_sessions?select=id,table_id,status,opened_at", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify([{ table_id: tableId, status: "open" }]),
    });
    if (Array.isArray(rows) && rows[0]) return rows[0];
  } catch (_) {
    rows = await db(
      `table_sessions?select=id,table_id,status,opened_at&table_id=eq.${encodeURIComponent(tableId)}&status=eq.open&order=opened_at.desc&limit=1`
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
    throw _;
  }
  throw new Error("Could not create table session");
}

async function guestState(sessionId: string, guestToken: string) {
  const [orders, requests] = await Promise.all([
    db(
      `orders?select=id,status,payment_method,comment,total,created_at,updated_at,order_items(id,dish_id,name,quantity,unit_price,line_total,item_comment)&table_session_id=eq.${encodeURIComponent(sessionId)}&guest_token=eq.${encodeURIComponent(guestToken)}&order=created_at.desc`
    ),
    db(
      `service_requests?select=id,kind,status,created_at,resolved_at&table_session_id=eq.${encodeURIComponent(sessionId)}&guest_token=eq.${encodeURIComponent(guestToken)}&order=created_at.desc`
    ),
  ]);
  return { orders: Array.isArray(orders) ? orders : [], requests: Array.isArray(requests) ? requests : [] };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action = String(body?.action || "");
    const tableToken = cleanUuid(body?.tableToken);
    const guestToken = cleanUuid(body?.guestToken);
    if (!tableToken || !guestToken) return response({ error: "Invalid table or guest token" }, 400);

    const table = await resolveTable(tableToken);
    if (!table) return response({ error: "Table not found or QR disabled" }, 404);
    const session = await getOrCreateSession(table.id);

    if (action === "bootstrap" || action === "status") {
      const state = await guestState(session.id, guestToken);
      return response({ table, session, ...state });
    }

    if (action === "place-order") {
      const clientRequestId = cleanUuid(body?.clientRequestId);
      if (!clientRequestId) return response({ error: "Invalid order request id" }, 400);

      const existingRows = await db(
        `orders?select=id,status&table_session_id=eq.${encodeURIComponent(session.id)}&guest_token=eq.${encodeURIComponent(guestToken)}&client_request_id=eq.${encodeURIComponent(clientRequestId)}&limit=1`
      );
      const existing = Array.isArray(existingRows) ? existingRows[0] : null;
      if (existing) {
        const state = await guestState(session.id, guestToken);
        return response({ ok: true, duplicate: true, orderId: existing.id, table, session, ...state });
      }

      const paymentMethod = String(body?.paymentMethod || "");
      if (!["card", "cash", "kaspi"].includes(paymentMethod)) {
        return response({ error: "Choose a payment method" }, 400);
      }

      const rawItems = Array.isArray(body?.items) ? body.items : [];
      const normalized = rawItems
        .map((item: any) => ({ id: Number(item?.id), quantity: Number(item?.quantity) }))
        .filter((item: any) => Number.isInteger(item.id) && item.id > 0 && Number.isInteger(item.quantity) && item.quantity > 0 && item.quantity <= 20);
      if (!normalized.length || normalized.length !== rawItems.length) {
        return response({ error: "Invalid order items" }, 400);
      }

      const ids = [...new Set(normalized.map((item: any) => item.id))];
      const dishes = await db(
        `dishes?select=id,name,price,is_available&id=in.(${ids.join(",")})&is_available=eq.true`
      );
      const byId = new Map((Array.isArray(dishes) ? dishes : []).map((dish: any) => [Number(dish.id), dish]));
      if (ids.some((id: number) => !byId.has(id))) return response({ error: "One or more dishes are unavailable" }, 409);

      const items = normalized.map((item: any) => {
        const dish: any = byId.get(item.id);
        const unitPrice = Number(dish.price) || 0;
        return {
          dish_id: item.id,
          name: String(dish.name),
          quantity: item.quantity,
          unit_price: unitPrice,
          line_total: unitPrice * item.quantity,
          item_comment: null,
        };
      });
      const total = items.reduce((sum: number, item: any) => sum + item.line_total, 0);
      const comment = String(body?.comment || "").trim().slice(0, 1000) || null;

      let order: any = null;
      try {
        const inserted = await db("orders?select=id,status,payment_method,comment,total,created_at", {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify([{
            table_session_id: session.id,
            guest_token: guestToken,
            client_request_id: clientRequestId,
            status: "submitted",
            payment_method: paymentMethod,
            comment,
            total,
          }]),
        });
        order = Array.isArray(inserted) ? inserted[0] : null;
      } catch (error) {
        // A concurrent retry may have won the unique client_request_id race.
        const racedRows = await db(
          `orders?select=id,status&table_session_id=eq.${encodeURIComponent(session.id)}&guest_token=eq.${encodeURIComponent(guestToken)}&client_request_id=eq.${encodeURIComponent(clientRequestId)}&limit=1`
        ).catch(() => []);
        const raced = Array.isArray(racedRows) ? racedRows[0] : null;
        if (raced) {
          const state = await guestState(session.id, guestToken);
          return response({ ok: true, duplicate: true, orderId: raced.id, table, session, ...state });
        }
        throw error;
      }
      if (!order) throw new Error("Order was not created");

      try {
        await db("order_items", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify(items.map((item: any) => ({ ...item, order_id: order.id }))),
        });
      } catch (error) {
        // An order without its item snapshot is not a valid business record.
        // Remove it so the same idempotency key can be retried safely.
        await db(`orders?id=eq.${order.id}`, {
          method: "DELETE",
          headers: { Prefer: "return=minimal" },
        }).catch(() => {});
        throw error;
      }

      const state = await guestState(session.id, guestToken);
      return response({ ok: true, orderId: order.id, table, session, ...state }, 201);
    }

    if (action === "service") {
      const kind = String(body?.kind || "");
      if (!["waiter", "bill", "cutlery"].includes(kind)) return response({ error: "Invalid service request" }, 400);

      const recent = await db(
        `service_requests?select=id,kind,status,created_at&table_session_id=eq.${encodeURIComponent(session.id)}&guest_token=eq.${encodeURIComponent(guestToken)}&kind=eq.${encodeURIComponent(kind)}&status=eq.open&order=created_at.desc&limit=1`
      );
      if (!Array.isArray(recent) || !recent[0]) {
        try {
          await db("service_requests", {
            method: "POST",
            headers: { Prefer: "return=minimal" },
            body: JSON.stringify([{ table_session_id: session.id, guest_token: guestToken, kind, status: "open" }]),
          });
        } catch (error) {
          // The unique partial index turns simultaneous taps/tabs into one open request.
          const raced = await db(
            `service_requests?select=id&table_session_id=eq.${encodeURIComponent(session.id)}&guest_token=eq.${encodeURIComponent(guestToken)}&kind=eq.${encodeURIComponent(kind)}&status=eq.open&limit=1`
          ).catch(() => []);
          if (!Array.isArray(raced) || !raced[0]) throw error;
        }
      }
      const state = await guestState(session.id, guestToken);
      return response({ ok: true, table, session, ...state }, 201);
    }

    return response({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return response({ error: "Server error" }, 500);
  }
});