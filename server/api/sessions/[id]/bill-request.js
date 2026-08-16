const { getQuery } = require('../../_lib/db');
const { isUuid, money } = require('../../_lib/public-api');
const { json, methodNotAllowed } = require('../../_lib/response');
const { BILL_SQL } = require('./bill');

const PAYMENT_LABELS = {
  cash: 'Наличные',
  kaspi: 'Kaspi QR',
  card: 'Банковская карта',
};

async function notifyBotBillRequest({
  env = process.env,
  fetchImpl = globalThis.fetch,
  sessionId,
  tableNumber,
  total,
  paymentMethod,
  ordersCount,
  itemsCount,
}) {
  const baseUrl = env.BOT_INTERNAL_API_URL;
  const secret = env.BOT_INTERNAL_API_SECRET;
  if (!baseUrl || !secret || typeof fetchImpl !== 'function') return;

  const paymentLabel = PAYMENT_LABELS[paymentMethod] || 'Оплата счёта';
  try {
    await fetchImpl(
      `${baseUrl.replace(/\/+$/, '')}/internal/tables/bill-request`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          sessionId,
          tableNumber,
          total,
          paymentMethod,
          paymentLabel,
          ordersCount,
          itemsCount,
        }),
      }
    );
  } catch (err) {
    console.error('Failed to notify bot about bill request:', err.message);
  }
}

function createBillRequestHandler({
  query,
  notify = notifyBotBillRequest,
} = {}) {
  return async (request, response) => {
    if (request.method !== 'POST') return methodNotAllowed(response, ['POST']);
    const id = request.query?.id;
    if (!isUuid(id)) return json(response, 400, { error: 'Invalid session id' });

    let paymentMethod = 'kaspi';
    if (request.body && typeof request.body === 'object') {
      const pm = request.body.paymentMethod;
      if (['cash', 'kaspi', 'card'].includes(pm)) {
        paymentMethod = pm;
      }
    }

    try {
      const rows = await (query || getQuery())(BILL_SQL, [id]);
      if (!rows.length) return json(response, 404, { error: 'Session not found' });
      const row = rows[0];
      if (row.status !== 'open') {
        return json(response, 409, { error: 'Session is not open' });
      }

      const orders = Array.isArray(row.orders) ? row.orders : [];
      const totalItems = orders.reduce(
        (sum, o) => sum + (Array.isArray(o.items) ? o.items.reduce((s, i) => s + (i.quantity || 1), 0) : 0),
        0
      );

      await notify({
        sessionId: row.session_id,
        tableNumber: row.table_number,
        total: money(row.total),
        paymentMethod,
        ordersCount: orders.length,
        itemsCount: totalItems,
      });

      return json(response, 200, {
        ok: true,
        sessionId: row.session_id,
        tableNumber: row.table_number,
        total: money(row.total),
        paymentMethod,
        paymentLabel: PAYMENT_LABELS[paymentMethod] || 'Kaspi QR',
      });
    } catch {
      return json(response, 500, { error: 'Unable to process bill request' });
    }
  };
}

async function handler(request, response) {
  return createBillRequestHandler()(request, response);
}

module.exports = Object.assign(handler, {
  handler,
  createBillRequestHandler,
  notifyBotBillRequest,
  PAYMENT_LABELS,
});
