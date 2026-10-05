const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const origin = process.env.MENU_PRODUCTION_ORIGIN || 'https://menu-qrcode-lt1q.vercel.app';
const token = process.env.MENU_TABLE_TOKEN || '1617390c-d431-49aa-aa42-f4bb6a982117';
const output = path.resolve(__dirname, '../artifacts/ui-audit');
const readActions = new Set(['public-settings', 'bootstrap', 'status', 'dashboard', 'orders', 'menu', 'financial', 'settings', 'role-access', 'incidents', 'push-config']);
fs.mkdirSync(output, {recursive:true});

(async()=>{
  const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:process.env.CI?['--no-sandbox']:[]});
  const page = await browser.newPage(), errors = [], blocked = [];
  page.setDefaultTimeout(60000);
  page.on('pageerror',e=>errors.push(e.message));
  // Production checks can read only; reject every mutation before it reaches the server.
  await page.setRequestInterception(true);
  page.on('request',request=>{
    if(!['GET','HEAD','OPTIONS'].includes(request.method())){
      let action;try{action=JSON.parse(request.postData()||'{}').action;}catch(_){}
      if(request.method()!=='POST'||!request.url().includes('/functions/v1/')||!readActions.has(action)){blocked.push(request.method()+' '+String(action));return request.abort();}
    }
    request.continue();
  });
  let checks=0;const pass=name=>{checks++;console.log('PASS '+name);};
  try{
    await page.setViewport({width:1440,height:1000});
    await page.goto(origin+'/',{waitUntil:'networkidle0'});
    assert.equal(await page.$eval('#mainContent',el=>getComputedStyle(el).display),'none');pass('production without QR is gated');
    await page.goto(origin+'/?table='+encodeURIComponent(token),{waitUntil:'networkidle0'});
    await page.waitForFunction(()=>menuReady&&tableOrdering.ready);
    const menu=await page.evaluate(()=>({count:M.length,session:tableOrdering.session,config:window.MenuConfig,items:M.map(x=>({id:x.id,price:x.p}))}));
    assert.ok(menu.count>0);assert.ok(menu.items.every(x=>x.price>0));pass('real QR menu and positive prices load');
    await page.evaluate(()=>document.querySelectorAll('img[loading="lazy"]').forEach(img=>img.loading='eager'));
    for(let y=0;y<await page.evaluate(()=>document.documentElement.scrollHeight);y+=700){await page.evaluate(y=>window.scrollTo(0,y),y);await new Promise(r=>setTimeout(r,100));}
    await page.waitForFunction(()=>[...document.images].filter(i=>i.getClientRects().length).every(i=>i.complete&&i.naturalWidth>0));
    await page.evaluate(()=>window.scrollTo(0,0));
    await page.screenshot({path:path.join(output,'production-menu-desktop.png')});pass('visible production photos and branding render');
    await page.setViewport({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2));
    await page.screenshot({path:path.join(output,'production-menu-phone.png')});pass('production guest menu fits phone');
    const manifest=await(await fetch(origin+'/manifest.webmanifest')).json();assert.ok(manifest.name);assert.ok(manifest.icons.length);pass('configured PWA manifest responds');
    for(const [route,pin] of [['admin',process.env.MENU_ADMIN_PIN||'1'],['staff',process.env.MENU_WAITER_PIN||'1'],['kitchen',process.env.MENU_KITCHEN_PIN||'1']]){
      await page.setViewport({width:1440,height:1000});await page.goto(origin+'/'+route,{waitUntil:'networkidle0'});
      if(await page.$eval('#app',el=>el.hidden)){await page.type('#pin',pin);await page.click('#loginForm button');}await page.waitForSelector('#app:not([hidden])');
      if(route==='admin'){
        await page.click('#adminNav [data-section=reports]');await page.waitForSelector('#paidReports .product-metrics');
        assert.equal(await page.$('#shiftButton'),null);assert.ok(await page.$eval('#paidReports',el=>el.textContent.includes('Ежедневная смена')));
        await page.click('button[aria-label="Настройки ресторана"]');await page.waitForSelector('#restaurantSettings[open]');await page.click('#settingsCancel');
      }
      await page.screenshot({path:path.join(output,'production-'+route+'.png')});pass('production '+route+' login and read-only dashboard');
    }
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);pass('no browser errors or attempted mutations');
    console.log('Completed '+checks+' read-only production checks; dishes: '+menu.count+'.');
  }catch(e){console.error(await page.evaluate(()=>[...document.images].filter(i=>i.getClientRects().length&&(!i.complete||!i.naturalWidth)).map(i=>({src:i.src,complete:i.complete}))));await page.screenshot({path:path.join(output,'production-failure.png')});console.error(e);process.exitCode=1;}finally{await browser.close();}
})();
