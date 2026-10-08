const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const puppeteer = require('puppeteer-core');
const origin = process.env.MENU_TEST_ORIGIN || 'http://127.0.0.1:4187';
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Use only an isolated fixture');
const out = path.resolve(__dirname, '../artifacts/guest-tracker');
fs.mkdirSync(out, {recursive:true});
async function call(endpoint, body, role) {
  const response = await fetch(origin + '/functions/v1/' + endpoint, {method:'POST', headers:{'Content-Type':'application/json', ...(role ? {'x-staff-pin':'1','x-staff-role':role} : {})}, body:JSON.stringify(body)});
  const data = await response.json();
  assert.ok(response.ok, JSON.stringify(data));
  return data;
}
(async () => {
  const browser = await puppeteer.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,pipe:true,args:['--no-sandbox','--disable-gpu']});
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  try {
    await fetch(origin+'/__dev/reset?empty', {method:'POST'});
    const initial = await (await fetch(origin+'/__dev/state')).json();
    const table = initial.restaurant_tables[0];
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await page.goto(origin+'/?table='+table.qr_token, {waitUntil:'networkidle0'});
    await page.waitForFunction(() => menuReady && tableOrdering.ready);
    await page.evaluate(() => acceptCookies());
    assert.equal(await page.$('#tableOrderPanel'), null, 'The table section must not occupy the menu');
    assert.equal(await page.$eval('#orderTracker', el => el.hidden), true, 'No tracker before the first order');
    await page.evaluate(() => {addCart(7); addCart(14); window.scrollTo(0,900);});
    const scrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => {setPayment('kaspi'); openCart();});
    await page.waitForFunction(() => {const b=document.getElementById('orderBtn'),r=b.getBoundingClientRect();return !b.disabled && r.top>=0 && r.bottom<=innerHeight;});
    await page.click('#orderBtn');
    await page.waitForFunction(() => !document.getElementById('cartOv').classList.contains('on'));
    await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
    await page.waitForSelector('#orderTracker:not([hidden])');
    const afterScroll=await page.evaluate(() => window.scrollY);
    assert.ok(Math.abs(afterScroll - scrollY) < 3, 'Sending must preserve the menu position: '+scrollY+' -> '+afterScroll);
    assert.match(await page.$eval('#orderTracker', el => el.textContent), /Отправлен/);
    await page.click('#orderTracker');
    await page.waitForSelector('#orderDetailsOv.on');
    await page.waitForFunction(() => document.getElementById('orderDetailsClose').getBoundingClientRect().bottom<=innerHeight);
    const details = await page.$eval('#orderDetailsList', el => el.textContent);
    assert.match(details, /Гамбургер|гамбургер/);
    assert.match(details, /Kaspi/);
    assert.match(details, /₸/);
    await page.click('#orderDetailsClose');
    await page.waitForFunction(() => !document.body.classList.contains('modal-lock'));
    const state = await (await fetch(origin+'/__dev/state')).json();
    const id = state.orders[0].id;
    await page.waitForFunction(() => tableOrdering.liveConnected);
    // Disable backup polling: only a real server broadcast may satisfy this check.
    await page.evaluate(() => stopTablePolling());
    for (const [status, label] of [['accepted','Принят'], ['preparing','Готовится'], ['ready','Готов'], ['served','Подан']]) {
      await call('staff-orders', {action:'update-order',orderId:id,status}, status==='served' ? 'waiter' : status==='accepted' ? 'admin' : 'kitchen');
      await page.waitForFunction(wanted => tableOrdering.orders.find(o => o.id===wanted.id)?.status===wanted.status, {timeout:2500}, {id,status});
      assert.ok((await page.$eval('#orderTracker', el => el.textContent)).includes(label));
      assert.ok((await page.$eval('#orderUpdateNotice', el => el.textContent)).includes(label));
    }
    await page.reload({waitUntil:'networkidle0'});
    await page.waitForSelector('#orderTracker:not([hidden])');
    assert.match(await page.$eval('#orderTracker', el => el.textContent), /Подан/);
    await page.evaluate(() => {document.getElementById('cookieBar').classList.add('on');document.body.classList.add('cookie-visible');});
    await page.waitForFunction(() => document.getElementById('orderTracker').getBoundingClientRect().bottom < document.getElementById('cookieBar').getBoundingClientRect().top);
    assert.ok(await page.evaluate(() => document.getElementById('orderTracker').getBoundingClientRect().bottom < document.getElementById('cookieBar').getBoundingClientRect().top), 'Cookie consent must not obscure order status');
    await page.evaluate(() => acceptCookies());
    // Another guest at the same table can place another order, without exposing tokens.
    await call('table-api', {action:'place-order',tableToken:table.qr_token,guestToken:crypto.randomUUID(),clientRequestId:crypto.randomUUID(),paymentMethod:'cash',items:[{id:14,quantity:1,unitPrice:initial.dishes[13].price,modifiers:[]}]});
    await page.waitForFunction(() => tableOrdering.orders.length===2, {timeout:2500});
    await page.evaluate(() => addCart(14));
    await page.waitForFunction(() => document.body.classList.contains('cart-has-items'));
    await page.evaluate(() => new Promise(resolve=>setTimeout(resolve,350)));
    assert.ok(await page.evaluate(() => orderTracker.getBoundingClientRect().bottom < cpShell.getBoundingClientRect().top),'Existing order tracker must sit above a new cart');
    await page.evaluate(() => {cookieBar.classList.add('on');document.body.classList.add('cookie-visible');});
    await page.evaluate(() => new Promise(resolve=>setTimeout(resolve,350)));
    assert.ok(await page.evaluate(() => orderTracker.getBoundingClientRect().bottom < cpShell.getBoundingClientRect().top && cpShell.getBoundingClientRect().bottom < cookieBar.getBoundingClientRect().top),'Orders, new cart and cookies must not overlap');
    await page.evaluate(() => {acceptCookies();clearCart(true);});
    await page.click('#orderTracker');
    await page.waitForSelector('#orderDetailsOv.on');
    await page.waitForFunction(() => document.getElementById('orderDetailsClose').getBoundingClientRect().bottom<=innerHeight);
    assert.equal(await page.$$eval('#orderDetailsList article', els => els.length), 2);
    await page.waitForFunction(() => {const ov=document.getElementById('orderDetailsOv');return ov.classList.contains('on') && Number(getComputedStyle(ov).opacity)===1 && Math.abs(new DOMMatrix(getComputedStyle(ov.querySelector('.sheet')).transform).m42)<1;});
    const progress=await page.$eval('.table-status-step.active',el=>({connector:getComputedStyle(el,'::before').content,border:getComputedStyle(el.querySelector('i')).borderTopWidth,height:el.querySelector('i').getBoundingClientRect().height}));
    assert.ok(['none','normal'].includes(progress.connector),'The legacy connector must not create a second progress line');
    assert.equal(progress.border,'0px','A progress bar must not inherit the legacy dot border');
    assert.equal(progress.height,3);
    assert.equal(await page.$eval('.guest-order-state[data-status="served"]',el=>el.closest('article').querySelector('.table-status-steps')),null,'Served order details keep their status without repeating an active timeline');
    for (const width of [390,320,430,1440]) {
      await page.setViewport({width,height:844,isMobile:true,hasTouch:true});
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth+1), 'No horizontal overflow');
      await page.screenshot({path:path.join(out,'details-'+width+'.png')});
    }
    // Stress only the isolated guest view: long names, notes, many orders and cancelled totals.
    const totalBefore=await page.$eval('#orderDetailsTotal',el=>el.textContent);
    await page.evaluate(()=>{
      const base=tableOrdering.orders[0];
      tableOrdering.orders.push({...base,id:9001,status:'cancelled',total:999999,comment:'Без лука.\nКомментарий с <угловыми скобками>.',order_items:[{name:'Очень длинное название блюда без сокращений '.repeat(4),quantity:2,line_total:999999,item_comment:'Пожелания к блюду '.repeat(8)}]});
      renderOrderDetails();
    });
    assert.equal(await page.$eval('#orderDetailsTotal',el=>el.textContent),totalBefore,'Cancelled orders must not increase the table total');
    assert.ok(await page.$eval('#orderDetailsList',el=>el.textContent.includes('<угловыми скобками>')),'Notes remain readable as text');
    await page.evaluate(()=>{
      const base=tableOrdering.orders[0];
      for(let i=0;i<12;i++)tableOrdering.orders.push({...base,id:9100+i,status:'served'});
      renderOrderDetails();
    });
    const readingShift=await page.evaluate(()=>{
      const orders=trackedTableOrders();
      orders[0].status='preparing';renderOrderDetails(orders);
      const label=document.querySelectorAll('.guest-order-number')[4].textContent;
      const find=()=>[...document.querySelectorAll('.guest-order-number')].find(el=>el.textContent===label);
      orderDetailsList.scrollTop+=find().getBoundingClientRect().top-orderDetailsList.getBoundingClientRect().top-8;
      const before=find().getBoundingClientRect().top;
      orders[0].status='served';renderOrderDetails(orders);
      return find().getBoundingClientRect().top-before;
    });
    assert.ok(Math.abs(readingShift)<2,'Completing an order above the reader must not move the visible order: '+readingShift+'px');
    const itemShift=await page.evaluate(()=>{
      const orders=trackedTableOrders();
      orders[0].status='preparing';renderOrderDetails(orders);
      const find=()=>orderDetailsList.querySelector('.guest-order-item');
      orderDetailsList.scrollTop+=find().getBoundingClientRect().top-orderDetailsList.getBoundingClientRect().top-8;
      const before=find().getBoundingClientRect().top;
      orders[0].status='served';renderOrderDetails(orders);
      return find().getBoundingClientRect().top-before;
    });
    assert.ok(Math.abs(itemShift)<2,'Completing the order being read must preserve the visible dish: '+itemShift+'px');
    for(const [width,height] of [[320,740],[430,740],[430,600],[1440,740]]){
      await page.setViewport({width,height,isMobile:true,hasTouch:true});
      const layout=await page.evaluate(()=>{
        const list=orderDetailsList,foot=document.querySelector('.order-details-foot'),footRect=foot.getBoundingClientRect();
        list.scrollTop=list.scrollHeight;
        const listRect=list.getBoundingClientRect(),payment=list.querySelector('article:last-child .guest-order-payment').getBoundingClientRect();
        return {overflow:list.scrollWidth>list.clientWidth+1,scrollable:list.scrollHeight>list.clientHeight,footerInside:footRect.top>=0&&footRect.bottom<=innerHeight,listBeforeFooter:listRect.bottom<=footRect.top+1,paymentVisible:payment.top>=listRect.top&&payment.bottom<=listRect.bottom+1&&payment.right<=listRect.left+list.clientWidth+1};
      });
      assert.equal(layout.overflow,false,'Long names and notes must wrap inside the order list');
      assert.ok(layout.scrollable&&layout.footerInside&&layout.listBeforeFooter,'Many orders scroll while the total remains visible');
      assert.ok(layout.paymentVisible,'The final payment line must be fully readable after scrolling on '+width+'x'+height);
      await page.screenshot({path:path.join(out,'details-long-'+width+'x'+height+'.png')});
    }
    await page.click('#orderDetailsClose');
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    await page.screenshot({path:path.join(out,'capsule-mobile.png')});
    assert.deepEqual(errors, []);
    console.log('PASS: checkout preserves scroll; glass capsule and details; all live stages; reload; shared-table orders; responsive layouts');
  } catch (error) {
    await page.screenshot({path:path.join(out,'failure.png')});
    console.error(error);
    process.exitCode = 1;
  } finally {await browser.close();}
})();

