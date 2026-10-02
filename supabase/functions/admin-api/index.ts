const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-admin-pin, x-admin-role, apikey, authorization",
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

type AdminRole = "owner" | "admin";
type AdminActor = { id: number; name: string; role: AdminRole; temporary?: boolean };

function cleanAdminRole(value: unknown): AdminRole | "" {
  const role = String(value || "").trim().toLowerCase();
  return role === "owner" || role === "admin" ? role : "";
}

async function authenticateAdmin(pin: string, requestedRole: unknown): Promise<AdminActor | null> {
  const role = cleanAdminRole(requestedRole) || "owner";
  if (!/^\d{1,12}$/.test(pin)) return null;

  // Temporary owner-requested development compatibility. Replace PIN 1 before production handoff.
  if (pin === "1") {
    return {
      id: 0,
      name: role === "owner" ? "Владелец" : "Администратор",
      role,
      temporary: true,
    };
  }

  const hash = await sha256(pin);
  const rows = await db(
    `staff_members?select=id,name,role,is_active&role=eq.${role}&pin_hash=eq.${hash}&is_active=eq.true&limit=1`
  );
  const member = Array.isArray(rows) ? rows[0] : null;
  if (!member) return null;
  return {
    id: Number(member.id),
    name: String(member.name || ""),
    role: cleanAdminRole(member.role) || role,
  };
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

function cleanText(value: unknown, max = 500) {
  return String(value || "").trim().slice(0, max);
}

function cleanCategoryId(value: unknown) {
  const s = String(value || "").trim().slice(0, 40);
  return /^[a-z0-9_-]+$/i.test(s) ? s : "";
}

function cleanDishId(value: unknown) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function cleanPrice(value: unknown) {
  const price = Math.round(Number(value));
  return Number.isFinite(price) && price >= 0 && price <= 1000000 ? price : -1;
}

function cleanSortOrder(value: unknown) {
  const order = Math.round(Number(value));
  return Number.isFinite(order) && order >= -100000 && order <= 100000 ? order : 0;
}

function cleanAssetUrl(value: unknown) {
  const s = String(value || "").trim().slice(0, 1000);
  if (!s) return null;
  if (s.startsWith("/") || /^https?:\/\//i.test(s)) return s;
  return "";
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

  const daily30 = [];
  for (let offset = 29; offset >= 0; offset--) {
    const start = new Date(now - offset * 86400000);
    start.setUTCHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 86400000);
    const dayOrders = orders.filter((o: any) => {
      const ts = new Date(o.created_at).getTime();
      return ts >= start.getTime() && ts < end.getTime();
    });
    daily30.push({
      date: start.toISOString().slice(0, 10),
      orders: dayOrders.length,
      revenue: sumTotal(dayOrders),
    });
  }

  const payments30: Record<string, number> = {};
  for (const order of orders) {
    const method = String(order.payment_method || "unknown");
    payments30[method] = (payments30[method] || 0) + 1;
  }

  return {
    generatedAt: new Date(now).toISOString(),
    analytics: {
      orders24: last24.length,
      revenue24: sumTotal(last24),
      orders7: last7.length,
      revenue7: sumTotal(last7),
      averageCheck7: averageCheck(last7),
      orders30: orders.length,
      revenue30: sumTotal(orders),
      averageCheck30: averageCheck(orders),
      openTables: openSessions.length,
      openRequests: requests.length,
      totalTables: tables.length,
      activeTables: tables.filter((table: any) => table.is_active).length,
      daily,
      payments,
      daily30,
      payments30,
    },
    tables: enrichedTables,
  };
}


async function adminOrdersState() {
  const ordersRaw = await db("orders?select=id,table_session_id,status,payment_method,comment,total,created_at,updated_at&order=created_at.desc&limit=200");
  const orders = Array.isArray(ordersRaw) ? ordersRaw : [];
  const orderIds = orders.map((order: any) => Number(order.id)).filter((id: number) => Number.isInteger(id) && id > 0);
  const sessionIds = [...new Set(orders.map((order: any) => cleanUuid(order.table_session_id)).filter(Boolean))];

  const [tablesRaw, sessionsRaw, itemsRaw] = await Promise.all([
    db("restaurant_tables?select=id,table_number,label&order=table_number.asc"),
    sessionIds.length
      ? db(`table_sessions?select=id,table_id,status,opened_at,closed_at&id=in.(${sessionIds.join(",")})`)
      : Promise.resolve([]),
    orderIds.length
      ? db(`order_items?select=id,order_id,dish_id,name,quantity,unit_price,line_total,item_comment&order_id=in.(${orderIds.join(",")})&order=order_id.desc,id.asc`)
      : Promise.resolve([]),
  ]);

  const tables = Array.isArray(tablesRaw) ? tablesRaw : [];
  const sessions = Array.isArray(sessionsRaw) ? sessionsRaw : [];
  const items = Array.isArray(itemsRaw) ? itemsRaw : [];
  const tablesById = new Map(tables.map((table: any) => [table.id, table]));
  const sessionsById = new Map(sessions.map((session: any) => [session.id, session]));
  const itemsByOrder = new Map<number, any[]>();

  for (const item of items) {
    const orderId = Number(item.order_id);
    if (!itemsByOrder.has(orderId)) itemsByOrder.set(orderId, []);
    itemsByOrder.get(orderId)!.push(item);
  }

  const enriched = orders.map((order: any) => {
    const session: any = sessionsById.get(order.table_session_id);
    const table: any = session ? tablesById.get(session.table_id) : null;
    return {
      ...order,
      table: table ? { id: table.id, table_number: table.table_number, label: table.label } : null,
      session: session ? {
        id: session.id,
        status: session.status,
        opened_at: session.opened_at,
        closed_at: session.closed_at,
      } : null,
      items: itemsByOrder.get(Number(order.id)) || [],
    };
  });

  const activeStatuses = new Set(["submitted", "accepted", "preparing", "ready"]);
  const nonCancelled = enriched.filter((order: any) => !isCancelled(order));
  const paymentCounts: Record<string, number> = {};
  for (const order of enriched) {
    const key = String(order.payment_method || "unknown");
    paymentCounts[key] = (paymentCounts[key] || 0) + 1;
  }

  return {
    generatedAt: new Date().toISOString(),
    summary: {
      total: enriched.length,
      active: enriched.filter((order: any) => activeStatuses.has(String(order.status || ""))).length,
      served: enriched.filter((order: any) => order.status === "served").length,
      cancelled: enriched.filter((order: any) => isCancelled(order)).length,
      amount: sumTotal(nonCancelled),
      averageCheck: averageCheck(nonCancelled),
      payments: paymentCounts,
    },
    orders: enriched,
  };
}

async function adminMenuState() {
  const [categoriesRaw, dishesRaw] = await Promise.all([
    db("categories?select=id,name,sort_order,is_visible,updated_at&order=sort_order.asc,id.asc"),
    db("dishes?select=id,category_id,name,weight,description,price,image_url,detail_image_url,is_available,is_popular,sort_order,popular_order,updated_at&order=category_id.asc,sort_order.asc,id.asc"),
  ]);
  return {
    generatedAt: new Date().toISOString(),
    categories: Array.isArray(categoriesRaw) ? categoriesRaw : [],
    dishes: Array.isArray(dishesRaw) ? dishesRaw : [],
  };
}

async function categoryExists(categoryId: string) {
  const rows = await db(`categories?select=id&id=eq.${encodeURIComponent(categoryId)}&limit=1`);
  return Array.isArray(rows) && Boolean(rows[0]?.id);
}

async function nextDishId() {
  const rows = await db("dishes?select=id&order=id.desc&limit=1");
  const current = Array.isArray(rows) ? Number(rows[0]?.id || 0) : 0;
  return current + 1;
}

function dishPayload(body: any) {
  const categoryId = cleanCategoryId(body?.categoryId);
  const name = cleanText(body?.name, 140);
  const weight = cleanText(body?.weight, 120) || null;
  const description = cleanText(body?.description, 2000) || null;
  const price = cleanPrice(body?.price);
  const imageUrl = cleanAssetUrl(body?.imageUrl);
  const detailImageUrl = cleanAssetUrl(body?.detailImageUrl);
  const sortOrder = cleanSortOrder(body?.sortOrder);
  const isPopular = body?.isPopular === true;
  if (!categoryId || !name || price < 0 || imageUrl === "" || detailImageUrl === "") {
    return null;
  }
  return {
    category_id: categoryId,
    name,
    weight,
    description,
    price,
    image_url: imageUrl,
    detail_image_url: detailImageUrl,
    is_available: body?.isAvailable !== false,
    is_popular: isPopular,
    sort_order: sortOrder,
    updated_at: new Date().toISOString(),
  };
}

async function tableHasOpenSession(tableId: string) {
  const rows = await db(
    `table_sessions?select=id&table_id=eq.${encodeURIComponent(tableId)}&status=eq.open&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

function cleanStaffRole(value: unknown) {
  const role = String(value || "").trim().toLowerCase();
  return ["owner", "admin", "waiter", "kitchen"].includes(role) ? role : "";
}

function cleanStaffName(value: unknown) {
  return String(value || "").trim().slice(0, 80);
}

function cleanStaffPin(value: unknown) {
  const pin = String(value || "").trim();
  return /^\d{1,12}$/.test(pin) ? pin : "";
}

async function adminAccessState() {
  const rows = await db(
    "staff_members?select=id,name,role,is_active,created_at,updated_at&order=role.asc,name.asc,id.asc"
  );
  return {
    generatedAt: new Date().toISOString(),
    members: Array.isArray(rows) ? rows : [],
  };
}

async function canRemoveOwner(memberId: number) {
  const rows = await db(
    `staff_members?select=id&role=eq.owner&is_active=eq.true&id=neq.${memberId}&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("", { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const pin = req.headers.get("x-admin-pin") || String(body?.pin || "");
    const requestedRole = req.headers.get("x-admin-role") || body?.role || "owner";
    const actor = await authenticateAdmin(pin, requestedRole);
    if (!actor) return reply({ error: "Неверный PIN для выбранной роли" }, 401);

    const action = String(body?.action || "dashboard");
    if (action === "dashboard") return reply({ ...(await adminDashboard()), actor: { id: actor.id, name: actor.name, role: actor.role } });
    if (action === "orders") return reply({ ...(await adminOrdersState()), actor: { id: actor.id, name: actor.name, role: actor.role } });
    if (action === "menu") return reply({ ...(await adminMenuState()), actor: { id: actor.id, name: actor.name, role: actor.role } });
    if (action === "access") {
      if (actor.role !== "owner") return reply({ error: "Только владелец может управлять доступом" }, 403);
      return reply({ ...(await adminAccessState()), actor: { id: actor.id, name: actor.name, role: actor.role } });
    }

    if (["create-staff", "update-staff", "set-staff-pin"].includes(action) && actor.role !== "owner") {
      return reply({ error: "Только владелец может управлять доступом" }, 403);
    }

    if (action === "create-staff") {
      const name = cleanStaffName(body?.name);
      const role = cleanStaffRole(body?.staffRole);
      const staffPin = cleanStaffPin(body?.staffPin);
      if (!name || !role || !staffPin) return reply({ error: "Проверьте имя, роль и PIN" }, 400);
      const pinHash = await sha256(staffPin);
      try {
        await db("staff_members", {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify([{ name, role, pin_hash: pinHash, is_active: true }]),
        });
      } catch (error) {
        if (String((error as Error)?.message || "").toLowerCase().includes("duplicate")) {
          return reply({ error: "Такой PIN уже используется в этой роли" }, 409);
        }
        throw error;
      }
      return reply({ ok: true, ...(await adminAccessState()) }, 201);
    }

    if (action === "update-staff") {
      const memberId = Number(body?.memberId);
      const name = cleanStaffName(body?.name);
      const role = cleanStaffRole(body?.staffRole);
      const active = body?.active !== false;
      if (!Number.isInteger(memberId) || memberId <= 0 || !name || !role) {
        return reply({ error: "Некорректные данные сотрудника" }, 400);
      }
      const currentRows = await db(`staff_members?select=id,role,is_active&id=eq.${memberId}&limit=1`);
      const current = Array.isArray(currentRows) ? currentRows[0] : null;
      if (!current) return reply({ error: "Сотрудник не найден" }, 404);
      if (current.role === "owner" && current.is_active && (!active || role !== "owner") && !(await canRemoveOwner(memberId))) {
        return reply({ error: "Нельзя отключить последнего активного владельца" }, 409);
      }
      await db(`staff_members?id=eq.${memberId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ name, role, is_active: active, updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await adminAccessState()) });
    }

    if (action === "set-staff-pin") {
      const memberId = Number(body?.memberId);
      const staffPin = cleanStaffPin(body?.staffPin);
      if (!Number.isInteger(memberId) || memberId <= 0 || !staffPin) {
        return reply({ error: "Некорректный PIN" }, 400);
      }
      const rows = await db(`staff_members?select=id,role&id=eq.${memberId}&limit=1`);
      const member = Array.isArray(rows) ? rows[0] : null;
      if (!member) return reply({ error: "Сотрудник не найден" }, 404);
      try {
        await db(`staff_members?id=eq.${memberId}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ pin_hash: await sha256(staffPin), updated_at: new Date().toISOString() }),
        });
      } catch (error) {
        if (String((error as Error)?.message || "").toLowerCase().includes("duplicate")) {
          return reply({ error: "Такой PIN уже используется в этой роли" }, 409);
        }
        throw error;
      }
      return reply({ ok: true, ...(await adminAccessState()) });
    }

    if (action === "set-dish-available") {
      const dishId = cleanDishId(body?.dishId);
      const available = body?.available === true;
      if (!dishId) return reply({ error: "Некорректное блюдо" }, 400);
      await db(`dishes?id=eq.${dishId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ is_available: available, updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await adminMenuState()) });
    }

    if (action === "set-category-visible") {
      const categoryId = cleanCategoryId(body?.categoryId);
      const visible = body?.visible === true;
      if (!categoryId) return reply({ error: "Некорректная категория" }, 400);
      await db(`categories?id=eq.${encodeURIComponent(categoryId)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ is_visible: visible, updated_at: new Date().toISOString() }),
      });
      return reply({ ok: true, ...(await adminMenuState()) });
    }

    if (action === "update-dish") {
      const dishId = cleanDishId(body?.dishId);
      const payload = dishPayload(body);
      if (!dishId || !payload) return reply({ error: "Проверьте данные блюда" }, 400);
      if (!(await categoryExists(payload.category_id))) return reply({ error: "Категория не найдена" }, 404);

      await db(`dishes?id=eq.${dishId}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify(payload),
      });
      return reply({ ok: true, ...(await adminMenuState()) });
    }

    if (action === "create-dish") {
      const payload = dishPayload(body);
      if (!payload) return reply({ error: "Проверьте данные блюда" }, 400);
      if (!(await categoryExists(payload.category_id))) return reply({ error: "Категория не найдена" }, 404);

      const id = await nextDishId();
      await db("dishes", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify([{
          id,
          ...payload,
          popular_order: null,
        }]),
      });
      return reply({ ok: true, createdDishId: id, ...(await adminMenuState()) }, 201);
    }

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