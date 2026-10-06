const assert = require('node:assert/strict');
const { test, before } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
let worker;
const installation = { MENU_SUPABASE_URL: 'https://restaurant.example', MENU_SUPABASE_PUBLISHABLE_KEY: 'public-test' };
const request = (pathname, options) => new Request('https://menu.example' + pathname, options);
async function withFetch(mock, action) {
  const original = global.fetch;
  global.fetch = mock;
  try { return await action(); } finally { global.fetch = original; }
}

before(async () => {
  execFileSync(process.execPath, ['scripts/build-pages.cjs'], { cwd: root, stdio: 'pipe' });
  const code = fs.readFileSync(path.join(root, 'dist-pages/_worker.js'), 'utf8');
  worker = (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).default;
});

test('Pages build includes only public assets and bounded function routes', () => {
  const output = path.join(root, 'dist-pages');
  for (const privatePath of ['supabase', 'tests', 'scripts', 'api', 'lib', '.github', 'package.json', '.env', 'README.md']) assert.equal(fs.existsSync(path.join(output, privatePath)), false);
  for (const publicPath of ['index.html', 'admin.html', 'staff.html', 'kitchen.html', 'sw.js', 'vendor/read-excel-file.js', '_worker.js']) assert.ok(fs.existsSync(path.join(output, publicPath)));
  const routes = JSON.parse(fs.readFileSync(path.join(output, '_routes.json'), 'utf8'));
  assert.deepEqual(routes.include, ['/api/*', '/manifest.webmanifest', '/product/*']);
  assert.equal(routes.include.includes('/*'), false);
});

test('staff routes and static cache headers survive the transfer', () => {
  const redirects = fs.readFileSync(path.join(root, 'dist-pages/_redirects'), 'utf8');
  assert.equal(redirects.includes('/staff /staff.html 200'), false);
  assert.equal(redirects.includes('/admin /admin.html 200'), false);
  assert.ok(fs.existsSync(path.join(root, 'dist-pages/admin.html')));
  const headers = fs.readFileSync(path.join(root, 'dist-pages/_headers'), 'utf8');
  assert.ok(headers.includes('/sw.js\n  Cache-Control: no-store'));
  assert.ok(headers.includes('/vendor/*'));
});

test('runtime configuration contains only public values and is never cached', async () => {
  const response = await worker.fetch(request('/api/config'), { ...installation, SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak' });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.text();
  assert.ok(body.includes('https://restaurant.example'));
  assert.ok(body.includes('public-test'));
  assert.equal(body.includes('must-not-leak'), false);
});

test('HEAD responds with headers but no body', async () => {
  const response = await worker.fetch(request('/api/config', { method: 'HEAD' }), installation);
  assert.ok(response.headers.get('Content-Type').startsWith('application/javascript'));
  assert.equal(await response.text(), '');
});

test('dynamic routes reject writes and unknown APIs return 404', async () => {
  const response = await worker.fetch(request('/api/config', { method: 'POST' }), installation);
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET, HEAD');
  assert.equal((await worker.fetch(request('/api/private'), installation)).status, 404);
});

test('static assets bypass database and handler logic', async () => {
  let forwarded;
  const original = request('/styles.css');
  const response = await worker.fetch(original, { ASSETS: { fetch: req => { forwarded = req; return new Response('static'); } } });
  assert.equal(forwarded, original);
  assert.equal(await response.text(), 'static');
});

test('manifest uses runtime restaurant settings', async () => withFetch(async (url, options) => {
  assert.ok(url.startsWith('https://restaurant.example/rest/v1/site_settings'));
  assert.equal(options.headers.apikey, 'public-test');
  return Response.json([{ restaurant_name: 'Restaurant Test', logo_url: '/logo.png' }]);
}, async () => {
  const response = await worker.fetch(request('/manifest.webmanifest'), installation);
  assert.equal(response.headers.get('Content-Type'), 'application/manifest+json');
  const manifest = await response.json();
  assert.equal(manifest.name, 'Restaurant Test');
  assert.equal(manifest.icons[0].src, '/logo.png');
}));

test('manifest retains default icons when database is unavailable', async () => withFetch(async () => { throw new Error('offline'); }, async () => {
  const response = await worker.fetch(request('/manifest.webmanifest'), installation);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).icons.length, 2);
}));

test('product metadata and redirect stay on the new deployment origin', async () => withFetch(async url => {
  if (url.includes('/dishes?')) return Response.json([{ name: 'Test <dish>', price: 1200, image_url: '/photo.png' }]);
  return Response.json([{ restaurant_name: 'Restaurant Test', canonical_url: 'https://old.vercel.app' }]);
}, async () => {
  const response = await worker.fetch(request('/product/12'), installation);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.ok(html.includes('Test &lt;dish&gt;'));
  assert.ok(html.includes('https://menu.example/?view=menu&amp;product=12'));
  assert.equal(html.includes('old.vercel.app'), false);
  assert.ok(html.includes('https://menu.example/photo.png'));
}));

test('missing products are not replaced with demonstration data', async () => withFetch(async () => Response.json([]), async () => {
  assert.equal((await worker.fetch(request('/product/99999'), installation)).status, 404);
}));

test('branding preserves safe custom redirects and rejects unknown types', async () => withFetch(async () => Response.json([{ logo_url: 'https://photos.example/logo.png' }]), async () => {
  const response = await worker.fetch(request('/api/branding?type=logo'), installation);
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('Location'), 'https://photos.example/logo.png');
  assert.equal((await worker.fetch(request('/api/branding?type=secret'), installation)).status, 404);
}));

test('concurrent requests cannot exchange installation settings', async () => withFetch(async (url, options) => {
  const first = url.startsWith('https://restaurant.example/');
  assert.equal(options.headers.apikey, first ? 'public-test' : 'other-public');
  await new Promise(resolve => setTimeout(resolve, first ? 10 : 1));
  return Response.json([{ restaurant_name: first ? 'First' : 'Second' }]);
}, async () => {
  const responses = await Promise.all([
    worker.fetch(request('/manifest.webmanifest'), installation),
    worker.fetch(request('/manifest.webmanifest'), { MENU_SUPABASE_URL: 'https://other.example', MENU_SUPABASE_PUBLISHABLE_KEY: 'other-public' })
  ]);
  assert.equal((await responses[0].json()).name, 'First');
  assert.equal((await responses[1].json()).name, 'Second');
}));
