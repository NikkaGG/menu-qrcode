const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const origin = process.env.MENU_TEST_ORIGIN || 'http://127.0.0.1:4173';
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const output = path.resolve(__dirname, '../artifacts/ui-audit');
fs.mkdirSync(output, { recursive: true });
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const getState = async () => (await fetch(`${origin}/__dev/state`)).json();
const control = async (url) => { assert.equal((await fetch(origin + url, { method: 'POST' })).status, 200); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args:process.env.CI?['--no-sandbox']:[] });
  const errors = [];
  const page = await browser.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'reduce' }]);
  await page.setViewport({ width: 1440, height: 1000 });
  const click = async selector => { await page.waitForSelector(selector, { visible: true }); await page.waitForFunction(sel => !document.querySelector(sel).disabled, {}, selector); await page.click(selector); };
  const fill = async (selector, value) => { await click(selector); await page.$eval(selector, el => { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); }); await page.type(selector, value); };
  const app = () => page.waitForSelector('#app:not([hidden])');
  const section = async name => { await click(`#adminNav [data-section="${name}"]`); await delay(200); };
  const closed = id => page.waitForSelector(`#${id}:not(.on)`);
  const layout = async name => {
    const data = await page.evaluate(() => {
      const width = document.documentElement.clientWidth;
      const overflow = [...document.querySelectorAll('main *, .modal.on *')].filter(el => {
        if (!el.getClientRects().length || el.closest('[hidden]')) return false;
        const details = el.closest('details:not([open])');
        if (details && el !== details && !details.querySelector('summary')?.contains(el)) return false;
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.right > width + 2 || box.left < -2) && !el.closest('.menu-category-filter');
      }).slice(0, 8).map(el => `${el.tagName}.${el.className}`);
      const brokenImages = [...document.images].filter(img => img.getClientRects().length && img.complete && img.naturalWidth === 0).map(img => img.src);
      return { overflow, brokenImages, scroll: document.documentElement.scrollWidth, width };
    });
    assert.ok(data.scroll <= data.width + 2, `${name} page overflow ${JSON.stringify(data)}`);
    assert.deepEqual(data.overflow, [], `${name} content overflow`);
    assert.deepEqual(data.brokenImages, [], `${name} images`);
    if (name.startsWith('admin-tables-')) {
      assert.ok(await page.$$eval('.admin-table-qr', buttons => buttons.every(button => {
        const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim());
        if (!text) return false;
        const range = document.createRange(); range.selectNodeContents(text);
        return range.getClientRects().length === 1;
      })), `${name} QR labels fit on one line`);
    }
    await page.screenshot({ path: path.join(output, `${name}.png`) });
    pass(name);
  };
  try {
    await control('/__dev/reset');
    await page.goto(origin + '/admin', { waitUntil: 'networkidle0' });
    await fill('#pin', '0000'); await click('#loginForm button');
    await page.waitForFunction(() => document.getElementById('loginError').textContent.includes('Неверный'));
    pass('invalid PIN has a visible error');
    await fill('#pin', '1'); await click('#loginForm button'); await app(); await delay(300);
    pass('admin login');
    await section('tables');
    await click('#openCreateTableBtn'); await fill('#tableNumber', '1'); await click('#addTableForm [type=submit]');
    await page.waitForFunction(() => document.querySelector('#addTableForm .form-error').textContent.includes('существует'));
    assert.ok(await page.$('#createTableModal.on')); pass('duplicate table keeps the form open with inline error');
    await fill('#tableNumber', '12'); await fill('#tableLabel', 'Терраса 12'); await click('#addTableForm [type=submit]'); await closed('createTableModal');
    let state = await getState(); let table = state.restaurant_tables.find(t => String(t.table_number) === '12'); assert.ok(table); pass('table creation');
    const menuFor = id => `.admin-table-menu:has([data-id="${id}"]) summary`;
    await click(menuFor(table.id)); await click(`[data-action=rename][data-id="${table.id}"]`);
    await fill('#editTableLabel', 'Терраса у окна'); await click('#editTableForm [type=submit]'); await closed('editTableModal');
    assert.equal((await getState()).restaurant_tables.find(t => t.id === table.id).label, 'Терраса у окна'); pass('table edit');
    await click(`[data-action=qr][data-id="${table.id}"]`); await page.waitForSelector('#qrModal.on');
    assert.ok(await page.evaluate(() => {
      const ctx = document.getElementById('qrCanvas').getContext('2d');
      const pixels = ctx.getImageData(0, 0, 360, 360).data;
      return pixels.some((v, i) => i % 4 === 0 && v < 20) && pixels.some((v, i) => i % 4 === 0 && v > 240);
    }));
    await page.keyboard.press('Tab'); assert.ok(await page.evaluate(() => document.activeElement.closest('#qrModal')));
    await page.keyboard.press('Escape'); await closed('qrModal');
    assert.equal(await page.evaluate(() => document.getElementById('app').inert), false); pass('QR pixels, keyboard focus and dialog dismissal');
    await click(menuFor(table.id)); await click(`[data-action=toggle][data-id="${table.id}"]`); await delay(250);
    assert.equal((await getState()).restaurant_tables.find(t => t.id === table.id).is_active, false); pass('QR disable');
    await click(menuFor(table.id)); await click(`[data-action=toggle][data-id="${table.id}"]`); await delay(250);
    const previousToken = table.qr_token;
    await click(menuFor(table.id)); await click(`[data-action=rotate][data-id="${table.id}"]`); await click('#confirmRotateBtn');
    await page.waitForSelector('#qrModal.on');
    table = (await getState()).restaurant_tables.find(t => t.id === table.id); assert.notEqual(table.qr_token, previousToken);
    await click('#closeQrBtn'); pass('QR re-enable and rotation');

    await section('menu'); await page.waitForSelector('.menu-dish-card');
    await page.goto(origin + '/admin#menu', { waitUntil: 'networkidle0' }); await app(); await delay(200);
    await click('.menu-category-settings summary');
    await click('#menuCategories [data-category-action]'); await delay(200);
    assert.equal((await getState()).categories[0].is_visible, false);
    await click('#menuCategories [data-category-action]'); await delay(200); pass('category visibility switch');
    await click('#openCreateDishBtn');
    await fill('#dishName', 'Тестовый ролл'); await fill('#dishPrice', '1450'); await fill('#dishImage', '/assets/generated/filadelfiya.webp');
    await click('#saveDishBtn'); await closed('dishModal');
    let dish = (await getState()).dishes.find(d => d.name === 'Тестовый ролл'); assert.ok(dish); pass('dish creation');
    await fill('#menuSearch', 'Тестовый ролл'); await click(`[data-menu-action=edit][data-id="${dish.id}"]`);
    await fill('#dishPrice', '1550'); await click('#saveDishBtn'); await closed('dishModal');
    assert.equal((await getState()).dishes.find(d => d.id === dish.id).price, 1550); pass('dish edit');
    await click(`[data-menu-action=availability][data-id="${dish.id}"]`); await delay(200);
    assert.equal((await getState()).dishes.find(d => d.id === dish.id).is_available, false);
    await click(`[data-menu-action=availability][data-id="${dish.id}"]`); await delay(200); pass('stop-list and restore');
    await fill('#menuSearch', 'несуществующее блюдо'); assert.ok((await page.$eval('#menuDishes', el => el.textContent)).includes('нет')); pass('empty search results');

    const store = await getState(); table = store.restaurant_tables.find(t => String(t.table_number) === '12');
    await page.goto(origin + '/?table=' + table.qr_token, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.getElementById('tableOrderTitle').textContent.includes('Терраса'));
    await page.waitForSelector('.menu-area button');
    await page.evaluate(() => document.getElementById('cookieBar')?.remove());
    await click('.menu-area button[aria-label="Добавить в корзину"]');
    await click('.cart-pill'); await page.waitForSelector('#cartOv.on');
    await click('[onclick*="setPayment(\'card\'"]');
    await click('#cartItems [aria-label="Увеличить количество"]'); await click('#cartItems [aria-label="Уменьшить количество"]');
    assert.equal(await page.$eval('#cartItems .qn', el => el.textContent), '1'); pass('cart quantity increase and decrease');
    await click('[onclick*="toggleCartComment"]'); await fill('#commentTa', 'Без кунжута'); await click('#orderBtn');
    await page.waitForFunction(() => document.getElementById('tableOrderList').textContent.includes('Заказ #'));
    let order = (await getState()).orders.find(o => o.comment === 'Без кунжута'); assert.ok(order); pass('guest QR menu, cart, payment and order submission');
    await click('[data-table-service=waiter]'); await delay(200);
    assert.ok((await getState()).service_requests.some(r => r.table_session_id === order.table_session_id && r.status === 'open')); pass('guest calls waiter');
    await page.goto(origin + '/kitchen', { waitUntil: 'networkidle0' });
    await fill('#pin', '1'); await click('#loginForm button'); await app();
    await click(`.kitchen-ticket[data-order-id="${order.id}"] .kitchen-primary`);
    await page.waitForFunction(id => document.querySelector(`#working [data-order-id="${id}"]`), {}, order.id);
    assert.equal((await getState()).orders.find(o => o.id === order.id).status, 'preparing'); pass('kitchen starts guest order');
    await click(`.kitchen-ticket[data-order-id="${order.id}"] .kitchen-primary`);
    await page.waitForFunction(id => document.querySelector(`#ready [data-order-id="${id}"]`), {}, order.id);
    pass('kitchen marks ready');
    await click('.kitchen-ticket[data-order-id="1041"] .kitchen-more'); await page.waitForSelector('#cancelModal.on'); await page.keyboard.press('Escape'); await closed('cancelModal');
    await click('.kitchen-ticket[data-order-id="1041"] .kitchen-more'); await click('#confirmCancelBtn'); await delay(200);
    assert.equal((await getState()).orders.find(o => o.id === 1041).status, 'cancelled'); pass('cancel confirmation, dismissal and cancellation');

    await page.goto(origin + '/staff', { waitUntil: 'networkidle0' }); await app();
    assert.ok(await page.$(`[data-ready-order="${order.id}"]`));
    await click(`[data-ready-order="${order.id}"] .serve-action`); await delay(200);
    assert.equal((await getState()).orders.find(o => o.id === order.id).status, 'served'); pass('floor serves guest order');
    await click(`.floor-order-details[data-order-id="${order.id}"] summary`);
    await delay(3500);
    assert.equal(await page.$eval(`.floor-order-details[data-order-id="${order.id}"]`, el => el.open), true); pass('order detail stays expanded after live refresh');
    const request = (await getState()).service_requests.find(r => r.table_session_id === order.table_session_id && r.status === 'open');
    await click(`button[onclick="resolveRequest(${request.id})"]`); await delay(200); pass('floor resolves service request');
    assert.equal(await page.$eval(`button[onclick="openCloseTable('${order.table_session_id}')"]`,b=>b.disabled),true);pass('unpaid table cannot close');
    await click(`button[onclick="openPayment(${order.id})"]`);await click('#confirmPaymentBtn');await page.waitForSelector('#paymentDialog:not([open])');
    assert.ok((await getState()).orders.find(o=>o.id===order.id).paid_at);pass('waiter confirms payment');
    await click(`button[onclick="openCloseTable('${order.table_session_id}')"]`); await click('#confirmCloseTableBtn'); await closed('closeTableModal');
    assert.equal((await getState()).table_sessions.find(s => s.id === order.table_session_id).status, 'closed'); pass('table session completed');

    await page.goto(origin + '/admin#orders', { waitUntil: 'networkidle0' }); await app();
    await fill('#orderSearch', '');
    await fill('#orderSearch', String(order.id)); await click(`#ordersList [data-order-id="${order.id}"]`); await page.waitForSelector('#orderDrawer.on');
    assert.ok((await page.$eval('#orderDrawerContent', el => el.textContent)).includes('Подан')); await page.keyboard.press('Escape'); await closed('orderDrawer'); pass('completed order retained in admin history');
    await control('/__dev/fault?on=1'); await click('#refreshBtn');
    await page.waitForSelector('#connectionBanner:not([hidden])'); pass('connection failure retains data and exposes retry');
    await control('/__dev/fault?on=0'); await click('#connectionBanner button'); await page.waitForSelector('#connectionBanner[hidden]'); pass('connection recovery');

    await control('/__dev/reset');
    await page.goto(origin + '/admin#orders', { waitUntil: 'networkidle0' }); await app();
    await fill('#orderSearch', '');
    await page.select('#orderPayment', 'all');
    for (const filter of ['active', 'served', 'cancelled', 'all']) { await click(`#orderFilters [data-filter="${filter}"]`); assert.equal(await page.$eval(`#orderFilters [data-filter="${filter}"]`, el => el.getAttribute('aria-selected')), 'true'); }
    await page.select('#orderPayment', 'cash'); assert.equal(await page.$$eval('#ordersList [data-order-id]', nodes => nodes.length), 1); pass('order status and payment filters');
    await page.goto(origin + '/admin#reports', { waitUntil: 'networkidle0' }); await app();
    const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
    await click('#exportReportsCsv'); await delay(300);
    assert.ok(fs.readFileSync(path.join(output, 'sushi-crazy-report-30-days.csv'), 'utf8').includes('Сумма')); pass('CSV export');
    await page.goto(origin + '/kitchen', { waitUntil: 'networkidle0' }); await app();
    for (const view of ['submitted', 'working', 'ready', 'all']) { await click(`#kitchenView [data-view="${view}"]`); assert.equal(await page.$eval('#kitchenBoard', el => el.dataset.view), view); }
    await click('#soundBtn'); assert.equal(await page.$eval('#soundBtn', el => el.getAttribute('aria-pressed')), 'true'); await click('#soundBtn'); pass('kitchen filters and sound');
    await click('.kitchen-nav a[href="/staff"]'); await app(); assert.ok(page.url().endsWith('/staff')); pass('kitchen to floor navigation');
    for (const filter of ['active', 'closable', 'all']) { await click(`#tableFilter [data-filter="${filter}"]`); assert.equal(await page.$eval(`#tableFilter [data-filter="${filter}"]`, el => el.getAttribute('aria-selected')), 'true'); }
    await click('.floor-nav a[href="/admin"]'); await app(); assert.ok(page.url().endsWith('/admin')); pass('floor filters and return to admin');
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewport({ width, height: width > 760 ? 1000 : 844 });
      for (const sectionName of ['overview', 'orders', 'tables', 'menu', 'reports']) {
        await page.goto(origin + '/admin#' + sectionName, { waitUntil: 'networkidle0' }); await app(); await delay(200);
        await layout(`admin-${sectionName}-${width}`);
      }
      for (const role of ['staff', 'kitchen']) {
        await page.goto(origin + '/' + role, { waitUntil: 'networkidle0' }); await app();
        await layout(`${role}-${width}`);
      }
    }
    await page.setViewport({ width: 390, height: 844 });
    await page.goto(origin + '/admin#tables', { waitUntil: 'networkidle0' }); await app(); await click('.admin-table-menu summary'); await layout('table-actions-390'); await page.click('#pageTitle');
    await click('.admin-mobile-more summary'); await layout('workspace-menu-390'); await page.click('#pageTitle');
    for (const [role, trigger, modal] of [['admin#tables', '#openCreateTableBtn', 'createTableModal'], ['admin#menu', '#openCreateDishBtn', 'dishModal'], ['kitchen', '.kitchen-more', 'cancelModal']]) {
      await page.goto(origin + '/' + role, { waitUntil: 'networkidle0' }); await app(); await click(trigger);
      await layout(`modal-${modal}-390`); await page.keyboard.press('Escape'); await closed(modal);
    }
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
    for (const role of ['admin#menu', 'staff', 'kitchen']) {
      await page.goto(origin + '/' + role, { waitUntil: 'networkidle0' }); await app(); await layout(`dark-${role.replace('#', '-')}-390`);
    }
    for (const scheme of ['light', 'dark']) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      for (const role of ['admin#overview', 'admin#orders', 'admin#tables', 'admin#menu', 'admin#reports', 'staff', 'kitchen']) {
        await page.goto(origin + '/' + role, { waitUntil: 'networkidle0' }); await app();
        await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
        const violations = await page.evaluate(async () => (await axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map(n => n.target) })));
        assert.deepEqual(violations, [], `${scheme} ${role} accessibility`); pass(`${scheme} ${role} accessibility`);
      }
    }
    await control('/__dev/reset?empty');
    for (const role of ['admin#orders', 'staff', 'kitchen']) {
      await page.goto(origin + '/' + role, { waitUntil: 'networkidle0' }); await app(); await layout(`empty-${role.replace('#', '-')}`);
    }
    assert.deepEqual(errors, []); pass('no uncaught browser errors');
    await control('/__dev/reset');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ checks, errors, testedAt: new Date().toISOString() }, null, 2));
    console.log(`Completed ${checks} browser checks. Screenshots: ${output}`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'failure.png') });
    console.error(error); process.exitCode = 1;
  } finally { await control('/__dev/fault?on=0'); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
