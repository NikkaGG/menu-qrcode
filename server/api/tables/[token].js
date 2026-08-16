const { getQuery } = require('../_lib/db');
const { isTableToken, mapOrder } = require('../_lib/public-api');
const { json, methodNotAllowed } = require('../_lib/response');

const RESOLVE_TABLE_SQL = `
WITH selected_table AS (
  SELECT id, number FROM restaurant_tables WHERE token = $1
),
open_session AS (
  INSERT INTO table_sessions (table_id)
  SELECT id FROM selected_table
  ON CONFLICT (table_id) WHERE status = 'open'
  DO UPDATE SET table_id = EXCLUDED.table_id
  RETURNING id, table_id, status, opened_at
),
session_orders AS (
  SELECT o.id AS order_id, o.session_id, o.status, o.total, o.created_at,
         COALESCE(jsonb_agg(jsonb_build_object(
           'dishId', i.dish_id,
           'dishName', i.dish_name,
           'dishPrice', i.dish_price,
           'quantity', i.quantity,
           'subtotal', i.subtotal
         ) ORDER BY i.id) FILTER (WHERE i.id IS NOT NULL), '[]'::jsonb) AS items
  FROM orders o
  JOIN open_session s ON s.id = o.session_id
  LEFT JOIN order_items i ON i.order_id = o.id
  GROUP BY o.id, o.session_id, o.status, o.total, o.created_at
)
SELECT t.id AS table_id, t.number AS table_number,
       s.id AS session_id, s.status AS session_status, s.opened_at,
       COALESCE(jsonb_agg(jsonb_build_object(
         'order_id', so.order_id,
         'session_id', so.session_id,
         'status', so.status,
         'total', so.total,
         'created_at', so.created_at,
         'items', so.items
       ) ORDER BY so.created_at, so.order_id) FILTER (WHERE so.order_id IS NOT NULL), '[]'::jsonb) AS orders
FROM selected_table t
JOIN open_session s ON s.table_id = t.id
LEFT JOIN session_orders so ON so.session_id = s.id
GROUP BY t.id, t.number, s.id, s.status, s.opened_at`;

function createTableHandler({ query = getQuery() } = {}) {
  return async (request, response) => {
    if (request.method !== 'GET') return methodNotAllowed(response, ['GET']);
    const token = request.query?.token;
    if (!isTableToken(token)) return json(response, 400, { error: 'Invalid table token' });
    try {
      const rows = await query(RESOLVE_TABLE_SQL, [token]);
      if (!rows.length) return json(response, 404, { error: 'Table not found' });
      const row = rows[0];
      const orders = (Array.isArray(row.orders) ? row.orders : []).map(mapOrder);
      const payload = {
        table: { id: row.table_id, number: row.table_number },
        session: {
          id: row.session_id,
          status: row.session_status,
          openedAt: row.opened_at,
        },
      };
      if (orders.length > 0) {
        payload.orders = orders;
      }
      return json(response, 200, payload);
    } catch {
      return json(response, 500, { error: 'Unable to resolve table' });
    }
  };
}

async function handler(request, response) {
  return createTableHandler()(request, response);
}

module.exports = Object.assign(handler, { handler, createTableHandler });
