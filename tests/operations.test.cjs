const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const source = fs.readFileSync(path.resolve(__dirname, '../supabase/functions/admin-api/index.ts'), 'utf8');
const context = vm.createContext({ exports:{},require:()=>({}),Deno: { env: { get: () => '' }, serve: () => {} }, crypto: require('node:crypto').webcrypto, TextEncoder, Response, console });
vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS }), context);
test('restaurant reports use the local date after midnight in Qyzylorda', () => {
  assert.equal(context.restaurantDateKey('2026-10-04T20:15:00Z'), '2026-10-05');
  assert.equal(context.restaurantHour('2026-10-04T20:15:00Z'), 1);
});
test('restaurant day changes exactly at local midnight', () => {
  assert.equal(context.restaurantDateKey('2026-10-04T18:59:59.999Z'), '2026-10-04');
  assert.equal(context.restaurantDateKey('2026-10-04T19:00:00.000Z'), '2026-10-05');
});
test('restaurant day handles month and year boundaries', () => {
  assert.equal(context.restaurantDateKey('2026-12-31T20:00:00Z'), '2027-01-01');
});
test('restaurant settings can override the report timezone',()=>{
  assert.equal(context.restaurantDateKey('2026-10-04T19:00:00Z','Europe/Moscow'),'2026-10-04');
  assert.equal(context.restaurantHour('2026-10-04T19:00:00Z','Europe/Moscow'),22);
});
