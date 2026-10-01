const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { matchRoute, createRouter } = require('../api/router');

test('Vercel rewrites every nested API path to one fixed function', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'),
  );

  assert.equal(config.$schema, 'https://openapi.vercel.sh/vercel.json');
  assert.equal(config.buildCommand, 'npm run build');
  assert.equal(config.outputDirectory, '.');
  assert.deepEqual(config.rewrites[0], {
    source: '/api/:path*',
    destination: '/api/router?path=:path*',
  });
  assert.equal(config.services, undefined);
});

test('catch-all router selects customer and admin API routes without collisions', () => {
  const cases = [
    ['/api/events', 'events'],
    ['/api/menu', 'menu'],
    ['/api/tables/table-token', 'table'],
    ['/api/orders', 'orders'],
    ['/api/orders/order-1', 'order-details'],
    ['/api/admin/orders/order-1/status', 'order-status'],
    ['/api/admin/sessions/open', 'sessions-open'],
    ['/api/admin/sessions/session-1/bill', 'session-bill'],
    ['/api/admin/sessions/session-1/close', 'session-close'],
    ['/api/stats', 'stats'],
    ['/api/stats/login', 'stats-login'],
    ['/api/stats/logout', 'stats-logout'],
    ['/api/admin/login', 'admin-login'],
    ['/api/admin/logout', 'admin-logout'],
    ['/api/admin/session', 'admin-session'],
    ['/api/admin/stats', 'admin-stats'],
    ['/api/admin/categories', 'admin-categories'],
    ['/api/admin/categories/category-1', 'admin-category'],
    ['/api/admin/dishes', 'admin-dishes'],
    ['/api/admin/dishes/dish-1', 'admin-dish'],
    ['/api/admin/tables', 'admin-tables'],
    ['/api/admin/tables/table-1', 'admin-table'],
    ['/api/admin/tables/table-1/qr', 'admin-table-qr'],
  ];

  for (const [pathname, name] of cases) {
    const match = matchRoute(pathname);
    assert.equal(match.name, name, pathname);
  }
});

test('catch-all router decodes admin parameters and preserves query strings', () => {
  assert.deepEqual(matchRoute('/api/admin/orders/order%2F1/status?source=admin'), {
    name: 'order-status',
    params: { id: 'order/1' },
  });
  assert.deepEqual(matchRoute('/api/tables/table-token/'), {
    name: 'table',
    params: { token: 'table-token' },
  });
});

test('catch-all router delegates with decoded params and existing query values', async () => {
  let delegated;
  const router = createRouter({
    'order-status': async (request, response) => {
      delegated = request.query;
      return response.status(204).end();
    },
  });
  const response = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      return this;
    },
    json() {
      return this;
    },
  };

  await router(
    {
      url: '/api/admin/orders/order%2F1/status?source=admin',
      query: { source: 'admin', path: ['admin', 'orders', 'order/1', 'status'] },
    },
    response,
  );

  assert.deepEqual(delegated, { source: 'admin', id: 'order/1' });
  assert.equal(response.statusCode, 204);
});

test('catch-all router delegates a path forwarded by the Vercel rewrite', async () => {
  let delegated = false;
  const router = createRouter({
    'admin-session': async (_request, response) => {
      delegated = true;
      return response.status(204).end();
    },
  });
  const response = {
    statusCode: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    end() {
      return this;
    },
    json() {
      return this;
    },
  };

  await router(
    {
      url: '/api/router?path=admin%2Fsession',
      query: { path: 'admin/session' },
    },
    response,
  );

  assert.equal(delegated, true);
  assert.equal(response.statusCode, 204);
});

test('catch-all router rejects removed bot and unknown API paths', () => {
  assert.equal(matchRoute('/api/orders/order-1/telegram-message'), null);
  assert.equal(matchRoute('/api/orders/order-1/waiter-message'), null);
  assert.equal(matchRoute('/api/sessions/session-1/bill-request'), null);
  assert.equal(matchRoute('/api/unknown'), null);
  assert.equal(matchRoute('/api/orders/order-1/unknown'), null);
  assert.equal(matchRoute('/not-api/menu'), null);
});
