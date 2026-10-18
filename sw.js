/* Cache only the public app shell. Never cache accounts, histories or Drive files. */
'use strict';
const CACHE='planejamento-shell-v25';
const ASSETS=['/','/index.html','/styles.css','/insights.css','/timeline.css','/app.js','/timeline.js','/insights.js','/legacy-import.js','/medreview-config.js','/medreview-data.js','/medreview.js','/pwa.js','/questions.js','/question-data.js','/questions.css','/planning-config.js','/cloud-data.js','/class-tasks.js','/account-sync.js','/account-features.js','/semester-import.js','/whatsapp-notify.js','/vendor/supabase-2.117.3.js','/vendor/fonts/InterVariable-latin.woff2','/favicon.svg','/manifest.webmanifest','/icons/app-192-v2.png','/icons/app-512-v2.png','/icons/app-maskable-512-v2.png','/icons/apple-touch-icon-v2.png'];
const ALLOWED=new Set(ASSETS);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS))));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();await Promise.all(names.filter(name=>name.startsWith('planejamento-shell-')&&name!==CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting()});
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.method!=='GET'||url.origin!==self.location.origin||req.headers.has('range')||!ALLOWED.has(url.pathname))return;
  const navigation=req.mode==='navigate'&&(url.pathname==='/'||url.pathname==='/index.html');
  // Query strings do not create unbounded caches; only explicit public paths qualify.
  const key=navigation?'/index.html':url.pathname;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE);
    try{
      const response=await fetch(req);
      if(response.ok&&response.type!=='opaque'){
        await cache.put(key,response.clone());return response;
      }
      return await cache.match(key)||response;
    }catch(error){const cached=await cache.match(key);if(cached)return cached;throw error}
  })());
});
