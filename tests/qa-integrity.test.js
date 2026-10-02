const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const tableApi = read('supabase/functions/table-api/index.ts');
const staffOrders = read('supabase/functions/staff-orders/index.ts');
const adminApi = read('supabase/functions/admin-api/index.ts');
const roleMigration = read('supabase/migrations/20261002071000_role_access.sql');
const statusMigration = read('supabase/migrations/20261002072000_order_status_events.sql');
const idempotencyMigration = read('supabase/migrations/20261002073000_qa_idempotency_guards.sql');
const sw = read('sw.js');
const manifest = JSON.parse(read('manifest.webmanifest'));
const vercel = JSON.parse(read('vercel.json'));
const index = read('index.html');
const admin = read('admin.html');
const kitchen = read('kitchen.html');
const staff = read('staff.html');

test('table order idempotency is enforced in code and database schema', () => {
  assert.match(tableApi, /client_request_id=eq\.\$\{encodeURIComponent\(clientRequestId\)\}/);
  assert.match(tableApi, /client_request_id: clientRequestId/);
  assert.match(idempotencyMigration, /add column if not exists client_request_id uuid/);
  assert.match(idempotencyMigration, /create unique index if not exists orders_guest_request_unique/);
  assert.match(idempotencyMigration, /table_session_id, guest_token, client_request_id/);
  assert.match(idempotencyMigration, /where client_request_id is not null/);
});

test('open service requests are protected against rapid duplicate taps and tabs', () => {
  assert.match(tableApi, /service_requests\?select=id,kind,status,created_at/);
  assert.match(tableApi, /unique partial index turns simultaneous taps\/tabs into one open request/);
  assert.match(idempotencyMigration, /create unique index if not exists service_requests_one_open_kind_per_guest/);
  assert.match(idempotencyMigration, /table_session_id, guest_token, kind/);
  assert.match(idempotencyMigration, /where status = 'open'/);
});

test('analytics trigger does not run as a public security definer', () => {
  assert.match(statusMigration, /security invoker/);
  assert.doesNotMatch(statusMigration, /security definer/i);
  assert.match(statusMigration, /revoke execute on function public\.capture_order_status_change\(\) from public, anon, authenticated/);
});

test('staff role boundary is enforced server-side', () => {
  assert.match(staffOrders, /"resolve-request": \["owner", "admin", "waiter"\]/);
  assert.match(staffOrders, /"close-session": \["owner", "admin", "waiter"\]/);
  assert.match(staffOrders, /if \(role === "kitchen"\)/);
  assert.match(staffOrders, /if \(role === "waiter"\) return current === "ready" && next === "served"/);
  assert.match(staffOrders, /return reply\(\{ error: "Недостаточно прав для этого действия" \}, 403\)/);
});

test('owner access management handles duplicate role PINs as a conflict', () => {
  const duplicateResponses = adminApi.match(/Такой PIN уже используется в этой роли/g) || [];
  assert.ok(duplicateResponses.length >= 3, 'create, role change and PIN reset should all handle duplicate PINs');
  assert.match(adminApi, /return reply\(\{ error: "Такой PIN уже используется в этой роли" \}, 409\)/);
});

test('staff identities are protected by RLS and PIN hashes are not exposed in admin HTML', () => {
  assert.match(roleMigration, /alter table public\.staff_members enable row level security/);
  assert.match(roleMigration, /pin_hash text not null/);
  assert.doesNotMatch(admin, /pin_hash/);
});

test('PWA uses network-first navigation and does not precache live menu data', () => {
  assert.match(sw, /if\(request\.mode==='navigate'\)/);
  assert.match(sw, /networkFirst\(request,OFFLINE_URL\)/);
  assert.doesNotMatch(sw, /ref-products-dom\.json/);
  assert.doesNotMatch(sw, /supabase\.co/);
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.some(icon => icon.purpose === 'maskable'));
});

test('critical routes are present and point to role-specific workspaces', () => {
  const rewrites = new Map(vercel.rewrites.map(rule => [rule.source, rule.destination]));
  assert.equal(rewrites.get('/admin'), '/admin.html');
  assert.equal(rewrites.get('/kitchen'), '/kitchen.html');
  assert.equal(rewrites.get('/staff'), '/staff.html');
  assert.match(kitchen, /body:JSON\.stringify\(\{action,role:'kitchen'/);
  assert.match(staff, /body:JSON\.stringify\(\{action,role:'waiter'/);
  assert.match(admin, /body:JSON\.stringify\(\{action,role:adminRole/);
});

test('guest menu keeps server as source of truth for availability and price', () => {
  assert.match(tableApi, /dishes\?select=id,category_id,name,price,is_available/);
  assert.match(tableApi, /is_available=eq\.true/);
  assert.match(tableApi, /categories\?select=id/);
  assert.match(tableApi, /is_visible=eq\.true/);
  assert.match(tableApi, /const unitPrice = Number\(dish\.price\) \|\| 0/);
  assert.match(tableApi, /const total = items\.reduce/);
});

test('public menu exposes installable PWA metadata', () => {
  assert.match(index, /<link rel="manifest" href="\/manifest\.webmanifest">/);
  assert.match(index, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(index, /<link rel="apple-touch-icon" href="\/icons\/app-192\.png">/);
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
});
