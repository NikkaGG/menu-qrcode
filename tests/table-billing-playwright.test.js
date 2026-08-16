const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const qrOrderingJs = fs.readFileSync(path.join(root, 'qr-ordering.js'), 'utf8');

test('Live Table Billing: customer requests bill with payment method and handles table close', async () => {
  let billRequestedPayload = null;
  let sessionClosed = false;

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
        table: { id: '11111111-1111-4111-8111-111111111111', number: '5' },
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          status: sessionClosed ? 'closed' : 'open'
        }
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
                price: 3400,
                description: 'Свежий лосось'
              }
            ]
          }
        ]
      }));
    }
    if (url.pathname === '/api/orders' && req.method === 'POST') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        order: {
          id: '66666666-6666-4666-8666-000000000001',
          sessionId: '22222222-2222-4222-8222-222222222222',
          status: 'cooking',
          total: 3400,
          tableNumber: '5',
          items: [{ dishId: '44444444-4444-4444-8444-444444444444', dishName: 'Филадельфия', dishPrice: 3400, quantity: 1, subtotal: 3400 }]
        }
      }));
    }
    if (url.pathname.endsWith('/bill-request') && req.method === 'POST') {
      let body = '';
      req.on('data', c => body += c);
      req.on('end', () => {
        billRequestedPayload = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          sessionId: '22222222-2222-4222-8222-222222222222',
          tableNumber: '5',
          paymentMethod: billRequestedPayload.paymentMethod,
          paymentLabel: billRequestedPayload.paymentMethod === 'kaspi' ? 'Kaspi QR' : 'Наличные'
        }));
      });
      return;
    }
    if (url.pathname.startsWith('/api/orders/')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        order: {
          id: '66666666-6666-4666-8666-000000000001',
          sessionId: '22222222-2222-4222-8222-222222222222',
          status: 'cooking',
          total: 3400,
          tableNumber: '5',
          items: [{ dishId: '44444444-4444-4444-8444-444444444444', dishName: 'Филадельфия', dishPrice: 3400, quantity: 1, subtotal: 3400 }]
        }
      }));
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('console', msg => console.log('[Browser]', msg.text()));
  page.on('pageerror', err => console.error('[Browser Error]', err.message));

  try {
    console.log('[Playwright] 1. Opening table...');
    await page.goto(`${baseUrl}/t/table_token_billing_test_1234`);
    const cookieBtn = page.locator('.cookie-ok');
    if (await cookieBtn.isVisible()) await cookieBtn.click();
    await page.waitForSelector('#menuArea', { state: 'visible' });

    console.log('[Playwright] 2. Placing order...');
    await page.locator('.cart-add-btn').first().click();
    await page.locator('#cpill').click();
    await page.locator('.order-btn').click();

    console.log('[Playwright] 3. Returning to menu and opening Roadmap...');
    await page.waitForSelector('#reorderBtn', { state: 'visible' });
    await page.locator('#reorderBtn').click();

    await page.waitForSelector('#orderStatusPill', { state: 'visible' });
    await page.locator('#orderStatusPill').click();
    await page.waitForSelector('#orderRoadmapOv.on', { state: 'visible' });

    console.log('[Playwright] 4. Clicking "Попросить счёт" button in roadmap...');
    const billBtn = page.locator('.roadmap-btn-bill');
    assert.equal(await billBtn.isVisible(), true);
    await billBtn.click();

    console.log('[Playwright] 5. Verifying payment method modal...');
    await page.waitForSelector('#requestBillOv.on', { state: 'visible' });
    const kaspiCard = page.locator('.bill-opt-card').first();
    assert.match(await kaspiCard.textContent(), /Kaspi/);

    console.log('[Playwright] 6. Confirming bill request...');
    await page.locator('#confirmBillBtn').click();

    console.log('[Playwright] 7. Verifying server received bill request...');
    await page.waitForFunction(() => {
      const banner = document.getElementById('rsbTitle')?.textContent || '';
      return banner.includes('Официант несёт счёт');
    }, { timeout: 5000 });

    assert.equal(billRequestedPayload.paymentMethod, 'kaspi');

    console.log('[Playwright] 8. Emulating waiter closes the table on backend...');
    await page.evaluate(() => {
      handleTableClosed(3400);
    });

    await page.waitForSelector('#clientStateTitle', { state: 'visible' });
    const closedTitle = await page.locator('#clientStateTitle').textContent();
    assert.match(closedTitle, /Спасибо за визит/);

    console.log('[Playwright] 9. Table billing and close flow verified successfully!');
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
});
