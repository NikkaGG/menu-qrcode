const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const qrOrderingJs = fs.readFileSync(path.join(root, 'qr-ordering.js'), 'utf8');

test('Multi-device Live Table Sync: two phones at the same table see each other orders in realtime', async () => {
  let orderCounter = 0;
  const sessionOrders = [];
  let isSessionClosed = false;

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
        table: { id: '11111111-1111-4111-8111-111111111111', number: '9' },
        session: {
          id: '22222222-2222-4222-8222-222222222222',
          status: isSessionClosed ? 'closed' : 'open'
        },
        orders: sessionOrders
      }));
    }
    if (url.pathname === '/api/menu') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({
        categories: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            name: 'Меню',
            dishes: [
              {
                id: '44444444-4444-4444-8444-444444444444',
                categoryId: '33333333-3333-4333-8333-333333333333',
                name: 'Грандбургер',
                price: 2500,
                description: 'Сочный бургер'
              },
              {
                id: '55555555-5555-4555-8555-555555555555',
                categoryId: '33333333-3333-4333-8333-333333333333',
                name: 'Филадельфия',
                price: 3400,
                description: 'Лосось'
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
        const dishId = parsed.items[0].dish_id;
        const dishName = dishId === '44444444-4444-4444-8444-444444444444' ? 'Грандбургер' : 'Филадельфия';
        const price = dishId === '44444444-4444-4444-8444-444444444444' ? 2500 : 3400;
        const newOrder = {
          id: `66666666-6666-4666-8666-00000000000${orderCounter}`,
          sessionId: parsed.session_id,
          status: 'new',
          total: price,
          tableNumber: '9',
          items: [{ dishId, dishName, dishPrice: price, quantity: 1, subtotal: price }]
        };
        sessionOrders.push(newOrder);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ order: newOrder }));
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(indexHtml);
  });

  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const browser = await chromium.launch({ headless: true });
  
  // Two separate devices / browser contexts (Device 1 and Device 2)
  const context1 = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const context2 = await browser.newContext({ viewport: { width: 390, height: 844 } });

  const page1 = await context1.newPage();
  const page2 = await context2.newPage();

  try {
    console.log('[Playwright] 1. Device 1 (Mom) and Device 2 (Son) open Table 9...');
    await page1.goto(`${baseUrl}/t/table_token_family_1234`);
    const c1 = page1.locator('.cookie-ok');
    if (await c1.isVisible()) await c1.click();
    await page1.waitForSelector('#menuArea', { state: 'visible' });

    await page2.goto(`${baseUrl}/t/table_token_family_1234`);
    const c2 = page2.locator('.cookie-ok');
    if (await c2.isVisible()) await c2.click();
    await page2.waitForSelector('#menuArea', { state: 'visible' });

    console.log('[Playwright] 2. Mom (Device 1) orders Грандбургер (Order #1)...');
    await page1.locator('.cart-add-btn').first().click();
    await page1.locator('#cpill').click();
    await page1.locator('.order-btn').click();
    await page1.waitForSelector('#reorderBtn', { state: 'visible' });
    await page1.locator('#reorderBtn').click();
    await page1.waitForSelector('#orderStatusPill', { state: 'visible' });

    console.log('[Playwright] 3. Verifying Son (Device 2) automatically receives Order #1 via realtime table sync...');
    await page2.waitForSelector('#orderStatusPill:not([hidden])', { timeout: 7000 });
    const sonPillText = await page2.locator('#ospTitle').textContent();
    assert.match(sonPillText, /Заказ.*Принят/);

    console.log('[Playwright] 4. Son opens Roadmap on Device 2 to check Mom order...');
    await page2.locator('#orderStatusPill').click();
    await page2.waitForSelector('#orderRoadmapOv.on', { state: 'visible' });
    const sonRoadmapItem = await page2.locator('.rir-name').first().textContent();
    assert.match(sonRoadmapItem, /Грандбургер/);
    await page2.locator('.roadmap-close').click();

    console.log('[Playwright] 5. Son (Device 2) orders Филадельфия (Order #2)...');
    await page2.locator('.cart-add-btn').nth(1).click();
    await page2.locator('#cpill').click();
    await page2.locator('.order-btn').click();
    await page2.waitForSelector('#reorderBtn', { state: 'visible' });
    await page2.locator('#reorderBtn').click();

    console.log('[Playwright] 6. Verifying Mom (Device 1) receives notification and sees 2 orders...');
    await page1.waitForFunction(() => {
      const title = document.getElementById('ospTitle')?.textContent || '';
      return title.includes('2');
    }, { timeout: 7000 });

    const momPillText = await page1.locator('#ospTitle').textContent();
    assert.match(momPillText, /2/);

    console.log('[Playwright] 7. Chef starts cooking both orders on server...');
    sessionOrders[0].status = 'cooking';
    sessionOrders[1].status = 'cooking';

    console.log('[Playwright] 8. Verifying both Device 1 and Device 2 update to "Готовится"...');
    await page1.waitForFunction(() => {
      return document.getElementById('ospTitle')?.textContent.includes('Готовится');
    }, { timeout: 7000 });
    await page2.waitForFunction(() => {
      return document.getElementById('ospTitle')?.textContent.includes('Готовится');
    }, { timeout: 7000 });

    console.log('[Playwright] 9. Waiter closes table on backend...');
    isSessionClosed = true;

    console.log('[Playwright] 10. Verifying both devices transition to table closed screen in realtime...');
    await page1.waitForSelector('#clientStateTitle', { state: 'visible', timeout: 7000 });
    await page2.waitForSelector('#clientStateTitle', { state: 'visible', timeout: 7000 });

    const title1 = await page1.locator('#clientStateTitle').textContent();
    const title2 = await page2.locator('#clientStateTitle').textContent();
    assert.match(title1, /Спасибо за визит/);
    assert.match(title2, /Спасибо за визит/);

    console.log('[Playwright] 11. Realtime multi-device table sync 100% verified!');
  } finally {
    await browser.close();
    await new Promise(r => server.close(r));
  }
});
