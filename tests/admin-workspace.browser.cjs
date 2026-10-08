const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const puppeteer=require('puppeteer-core');
const origin=process.env.MENU_TEST_ORIGIN||'http://127.0.0.1:4173';
assert.match(origin,/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
const output=path.resolve(__dirname,'../artifacts/admin-workspace');fs.mkdirSync(output,{recursive:true});
(async()=>{
  const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:process.env.CI?['--no-sandbox']:[]});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const reset=()=>fetch(origin+'/__dev/reset',{method:'POST'});
  const call=async(action,payload={},endpoint='admin-api')=>{
    const r=await fetch(origin+'/functions/v1/'+endpoint,{method:'POST',headers:{'Content-Type':'application/json',...(endpoint==='admin-api'?{'x-admin-pin':'1','x-admin-role':'admin'}:{'x-staff-pin':'1','x-staff-role':'admin'})},body:JSON.stringify({action,...payload})});
    assert.ok(r.ok,action+' '+r.status);return r.json();
  };
  const click=async selector=>{
    await page.waitForSelector(selector,{visible:true});
    for(let i=0;i<3;i++){try{await page.click(selector);return;}catch(e){if(i===2||!/detached/i.test(e.message))throw e;}}
  };
  const refreshSettings=()=>page.evaluate(async()=>{
    const original=window.loadRestaurantSettings;let pending;
    window.loadRestaurantSettings=(...args)=>{pending=original(...args);return pending;};
    try{document.getElementById('refreshBtn').click();await pending;}finally{window.loadRestaurantSettings=original;}
  });
  const holdAction=async action=>{
    await page.setRequestInterception(true);let held,resolveHeld;
    const seen=new Promise(resolve=>resolveHeld=resolve);
    const intercept=req=>{
      const body=req.postData();
      if(!held&&req.url().includes('/admin-api')&&body&&JSON.parse(body).action===action){held=req;resolveHeld();}
      else req.continue().catch(()=>{});
    };
    page.on('request',intercept);
    return {seen,release:()=>held.continue(),close:async()=>{page.off('request',intercept);await page.setRequestInterception(false);}};
  };
  const ids=()=>page.$eval('#ordersList [data-order-id]',rows=>rows.map(x=>Number(x.dataset.orderId)));
  try{
    await reset();
    await call('confirm-payment',{orderId:1044,paymentMethod:'kaspi'},'staff-orders');
    await call('update-order',{orderId:1041,status:'cancelled'},'staff-orders');
    await page.goto(origin+'/admin',{waitUntil:'networkidle0'});
    await page.type('#pin','1');await click('#loginForm button');await page.waitForSelector('#app:not([hidden])');
    assert.equal(await page.$eval('#adminNav',el=>!!el.querySelector('[data-section=settings]')),true,'settings must be accessible from navigation');
    await page.waitForFunction(()=>document.getElementById('stats').textContent.includes('Активные заказы'));
    const metric=key=>page.$eval('#stats [data-metric="'+key+'"] strong',el=>el.textContent);
    assert.equal(await metric('active'),'2');assert.equal(await metric('open'),'4');
    await page.waitForFunction(()=>document.querySelector('#stats [data-metric=paid] strong').textContent.includes('3'));
    assert.equal((await metric('paid')).replace(/\D/g,''),'3600');
    assert.equal((await metric('unpaid')).replace(/\D/g,''),'6900');
    console.log('PASS live workload and calendar shift payments, excluding cancelled orders');
    await page.waitForSelector('#attentionList [data-attention-order="1043"]');
    await click('#attentionList [data-attention-order="1043"]');await page.waitForSelector('#orderDrawer.on');
    assert.ok(await page.$eval('#orderDrawerTitle',el=>el.textContent.includes('1043')));await click('#closeOrderDrawerBtn');
    console.log('PASS attention opens the specific order');
    await click('#adminNav [data-section=orders]');
    await page.select('#orderPaid','unpaid');assert.deepEqual((await ids()).sort(),[1042,1043]);
    await page.select('#orderStage','ready');assert.deepEqual(await ids(),[1043]);
    await click('#clearOrderFilters');assert.deepEqual((await ids()).sort(),[1041,1042,1043,1044]);
    await page.select('#orderPaid','paid');assert.deepEqual(await ids(),[1044]);
    await page.select('#orderPaid','unpaid');await page.select('#orderPayment','card');assert.deepEqual(await ids(),[1042]);
    await click('#clearOrderFilters');
    console.log('PASS payment receipt, stage and method filters combine and reset');
    await click('#adminNav [data-section=overview]');await click('#quickStopList');
    await page.waitForFunction(()=>document.getElementById('menuResultTitle').textContent==='Стоп-лист');
    assert.ok(await page.$$eval('#menuDishes [data-menu-action=availability]',els=>els.length>0&&els.every(x=>x.dataset.available==='true')));
    console.log('PASS quick stop-list opens the correct filter');
    await click('#adminNav [data-section=settings]');await page.waitForSelector('#restaurantForm');
    await page.$eval('#restaurantForm [name=restaurant_name]',el=>{el.value='QA ресторан';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await page.goto(origin+'/admin#settings',{waitUntil:'networkidle0'});await page.waitForSelector('#restaurantForm');
    await page.$eval('#restaurantForm [name=restaurant_name]',el=>{el.value='QA ресторан';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('#restaurantForm [type=submit]');
    await page.waitForFunction(()=>document.getElementById('settingsFeedback').textContent.includes('сохранены'));
    assert.equal((await call('settings')).settings.restaurant_name,'QA ресторан');
    assert.equal(await page.$eval('#pageSettings',el=>el.hidden),false);
    console.log('PASS settings deep link and save without losing the page');
    await page.$eval('#restaurantForm [name=restaurant_name]',el=>{el.value='Несохранённый черновик';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('#refreshBtn');
    assert.equal(await page.$eval('#restaurantForm [name=restaurant_name]',el=>el.value),'Несохранённый черновик');
    console.log('PASS refresh preserves settings draft');
    await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#rolePinForm');
    await page.type('#rolePinForm [name=newPin]','987654');await refreshSettings();
    assert.equal(await page.$eval('#rolePinForm [name=newPin]',el=>el.value),'987654');
    console.log('PASS refresh preserves staff PIN draft');
    await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#restaurantForm');
    const delayedRefresh=await holdAction('settings');
    const refreshing=refreshSettings();await delayedRefresh.seen;
    await page.type('#restaurantForm [name=restaurant_name]',' — новый черновик');
    await delayedRefresh.release();await refreshing;await delayedRefresh.close();
    assert.ok(await page.$eval('#restaurantForm [name=restaurant_name]',el=>el.value.includes('новый черновик')));
    console.log('PASS delayed settings refresh preserves edits made while loading');
    await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('#restaurantForm');
    const delayedSave=await holdAction('save-settings');
    await page.$eval('#restaurantForm [name=restaurant_name]',el=>{el.value='Сохранённый снимок';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('#restaurantForm [type=submit]');await delayedSave.seen;
    await page.type('#restaurantForm [name=restaurant_name]',' — ещё не сохранено');
    await refreshSettings();
    await delayedSave.release();
    await page.waitForFunction(()=>document.querySelector('#restaurantForm [type=submit]').disabled===false);
    await delayedSave.close();
    assert.equal((await call('settings')).settings.restaurant_name,'Сохранённый снимок');
    assert.ok(await page.$eval('#settingsFeedback',el=>el.textContent.includes('несохранённые')));
    await refreshSettings();
    assert.ok(await page.$eval('#restaurantForm [name=restaurant_name]',el=>el.value.includes('ещё не сохранено')));
    console.log('PASS edits made during saving stay marked as unsaved and survive refresh');
    for(const scheme of ['light','dark']){
      await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-motion',value:'reduce'}]);
      for(const width of [320,390,760,764,768,1440]){
        await page.setViewport({width,height:width===1440?1000:844});
        for(const section of ['overview','orders','menu','settings']){
          await click('#adminNav [data-section='+section+']');
          await page.waitForFunction(name=>document.querySelector('[data-page="'+name+'"]').hidden===false,{},section);
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),section+' overflow '+width);
          assert.ok(await page.$eval('#adminNav button',els=>els.every(el=>el.scrollWidth<=el.clientWidth+2)), 'navigation fits '+width);
          const unreachable=await page.$$eval('#pageSettings input,#pageSettings select',els=>els.filter(el=>el.getClientRects().length).some(el=>{const b=el.getBoundingClientRect();return b.left<0||b.right>document.documentElement.clientWidth+2;}));
          assert.equal(unreachable,false,'settings fields fit '+width);
          await page.screenshot({path:path.join(output,section+'-'+width+'-'+scheme+'.png')});
        }
      }
    }
    assert.deepEqual(errors,[]);console.log('PASS responsive admin views and settings in both themes');
  }catch(e){await page.screenshot({path:path.join(output,'failure.png')});console.error(e);process.exitCode=1;}
  finally{await browser.close();await reset();}
})();
