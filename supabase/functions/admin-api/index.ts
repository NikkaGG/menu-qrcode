const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-pin, apikey, authorization",
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

async function adminPinOk(pin: string) {
  // Temporary owner-requested development PIN. Restore hashed DB verification before production handoff.
  return pin === "1";
}

function cleanUuid(value: unknown) {
  const s = String(value || "").trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(s) ? s : "";
}

function cleanTableNumber(value: unknown) {
  return String(value || "").trim().slice(0, 20);
}

function cleanLabel(value: unknown) {
  return String(value || "").trim().slice(0, 80);
}

function isCancelled(order: any) {
  return order?.status === "cancelled";
}

function sumTotal(orders: any[]) {
  return orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
}

function averageCheck(orders: any[]) {
  return orders.length ? Math.round(sumTotal(orders) / orders.length) : 0;
}

async function adminDashboard() {
  const now = Date.now();
  const since30 = new Date(now - 30 * 86400000).toISOString();
  const since7 = now - 7 * 86400000;
  const since24 = now - 24 * 3600000;

  const [tablesRaw, sessionsRaw, ordersRaw, requestsRaw] = await Promise.all([
    db("restaurant_tables?select=id,table_number,qr_token,label,is_active,created_at,updated_at&order=table_number.asc"),
    db(`table_sessions?select=id,table_id,status,opened_at,closed_at,updated_at&opened_at=gte.${encodeURIComponent(since30)}&order=opened_at.asc`),
    db(`orders?select=id,table_session_id,status,payment_method,total,created_at,updated_at&created_at=gte.${encodeURIComponent(since30)}&order=created_at.asc`),
    db("service_requests?select=id,table_session_id,kind,status,created_at,resolved_at&status=eq.open&order=created_at.asc"),
  ]);

  const tables = Array.isArray(tablesRaw) ? tablesRaw : [];
  const sessions = Array.isArray(sessionsRaw) ? sessionsRaw : [];
  const orders = (Array.isArray(ordersRaw) ? ordersRaw : []).filter((order: any) => !isCancelled(order));
  const requests = Array.isArray(requestsRaw) ? requestsRaw : [];

  const sessionsById = new Map(sessions.map((s: any) => [s.id, s]));
  const last24 = orders.filter((o: any) => new Date(o.created_at).getTime() >= since24);
  const last7 = orders.filter((o: any) => new Date(o.created_at).getTime() >= since7);
  const openSessions = sessions.filter((s: any) => s.status === "open");

  const tableStats = new Map<string, { orders: number; revenue: number }>();
  for (const order of orders) {
    const session: any = sessionsById.get(order.table_session_id);
    if (!session) continue;
    const current = tableStats.get(session.table_id) || { orders: 0, revenue: 0 };
    current.orders += 1;
    current.revenue += Number(order.total || 0);
    tableStats.set(session.table_id, current);
  }

  const enrichedTables = tables.map((table: any) => ({
    ...table,
    openSession: openSessions.some((session: any) => session.table_id === table.id),
    orders30: tableStats.get(table.id)?.orders || 0,
    revenue30: tableStats.get(table.id)?.revenue || 0,
  }));

  const daily = [];
  for (let offset = 6; offset >= 0; offset--) {
    const start = new Date(now - offset * 86400000);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const dayOrders = orders.filter((o: any) => {
      const ts = new Date(o.created_at).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    });
    daily.push({
      date: start.toISOString().slice(0, 10),
      orders: dayOrders.length,
      revenue: sumTotal(dayOrders),
    });
  }

  const payments: Record<string, number> = {};
  for (const order of last7) {
    const method = String(order.payment_method || "unknown");
    payments[method] = (payments[method] || 0) + 1;
  }

  return {
    generatedAt: new Date(now).toISOString(),
    analytics: {
      orders24: last24.length,
      revenue24: sumTotal(last24),
      orders7: last7.length,
      revenue7: sumTotal(last7),
      averageCheck7: averageCheck(last7),
      openTables: openSessions.length,
      openRequests: requests.length,
      totalTables: tables.length,
      activeTables: tables.filter((table: any) => table.is_active).length,
      daily,
      payments,
    },
    tables: enrichedTables,
  };
}

async function tableHasOpenSession(tableId: string) {
  const rows = await db(
    `table_sessions?select=id&table_id=eq.${encodeURIComponent(tableId)}&status=eq.open&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const pin = req.headers.get("x-admin-pin") || String(body?.pin || "");
    if (!(await adminPinOk(pin))) return reply({ error: "Неверный PIN администратора" }, 401);

    const action = String(body?.action || "dashboard");
    if (action === "dashboard") return reply(await adminDashboard());

    if (action === "create-table") {
      const tableNumber = cleanTableNumber(body?.tableNumber);
      const label = cleanLabel(body?.label) || `Стол ${tableNumber}`;
      if (!tableNumber) return reply({ error: "Укажите номер стола" }, 400);

      try {
        await db("restaurant_tables", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{
            table_number: tableNumber,
            label,
            is_active: true,
          }]),
        });
      } catch (error) {
        if (String((error as Error)?.message || "").toLowerCase().includes("duplicate")) {
          return reply({ error: "Стол с таким номером уже существует" }, 409);
        }
        throw error;
      }
      return reply({ ok: true, ...(await adminDashboard()) }, 201);
    }

    if (action === "update-table") {
      const tableId = cleanUuid(body?.tableId);
      const tableNumber = cleanTableNumber(body?.tableNumber);
      const label = cleanLabel(body?.label);
      if (!tableId || !tableNumber) return reply({ error: "Некорректные данные стола" }, 400);

      try {
        await db(`restaurant_tables?id=eq.${encodeURIComponent(tableId)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({
            table_number: tableNumber,
            label: label || `Стол ${tableNumber}`,
            updated_at: new Date().toISOString(),
          }),
        });
      } catch (error) {
        if (String((error as Error)?.message || "").toLowerCase().includes("duplicate")) {
          return reply({ error: "Стол с таким номером уже существует" }, 409);
        }
        throw error;
      }
      return reply({ ok: true, ...(await adminDashboard()) });
    }

    if (action === "set-table-active") {
      const tableId = cleanUuid(body?.tableId);
      const active = body?.active === true;
      if (!tableId) return reply({ error: "Некорректный стол" }, 400);
      if (!active && await tableHasOpenSession(tableId)) {
        return reply({ error: "Сначала закройте текущую сессию этого стола в панели зала" }, 409);
      }

      await db(`restaurant_tables?id=eq.${encodeURIComponent(tableId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ is_active: active, updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await adminDashboard()) });
    }

    if (action === "rotate-table-qr") {
      const tableId = cleanUuid(body?.tableId);
      if (!tableId) return reply({ error: "Некорректный стол" }, 400);
      if (await tableHasOpenSession(tableId)) {
        return reply({ error: "Нельзя менять QR, пока стол открыт. Сначала закройте стол в панели зала" }, 409);
      }

      await db(`restaurant_tables?id=eq.${encodeURIComponent(tableId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ qr_token: crypto.randomUUID(), updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await adminDashboard()) });
    }

    return reply({ error: "Unknown action" }, 400);
  } catch (error) {
    console.error(error);
    return reply({ error: "Server error" }, 500);
  }
});