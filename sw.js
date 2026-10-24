/* Fragrance Hub Showroom – offline shell. App page: network first (updates arrive at once), cache as fallback
   (after 4 s on a weak Wi-Fi the saved copy opens, the fresh one is stored for next time).
   Libraries/fonts/icons: cache first. Server calls (script.google.com) are never cached. */
const C='fh-shell-v30';
const APP=new URL('./',self.registration.scope).pathname;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon-192.png','icon-512.png']).catch(()=>{})))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||/script\.google(usercontent)?\.com$/.test(u.hostname)||u.hostname.endsWith('googleapis.com')&&u.pathname.startsWith('/drive'))return;
  /* only the app page itself is the app shell – other pages (konfig/, druck/) are never stored as the app */
  const isApp=u.origin===location.origin&&(u.pathname===APP||u.pathname===APP+'index.html');
  if(isApp){
    const net=fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put('index.html',cp))}return res});
    e.respondWith(caches.match('index.html').then(hit=>{
      if(!hit)return net;
      const slow=new Promise(ok=>setTimeout(()=>ok(hit),4000));
      return Promise.race([net.catch(()=>hit),slow]);
    }));return}
  if(r.mode==='navigate')return;
  if(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.hostname)||u.origin===location.origin&&/\.(png|ttf|json|js)$/.test(u.pathname)&&!u.pathname.includes('/konfig/')){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res})))}
});
