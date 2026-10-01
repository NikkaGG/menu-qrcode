const test = require('node:test');
const assert = require('node:assert/strict');

const tableId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const orderId = '33333333-3333-4333-8333-333333333333';
const dishId = '44444444-4444-4444-8444-444444444444';
const unavailableId = '55555555-5555-4555-8555-555555555555';

function load(relativePath) {
  return require(`../server/${relativePath}`);
}

function responseHarness() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = String(value);
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
    end(value) {
      this.body = value;
      return this;
    },
  };
}

async function invoke(handler, request) {
  const response = responseHarness();
  await handler(request, response);
  return response;
}

test('public ordering route modules export handlers and injected factories', () => {
  const routes = [
    ['api/tables/[token].js', 'createTableHandler'],
    ['api/menu.js', 'createMenuHandler'],
    ['api/orders/index.js', 'createOrderHandler'],
    ['api/orders/[id]/index.js', 'createOrderDetailsHandler'],
  ];
  for (const [route, factory] of routes) {
    const exported = load(route);
    assert.equal(typeof exported, 'function');
    assert.equal(typeof exported[factory], 'function');
  }
});

test('order creation locks the target session row before inserting', () => {
  const { CREATE_ORDER_SQL } = load('api/orders/index.js');
  assert.match(
    CREATE_ORDER_SQL,
    /session_info AS \([\s\S]*FROM table_sessions s[\s\S]*WHERE s\.id = \$1::uuid[\s\S]*FOR UPDATE[\s\S]*\)/i,
  );
  assert.match(
    CREATE_ORDER_SQL,
    /INSERT INTO orders[\s\S]*JOIN session_info session ON session\.status = 'open'/i,
  );
});

test('table token resolves a table and concurrently safe open session', async () => {
  const { createTableHandler } = load('api/tables/[token].js');
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return [{
      table_id: tableId,
      table_number: '12',
      session_id: sessionId,
      session_status: 'open',
      opened_at: '2026-07-27T10:00:00.000Z',
    }];
  };
  const response = await invoke(createTableHandler({ query }), {
    method: 'GET',
    query: { token: 'safe_Table-token-1234' },
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, {
    table: { id: tableId, number: '12' },
    session: { id: sessionId, status: 'open', openedAt: '2026-07-27T10:00:00.000Z' },
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['safe_Table-token-1234']);
  assert.match(calls[0].sql, /ON CONFLICT \(table_id\) WHERE status = 'open'/i);
});

test('table route validates tokens, returns 404, and sets Allow', async () => {
  const { createTableHandler } = load('api/tables/[token].js');
  const handler = createTableHandler({ query: async () => [] });
  const invalid = await invoke(handler, { method: 'GET', query: { token: '../bad' } });
  const missing = await invoke(handler, { method: 'GET', query: { token: 'safe_Table-token-1234' } });
  const method = await invoke(handler, { method: 'POST', query: {} });
  assert.equal(invalid.statusCode, 400);
  assert.equal(missing.statusCode, 404);
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'GET');
});

test('menu returns sorted available dishes with fixed-decimal prices', async () => {
  const { createMenuHandler } = load('api/menu.js');
  const handler = createMenuHandler({
    query: async () => [
      { category_id: tableId, category_name: 'Rolls', dish_id: dishId, dish_name: 'Server name', description: null, price: '12.5', photo_url: '/dish.jpg' },
      { category_id: sessionId, category_name: 'Drinks', dish_id: unavailableId, dish_name: 'Tea', description: 'Hot', price: 2, photo_url: null },
    ],
  });
  const response = await invoke(handler, { method: 'GET' });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.categories[0].dishes[0], {
    id: dishId,
    name: 'Server name',
    description: null,
    price: '12.50',
    photoUrl: '/dish.jpg',
  });
  const method = await invoke(handler, { method: 'POST' });
  assert.equal(method.statusCode, 405);
  assert.equal(method.headers.allow, 'GET');
});

test('order creation uses one atomic query and server-authoritative returned values', async () => {
  const { createOrderHandler } = load('api/orders/index.js');
  const calls = [];
  const query = async (sql, values) => {
    calls.push({ sql, values });
    return [{
      order_id: orderId,
      session_id: sessionId,
      status: 'new',
      total: '25',
      created_at: '2026-07-27T10:01:00.000Z',
      table_number: '12',
      session_status: 'open',
      items: [{ dishId, dishName: 'Server name', dishPrice: '12.50', quantity: 2, subtotal: '25.00' }],
      excluded_dish_ids: [unavailableId],
    }];
  };
  const handler = createOrderHandler({ query });
  const response = await invoke(handler, {
    method: 'POST',
    body: {
      session_id: sessionId,
      items: [
        { dish_id: dishId, quantity: 2 },
        { dish_id: unavailableId, quantity: 1 },
      ],
    },
  });

  assert.equal(response.statusCode, 201);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /WITH[\s\S]*INSERT INTO orders[\s\S]*INSERT INTO order_items/i);
  assert.deepEqual(calls[0].values, [
    sessionId,
    JSON.stringify([{ dish_id: dishId, quantity: 2 }, { dish_id: unavailableId, quantity: 1 }]),
  ]);
  assert.deepEqual(response.body.excludedDishIds, [unavailableId]);
  assert.equal(response.body.order.total, '25.00');
  assert.deepEqual(response.body.order.table, { number: '12' });
  assert.equal(response.body.order.items[0].dishName, 'Server name');
});

test('order creation rejects malformed bodies and does not create empty orders', async () => {
  const { createOrderHandler } = load('api/orders/index.js');
  let calls = 0;
  const invalidHandler = createOrderHandler({ query: async () => { calls += 1; return []; } });
  const invalidBodies = [
    null,
    { session_id: 'bad', items: [{ dish_id: dishId, quantity: 1 }] },
    { session_id: sessionId, items: [] },
    { session_id: sessionId, items: [{ dish_id: 'bad', quantity: 1 }] },
    { session_id: sessionId, items: [{ dish_id: dishId, quantity: 0 }] },
    { session_id: sessionId, items: [{ dish_id: dishId, quantity: 100 }] },
    { session_id: sessionId, items: [{ dish_id: dishId, quantity: 1, price: 0 }] },
    { session_id: sessionId, items: [{ dish_id: dishId, quantity: 1 }], total: 0 },
    { sessionId, items: [{ dishId, quantity: 1 }] },
  ];
  for (const body of invalidBodies) {
    const response = await invoke(invalidHandler, { method: 'POST', body });
    assert.equal(response.statusCode, 400);
  }
  assert.equal(calls, 0);

  const unavailable = await invoke(createOrderHandler({
    query: async () => [{ order_id: null, session_status: 'open', excluded_dish_ids: [dishId] }],
  }), { method: 'POST', body: { session_id: sessionId, items: [{ dish_id: dishId, quantity: 1 }] } });
  assert.equal(unavailable.statusCode, 409);
  assert.deepEqual(unavailable.body, {
    error: 'No requested dishes are available',
    excludedDishIds: [dishId],
  });
});

test('order creation distinguishes missing and closed sessions from unavailable dishes', async () => {
  const { createOrderHandler } = load('api/orders/index.js');
  const body = { session_id: sessionId, items: [{ dish_id: dishId, quantity: 1 }] };
  const missing = await invoke(createOrderHandler({
    query: async () => [{ order_id: null, session_status: null, excluded_dish_ids: [] }],
  }), { method: 'POST', body });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.body, { error: 'Session not found' });

  const closed = await invoke(createOrderHandler({
    query: async () => [{ order_id: null, session_status: 'closed', excluded_dish_ids: [] }],
  }), { method: 'POST', body });
  assert.equal(closed.statusCode, 409);
  assert.deepEqual(closed.body, { error: 'Session is not open' });
});

test('order details return 404s and serialize money consistently', async () => {
  const { createOrderDetailsHandler, ORDER_DETAILS_SQL } = load('api/orders/[id]/index.js');
  const missingOrder = await invoke(createOrderDetailsHandler({ query: async () => [] }), {
    method: 'GET', query: { id: orderId },
  });
  assert.equal(missingOrder.statusCode, 404);

  const order = await invoke(createOrderDetailsHandler({ query: async () => [{
    order_id: orderId, session_id: sessionId, status: 'ready', total: '3.5',
    created_at: '2026-07-27T10:01:00.000Z', table_number: '12',
    items: [{ dishId, dishName: 'Tea', dishPrice: 3.5, quantity: 1, subtotal: 3.5 }],
  }] }), { method: 'GET', query: { id: orderId } });

  assert.equal(order.body.order.total, '3.50');
  assert.equal(order.body.order.items[0].subtotal, '3.50');
  assert.deepEqual(order.body.order.table, { number: '12' });
  assert.match(ORDER_DETAILS_SQL, /JOIN table_sessions s ON s\.id = o\.session_id/i);
  assert.match(ORDER_DETAILS_SQL, /JOIN restaurant_tables t ON t\.id = s\.table_id/i);
  assert.match(ORDER_DETAILS_SQL, /t\.number AS table_number/i);
});
test('order details reject bad UUIDs and hide database errors', async () => {
  const { createOrderDetailsHandler } = load('api/orders/[id]/index.js');
  const badId = await invoke(createOrderDetailsHandler({ query: async () => [] }), {
    method: 'GET', query: { id: 'not-a-uuid' },
  });
  assert.equal(badId.statusCode, 400);

  const failure = await invoke(createOrderDetailsHandler({
    query: async () => { throw new Error('password=secret'); },
  }), {
    method: 'GET', query: { id: orderId },
  });
  assert.equal(failure.statusCode, 500);
  assert.doesNotMatch(JSON.stringify(failure.body), /password|secret/i);
});
