const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const qrOrderingJs = fs.readFileSync(path.join(root, 'qr-ordering.js'), 'utf8');

test('Multi-order Playwright E2E: consecutive orders track individual cooking/ready statuses', async () => {
  let orderCounter = 0;
  const ordersDb = new Map();

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/qr-ordering.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript' });
      return res.end(qrOrderingJs);
    }
    if (url.pathname.startsWith('/emoji/')) {
      const emojiPath = path.join(root, url.pathname);
      if (fs.existsSync(emojiPath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        return res.end(fs.readFileSync(emojiPath));
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      return res.end(Buffer.alloc(10));
    }
    if (url.pathname.startsWith('/api/tables/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        table: { id: '11111111-1111-4111-8111-111111111111', number: '7' },
        session: { id: '22222222-2222-4222-8222-222222222222', status: 'open' },
        orders: Array.from(ordersDb.values())
      }));
    }
    if (url.pathname === '/api/menu') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        categories: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Роллы',
            dishes: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                categoryId: '33333333-3333-4333-8333-333333333333',
                name: 'Филадельфия',
                price: 3200,
                description: 'Свежий лосось'
              },
              {
                id: '55555555-5555-4555-8555-555555555555',
                categoryId: '33333333-3333-4333-8333-333333333333',
                name: 'Калифорния',
                price: 2800,
                description: 'Краб и авокадо'
              }
            ]
          }
        ]
      }));
    }
    if (url.pathname === '/api/orders' && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        orderCounter += 1;
        const parsed = JSON.parse(body);
        const orderId = `66666666-6666-4666-8666-00000000000${orderCounter}`;
        const newOrder = {
          id: orderId,
          sessionId: parsed.session_id,
          status: 'new',
          total: parsed.items[0].quantity * 3000,
          tableNumber: '7',
          items: parsed.items.map(it => ({
            dishId: it.dish_id,
            dishName: it.dish_id === '44444444-4444-4444-8444-444444444444' ? 'Филадельфия' : 'Калифорния',
            dishPrice: 3000,
            quantity: it.quantity,
            subtotal: it.quantity * 3000
          }))
        };
        ordersDb.set(orderId, newOrder);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ order: newOrder }));
      });
      return;
    }
    if (url.pathname.startsWith('/api/orders/')) {
      const orderId = url.pathname.replace('/api/orders/', '');
      const found = ordersDb.get(orderId);
      if (found) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ order: found }));
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'Order not found' }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });

  try {
    console.log('[Playwright] 1. Navigating to table token route...');
    await page.goto(`${baseUrl}/t/table_token_multi_test_1234`);
    await page.waitForSelector('#menuArea', { state: 'visible' });
    const cookieBtn = page.locator('.cookie-ok');
    if (await cookieBtn.isVisible()) await cookieBtn.click();
    await page.waitForSelector('#menuArea', { state: 'visible' });

    console.log('[Playwright] 2. Adding first dish (Филадельфия) and placing Order #1...');
    const firstAddBtn = page.locator('.cart-add-btn').first();
    await firstAddBtn.click();
    await page.locator('#cpill').click();
    await page.locator('.order-btn').click();

    console.log('[Playwright] 3. Verifying Order #1 confirmation screen...');
    await page.waitForSelector('#clientStateTitle', { state: 'visible' });
    const title1 = await page.locator('#clientStateTitle').textContent();
    assert.match(title1, /Заказ принят|Заказ/);

    console.log('[Playwright] 4. Clicking "Вернуться в меню" to return to catalog...');
    const reorderBtn = page.locator('#reorderBtn');
    assert.equal(await reorderBtn.textContent(), 'Вернуться в меню');
    await reorderBtn.click();

    console.log('[Playwright] 5. Verifying Floating Status Bar appeared in catalog...');
    await page.waitForSelector('#orderStatusShell:not([hidden])', { state: 'visible' });
    const statusTitle1 = await page.locator('#ospTitle').textContent();
    assert.match(statusTitle1, /Заказ: Принят|Заказов/);

    console.log('[Playwright] 6. Adding second dish (Калифорния) and placing Order #2...');
    const secondAddBtn = page.locator('.cart-add-btn').nth(1);
    await secondAddBtn.click();
    await page.locator('#cpill').click();
    await page.locator('.order-btn').click();

    console.log('[Playwright] 7. Returning to menu for Order #2...');
    await page.waitForSelector('#reorderBtn', { state: 'visible' });
    await page.locator('#reorderBtn').click();

    console.log('[Playwright] 8. Verifying Multi-order Floating Status Bar...');
    await page.waitForSelector('#orderStatusShell:not([hidden])', { state: 'visible' });
    const statusTitle2 = await page.locator('#ospTitle').textContent();
    assert.match(statusTitle2, /Заказов принято:\s*2|2 заказа/);
    console.log('[Playwright] 9. Chef updates Order #1 status to "cooking" on server...');
    const order1 = ordersDb.get('66666666-6666-4666-8666-000000000001');
    order1.status = 'cooking';

    console.log('[Playwright] 10. Waiting for poller to sync Order #1 cooking status...');
    await page.waitForFunction(() => {
      const text = document.getElementById('ospTitle')?.textContent || '';
      return text.includes('Готовится');
    }, { timeout: 8000 });

    console.log('[Playwright] 11. Chef updates Order #2 status to "cooking" on server...');
    const order2 = ordersDb.get('66666666-6666-4666-8666-000000000002');
    order2.status = 'cooking';

    console.log('[Playwright] 12. Opening Roadmap Sheet and verifying multi-order tabs...');
    await page.locator('#orderStatusPill').click();
    await page.waitForSelector('#orderRoadmapOv.on', { state: 'visible' });

    await page.waitForFunction(() => {
      const tabs = document.querySelectorAll('.roadmap-tab');
      return tabs.length === 2 && tabs[1].querySelector('.rmt-dot.cooking');
    }, { timeout: 8000 });

    const tabs = page.locator('.roadmap-tab');
    assert.equal(await tabs.count(), 2);
    const tab1Text = await tabs.nth(0).textContent();
    const tab2Text = await tabs.nth(1).textContent();
    assert.match(tab1Text, /Заказ №1/);
    assert.match(tab2Text, /Заказ №2/);
    await tabs.nth(0).click();
    await page.waitForSelector('#rmStepCooking.active');

    console.log('[Playwright] 14. Clicking Tab 2 -> checking Order #2 cooking step is active...');
    await tabs.nth(1).click();
    await page.waitForSelector('#rmStepCooking.active');

    console.log('[Playwright] 15. Chef completes Order #1 to "ready"...');
    order1.status = 'ready';

    console.log('[Playwright] 16. Checking Tab 1 dot updates to ready while Tab 2 stays cooking...');
    await page.waitForFunction(() => {
      const dots = document.querySelectorAll('.roadmap-tab .rmt-dot');
      return dots[0]?.classList.contains('ready') && dots[1]?.classList.contains('cooking');
    }, { timeout: 8000 });

    console.log('[Playwright] 17. Multi-order tracking verified successfully on Playwright!');
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
});
