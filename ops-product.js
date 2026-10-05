window.ProductDevice=(()=>{try{let id=localStorage.getItem('menu-device');if(!id){id=crypto.randomUUID();localStorage.setItem('menu-device',id);}return id;}catch(_){return crypto.randomUUID();}})();
function recordProductFailure(error){
  const message=String(error?.message||error||'Ошибка соединения').slice(0,500);
  if(/PIN|прав|доступ запрещён/i.test(message))return;
  try{const queue=JSON.parse(localStorage.getItem('menu-incidents')||'[]');if(!queue.some(x=>x.message===message))queue.push({message});localStorage.setItem('menu-incidents',JSON.stringify(queue.slice(-20)));}catch(_){}
}
window.addEventListener('error',e=>recordProductFailure(e.error||e.message));
window.addEventListener('unhandledrejection',e=>recordProductFailure(e.reason));
async function enableStaffNotifications(role,call){
  if(!('serviceWorker' in navigator)||!('PushManager' in window))throw new Error('Этот браузер не поддерживает фоновые уведомления');
  if(await Notification.requestPermission()!=='granted')throw new Error('Уведомления не разрешены в настройках браузера');
  const registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  const config=await call('push-config');
  const b64=config.publicKey.replace(/-/g,'+').replace(/_/g,'/');
  const key=Uint8Array.from(atob(b64+'='.repeat((4-b64.length%4)%4)),c=>c.charCodeAt(0));
  const subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:key});
  await call('push-subscribe',{subscription:subscription.toJSON()});
}
function addNotificationButton(role,call,notice){
  let sending=false;
  setInterval(async()=>{if(sending||document.getElementById('app')?.hidden||!navigator.onLine)return;let queue=[];try{queue=JSON.parse(localStorage.getItem('menu-incidents')||'[]');}catch(_){}if(!queue.length)return;sending=true;try{await call('report-client-incident',queue[0]);const current=JSON.parse(localStorage.getItem('menu-incidents')||'[]');localStorage.setItem('menu-incidents',JSON.stringify(current.filter(x=>x.message!==queue[0].message)));}catch(_){}finally{sending=false;}},45000);
  fetch(window.MenuConfig.supabaseUrl+'/functions/v1/table-api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'public-settings'})}).then(r=>r.ok?r.json():null).then(data=>{if(!data?.settings)return;const name=data.settings.restaurant_name;window.RestaurantName=name;document.documentElement.style.setProperty('--restaurant-name',JSON.stringify(name));document.querySelectorAll('.ops-kicker,.admin-mobile-menu-head b,.admin-brand b').forEach(el=>el.textContent=name);if(document.getElementById('pageEyebrow')?.textContent==='Sushi Crazy')document.getElementById('pageEyebrow').textContent=name;document.title=name+' · '+({admin:'Администратор',waiter:'Зал',kitchen:'Кухня'}[role]);}).catch(()=>{});
  const target=document.querySelector('.admin-top-actions,.floor-nav,.kitchen-nav');if(!target)return;
  const button=document.createElement('button');button.className='product-button product-icon';button.title='Фоновые уведомления';button.setAttribute('aria-label',button.title);button.innerHTML='<i data-lucide="bell-ring"></i>';
  button.onclick=async()=>{button.disabled=true;try{await enableStaffNotifications(role,call);notice('Уведомления включены');}catch(e){notice(e.message);}finally{button.disabled=false;}};
  target.prepend(button);window.lucide?.createIcons();
}
