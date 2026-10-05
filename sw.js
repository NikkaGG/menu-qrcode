const CACHE_NAME='menu-qr-product-v20';
const OFFLINE_URL='/offline.html';
const PRECACHE=[
  '/',
  OFFLINE_URL,
  '/styles.css?v=20261002-checkout-v1',
  '/app.js?v=20261002-menu-v1',
  '/manifest.webmanifest',
  '/icons/app-192.png',
  '/icons/app-512.png'
];
self.addEventListener('push',event=>{
  let data={};try{data=event.data?.json()||{};}catch(_){}
  event.waitUntil(self.registration.showNotification(data.title||'Ресторан',{body:data.body||'',icon:'/icons/app-192.png',tag:data.tag||'menu-event',data:{url:data.url||'/staff'}}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();const target=new URL(event.notification.data?.url||'/staff',self.location.origin);
  if(target.origin!==self.location.origin)return;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    const existing=clients.find(c=>new URL(c.url).pathname===target.pathname);
    if(existing){await existing.focus();return;}return self.clients.openWindow(target.href);
  }));
});

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE)));
  self.skipWaiting();
});

self.addEventListener('activate',event=>{
  event.waitUntil(Promise.all([
    caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))),
    self.clients.claim()
  ]));
});

async function networkFirst(request,fallback){
  const cache=await caches.open(CACHE_NAME);
  try{
    const response=await fetch(request);
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(error){
    return (fallback?await cache.match(fallback):await cache.match(request))||Response.error();
  }
}

async function staleWhileRevalidate(request){
  const cache=await caches.open(CACHE_NAME);
  const cached=await cache.match(request);
  const fresh=fetch(request).then(response=>{
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }).catch(()=>null);
  return cached||(await fresh)||Response.error();
}

self.addEventListener('fetch',event=>{
  const request=event.request;
  const url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin)return;
  if(request.mode==='navigate'){
    event.respondWith(networkFirst(request,OFFLINE_URL));
    return;
  }
  if(['/styles.css','/app.js','/manifest.webmanifest'].includes(url.pathname)){
    event.respondWith(networkFirst(request));
    return;
  }
  if(url.pathname.startsWith('/icons/')){
    event.respondWith(staleWhileRevalidate(request));
  }
});
