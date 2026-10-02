const CACHE_NAME='sushi-crazy-shell-v20-qa';
const OFFLINE_URL='/offline.html';
const NETWORK_TIMEOUT_MS=8000;
const PRECACHE=[
  '/',
  OFFLINE_URL,
  '/styles.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icons/app-192.png',
  '/icons/app-512.png'
];

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

async function networkFirst(request,fallback,ignoreSearch=false){
  const cache=await caches.open(CACHE_NAME);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),NETWORK_TIMEOUT_MS);
  try{
    const response=await fetch(request,{signal:controller.signal});
    if(response&&response.ok)cache.put(request,response.clone());
    return response;
  }catch(error){
    return (await cache.match(request,{ignoreSearch}))||(fallback?await cache.match(fallback):undefined)||Response.error();
  }finally{
    clearTimeout(timeout);
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
    event.respondWith(networkFirst(request,null,true));
    return;
  }
  if(url.pathname.startsWith('/icons/')){
    event.respondWith(staleWhileRevalidate(request));
  }
});
