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
const control = async url => assert.equal((await fetch(origin + url, { method: 'POST' })).status, 200);
const state = async () => (await fetch(origin + '/__dev/state')).json();

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args:process.env.CI?['--no-sandbox']:[] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const click = async selector => {
    for(let attempt=0;attempt<3;attempt++){
      await page.waitForSelector(selector,{visible:true});
      await page.waitForFunction(sel=>{const el=document.querySelector(sel);return el&&!el.disabled;},{},selector);
      try{await page.click(selector);return;}catch(error){if(attempt===2||!/detached/i.test(error.message))throw error;}
    }
  };
  const login = async pin => { await page.$eval('#pin', el => { el.value = ''; }); await page.type('#pin', pin); await click('#loginForm button'); };
  const app = () => page.waitForSelector('#app:not([hidden])');
  try {
    await control('/__dev/reset');
    await browser.defaultBrowserContext().overridePermissions(origin, ['clipboard-read', 'clipboard-write']);
    await page.goto(origin + '/admin#tables', { waitUntil: 'networkidle0' }); await login('1'); await app();
    const table = (await state()).restaurant_tables.find(t => t.table_number === 7);
    await click(`[data-action=qr][data-id="${table.id}"]`);
    const url = await page.$eval('#qrUrl', el => el.value);
    await click('#copyQrBtn'); assert.equal(await page.evaluate(() => navigator.clipboard.readText()), url); pass('QR link copied');
    const png = path.join(output, 'sushi-crazy-table-7-qr-1200.png');
    if (fs.existsSync(png)) fs.unlinkSync(png);
    const cdp = await page.createCDPSession(); await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: output });
    await click('#downloadQrBtn');
    for (let i = 0; i < 30 && !fs.existsSync(png); i++) await delay(100);
    const image = fs.readFileSync(png);
    assert.equal(image.subarray(1, 4).toString(), 'PNG'); assert.equal(image.readUInt32BE(16), 1200); assert.equal(image.readUInt32BE(20), 1200); pass('printable QR PNG download');
    const popup = browser.waitForTarget(target => target.url() === url);
    await click('#openQrLinkBtn'); const guest = await (await popup).page();
    await guest.waitForFunction(() => tableOrdering.ready && Number(tableOrdering.table?.table_number) === 7); await guest.close(); pass('QR opens the correct guest menu');

    await page.goto(origin + '/kitchen', { waitUntil: 'networkidle0' }); await login('0000');
    await page.waitForFunction(() => document.getElementById('loginErr').textContent.length > 0); assert.equal(await page.$eval('#app', el => el.hidden), true); pass('kitchen rejects invalid PIN');
    await login('1'); await app();
    await click('.kitchen-ticket[data-order-id="1041"] .kitchen-more'); await control('/__dev/fault?on=1'); await click('#confirmCancelBtn');
    await page.waitForSelector('#connectionBanner:not([hidden])'); await page.waitForFunction(() => !document.getElementById('confirmCancelBtn').disabled);
    assert.ok(await page.$('#cancelModal.on')); assert.equal((await state()).orders.find(o => o.id === 1041).status, 'submitted'); pass('failed cancellation preserves order and dialog');
    await control('/__dev/fault?on=0'); await click('#confirmCancelBtn'); await page.waitForSelector('#cancelModal:not(.on)');
    assert.equal((await state()).orders.find(o => o.id === 1041).status, 'cancelled'); pass('cancellation retry succeeds');

    await page.goto(origin + '/staff', { waitUntil: 'networkidle0' }); await app(); await click('button[onclick="logout()"]'); await page.waitForSelector('#login:not([hidden])'); await login('0000');
    await page.waitForFunction(() => document.getElementById('loginErr').textContent.length > 0); assert.equal(await page.$eval('#app', el => el.hidden), true); pass('floor logout and invalid PIN');
    await login('1'); await app(); await click('button[onclick="resolveRequest(502)"]');
    const session = (await state()).table_sessions[3];
    await click('.floor-order-details[data-order-id="1044"] summary');await click('button[onclick="openPayment(1044)"]');await click('#confirmPaymentBtn');await page.waitForSelector('#paymentDialog:not([open])');
    await click(`button[onclick="openCloseTable('${session.id}')"]`); await control('/__dev/fault?on=1'); await click('#confirmCloseTableBtn');
    await page.waitForSelector('#connectionBanner:not([hidden])'); await page.waitForFunction(() => !document.getElementById('confirmCloseTableBtn').disabled);
    assert.ok(await page.$('#closeTableModal.on')); assert.equal((await state()).table_sessions.find(s => s.id === session.id).status, 'open'); pass('failed table completion preserves session and dialog');
    await control('/__dev/fault?on=0'); await click('#confirmCloseTableBtn'); await page.waitForSelector('#closeTableModal:not(.on)');
    assert.equal((await state()).table_sessions.find(s => s.id === session.id).status, 'closed'); pass('table completion retry succeeds');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'controls-result.json'), JSON.stringify({ checks, errors, testedAt: new Date().toISOString() }, null, 2));
    console.log(`Completed ${checks} supplementary browser checks.`);
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'controls-failure.png') }); console.error(error); process.exitCode = 1;
  } finally { await control('/__dev/fault?on=0'); await control('/__dev/reset'); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
