const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const origin = process.env.MENU_TEST_ORIGIN || 'http://127.0.0.1:4173';
assert.match(origin, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/);
const output = path.resolve(__dirname, '../artifacts/ui-audit');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args:process.env.CI?['--no-sandbox']:[] });
  const page = await browser.newPage();
  let checks = 0;
  try {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
      for (const width of [1440, 390]) {
        await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
        for (const route of ['admin#overview', 'admin#orders', 'admin#tables', 'admin#menu', 'admin#reports', 'staff', 'kitchen']) {
          await page.goto(origin + '/' + route, { waitUntil: 'networkidle0' });
          if (await page.$('#login:not([hidden])')) {
            await page.type('#pin', route.startsWith('admin') ? '1' : '1');
            await page.click('#loginForm button');
          }
          await page.waitForSelector('#app:not([hidden])');
          const primary = await page.$('.create-table-btn, .kitchen-primary, .attention-action, #adminNav button.on');
          if (primary) { await primary.hover(); await primary.focus(); }
          const colored = await page.evaluate(() => {
            const findings = [];
            const properties = ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'boxShadow', 'textShadow', 'fill', 'stroke'];
            for (const element of document.querySelectorAll('body, body *')) {
              if (!element.getClientRects().length) continue;
              for (const pseudo of [null, '::before', '::after']) {
                const style = getComputedStyle(element, pseudo);
                if (pseudo && ['none', 'normal'].includes(style.content)) continue;
                for (const property of properties) {
                  for (const match of style[property].matchAll(/rgba?\(([^)]+)\)/g)) {
                    const [r, g, b, a = 1] = match[1].split(/[,\s/]+/).map(Number);
                    if (a !== 0 && (r !== g || g !== b)) findings.push({ element: element.tagName + '.' + element.className, pseudo, property, value: style[property] });
                  }
                }
              }
            }
            return findings.slice(0, 10);
          });
          assert.deepEqual(colored, [], `${scheme} ${width} ${route} has colored interface styles`);
          await page.screenshot({ path: path.join(output, `monochrome-${scheme}-${width}-${route.replace('#', '-')}.png`) });
          checks++; console.log(`PASS monochrome ${scheme} ${width} ${route}, including hover/focus`);
        }
      }
    }
    fs.writeFileSync(path.join(output, 'palette-result.json'), JSON.stringify({ checks, testedAt: new Date().toISOString() }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
