const assert = require('node:assert/strict');
const puppeteer = require('puppeteer-core');
const origin = process.env.MENU_TEST_ORIGIN || 'http://127.0.0.1:4187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname));

(async () => {
  const browser = await puppeteer.launch({executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, pipe: true, args: ['--no-sandbox', '--disable-gpu']});
  const page = await browser.newPage();
  page.setDefaultTimeout(7000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let failures = 0;
  try {
    await fetch(origin + '/__dev/reset', {method: 'POST'});
    const state = await (await fetch(origin + '/__dev/state')).json();
    const menuUrl = origin + '/?table=' + state.restaurant_tables[0].qr_token;
    await page.setViewport({width: 430, height: 932, isMobile: true, hasTouch: true});
    const load = async () => {
      await page.goto(origin + '/offline.html');
      await page.goto(menuUrl, {waitUntil: 'networkidle0'});
      await page.waitForSelector('#orderTracker:not([hidden])');
      await page.evaluate(() => {acceptCookies(); window.scrollTo(0, 900);});
    };
    const open = async () => {
      await page.click('#orderTracker');
      await page.waitForFunction(() => {
        const sheet = document.querySelector('#orderDetailsOv .sheet');
        return document.getElementById('orderDetailsOv').classList.contains('on') && Math.abs(new DOMMatrix(getComputedStyle(sheet).transform).m42) < 1;
      });
    };
    const check = async (name, run) => {
      try {await load(); await run(); console.log('PASS ' + name);}
      catch (error) {failures++; console.error('FAIL ' + name + ': ' + error.message); console.error(await page.evaluate(() => ({url:location.href, gate:document.getElementById('guestGateText')?.textContent, tracker:document.getElementById('orderTracker')?.textContent})));}
    };
    await check('browser Back closes order details and keeps the menu and its scroll position', async () => {
      await open();
      await page.goBack();
      await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
      assert.equal(page.url(), menuUrl, 'Back must not leave the QR menu');
      assert.equal(await page.evaluate(() => orderDetailsOv.classList.contains('on')), false);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - 900) < 3);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'orderTracker');
    });
    await check('menu stays locked while the details sheet closes', async () => {
      await open();
      await page.click('#orderDetailsClose');
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 60)));
      const closing = await page.evaluate(() => {
        const ov = document.getElementById('orderDetailsOv');
        return {opacity: Number(getComputedStyle(ov).opacity), locked: document.body.classList.contains('modal-lock'), trackerVisible: getComputedStyle(orderTracker).visibility === 'visible'};
      });
      assert.ok(closing.opacity < .01 || closing.locked, 'The menu must stay locked while the overlay is visible: ' + JSON.stringify(closing));
      assert.ok(closing.opacity < .01 || !closing.trackerVisible, 'The capsule must not reappear underneath the closing sheet');
      await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - 900) < 3);
      assert.equal(await page.evaluate(() => document.activeElement.id), 'orderTracker');
    });
    await check('details finish opening within 250 ms even when the status API is slow', async () => {
      await page.setRequestInterception(true);
      const intercept = request => {
        if (request.url().endsWith('/functions/v1/table-api')) setTimeout(() => request.continue().catch(() => {}), 1500);
        else request.continue().catch(() => {});
      };
      page.on('request', intercept);
      try {
        await page.evaluate(() => {window.trackerOpenedAt = performance.now(); openOrderDetails();});
        await page.waitForFunction(() => Math.abs(new DOMMatrix(getComputedStyle(document.querySelector('#orderDetailsOv .sheet')).transform).m42) < 1);
        const elapsed = await page.evaluate(() => performance.now() - window.trackerOpenedAt);
        assert.ok(elapsed < 250, 'Opening took ' + Math.round(elapsed) + ' ms');
        assert.ok(await page.$eval('#orderDetailsList', el => el.textContent.includes('1041')));
        console.log('Opening time: ' + Math.round(elapsed) + ' ms');
      } finally {page.off('request', intercept); await page.setRequestInterception(false);}
    });
    await check('connection errors keep saved details and are announced on the capsule', async () => {
      await fetch(origin + '/__dev/fault?on=1', {method: 'POST'});
      try {
        await page.evaluate(() => refreshTableStatus(false));
        await page.waitForFunction(() => tableOrdering.statusError);
        const status = await page.$eval('#orderTrackerStatus', el => el.textContent);
        assert.ok((await page.$eval('#orderTracker', el => el.getAttribute('aria-label'))).startsWith(status), 'Accessible status must include the connection problem');
        await open();
        assert.ok(await page.$eval('#orderDetailsList', el => el.textContent.includes('1041')));
      } finally {
        await fetch(origin + '/__dev/fault?on=0', {method: 'POST'});
        await page.evaluate(() => refreshTableStatus(false));
      }
    });
    await check('repeated close, Forward and Escape keep focus and scroll on a narrow phone', async () => {
      await page.setViewport({width: 320, height: 740, isMobile: true, hasTouch: true});
      for (let attempt = 0; attempt < 3; attempt++) {
        await open();
        await page.click('#orderDetailsClose');
        await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
        await page.goForward();
        await page.waitForFunction(() => orderDetailsOv.classList.contains('on'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
        assert.equal(page.url(), menuUrl);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'orderTracker');
        assert.ok(Math.abs(await page.evaluate(() => scrollY) - 900) < 3);
      }
    });
    await check('rapid Back, Forward and Escape do not unlock during a second closing animation', async () => {
      await open();
      await page.goBack();
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      await page.goForward();
      await page.waitForFunction(() => orderDetailsOv.classList.contains('on'));
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !orderDetailsOv.classList.contains('on'));
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 90)));
      assert.equal(await page.evaluate(() => document.body.classList.contains('modal-lock')), true, 'An earlier close callback must not unlock the newer closing sheet');
      await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'orderTracker');
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - 900) < 3);
    });
    await check('reduced motion closes immediately without losing menu position', async () => {
      await page.emulateMediaFeatures([{name: 'prefers-reduced-motion', value: 'reduce'}]);
      await open();
      await page.click('#orderDetailsClose');
      await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
      assert.equal(page.url(), menuUrl);
      assert.ok(Math.abs(await page.evaluate(() => scrollY) - 900) < 3);
    });
    assert.deepEqual(errors, []);
    if (failures) process.exitCode = 1;
  } finally {await browser.close();}
})();
