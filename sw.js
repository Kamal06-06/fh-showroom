/* Fragrance Hub Showroom – offline shell. App page: network first (updates arrive at once), cache as fallback.
   Libraries/fonts/icons: cache first. Server calls (script.google.com) are never cached. */
const C='fh-shell-v19';
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon-192.png','icon-512.png']).catch(()=>{})))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||/script\.google(usercontent)?\.com$/.test(u.hostname)||u.hostname.endsWith('googleapis.com')&&u.pathname.startsWith('/drive'))return;
  if(r.mode==='navigate'||u.origin===location.origin&&/\/(index\.html)?$/.test(u.pathname)){
    e.respondWith(fetch(r).then(res=>{const cp=res.clone();caches.open(C).then(c=>c.put('index.html',cp));return res}).catch(()=>caches.match('index.html')));return}
  if(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com|cdn\.shopify\.com/.test(u.hostname)||u.origin===location.origin){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok||res.type==='opaque'){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res})))}
});
