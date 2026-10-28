/* Fragrance Hub Showroom – offline shell. App page: network first (updates arrive at once), cache as fallback
   (after 4 s on a weak Wi-Fi the saved copy opens, the fresh one is stored for next time).
   Libraries/fonts/icons: cache first. Server calls (script.google.com) are never cached. */
const C='fh-shell-v157';
const APP=new URL('./',self.registration.scope).pathname;
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(['./','index.html','manifest.json','icon-192.png','icon-512.png']).catch(()=>{})))});
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const r=e.request,u=new URL(r.url);
  if(r.method!=='GET'||/script\.google(usercontent)?\.com$/.test(u.hostname)||u.hostname.endsWith('googleapis.com')&&u.pathname.startsWith('/drive'))return;
  /* only the app page itself is the app shell – other pages (konfig/, druck/) are never stored as the app */
  const isApp=u.origin===location.origin&&(u.pathname===APP||u.pathname===APP+'index.html');
  if(isApp){
    const net=fetch(r.url,{cache:'no-cache',credentials:'same-origin'}).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put('index.html',cp))}return res});
    e.respondWith(caches.match('index.html').then(hit=>{
      if(!hit)return net;
      const slow=new Promise(ok=>setTimeout(()=>ok(hit),4000));
      return Promise.race([net.catch(()=>hit),slow]);
    }));return}
  if(r.mode==='navigate')return;
  if(/cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(u.hostname)||u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/')||u.origin===location.origin&&/\.(png|ttf|json|js)$/.test(u.pathname)&&!u.pathname.includes('/konfig/')){
    e.respondWith(caches.match(r).then(hit=>hit||fetch(r).then(res=>{if(res.ok){const cp=res.clone();caches.open(C).then(c=>c.put(r,cp))}return res})))}
});
/* 🔔 Push (Firebase Cloud Messaging): neue Aufträge, fertige Aufträge, neue Shop-Bestellungen – auch bei geschlossener App.
   Ist die App gerade offen und im Vordergrund, meldet sie sich selbst (Ton + Hinweis) → hier keine doppelte Meldung. */
self.addEventListener('push',e=>{let p={};try{p=e.data?e.data.json():{}}catch(_){try{p={data:{body:e.data.text()}}}catch(__){}}
  const d=p.data||{},n=p.notification||{},title=d.title||n.title||'Fragrance Hub',body=d.body||n.body||'';
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{
    if(cs.some(c=>c.visibilityState==='visible'&&c.focused))return;
    return self.registration.showNotification(title,{body,icon:'icon-192.png',badge:'icon-192.png',tag:d.tag||'fh',renotify:true,vibrate:[200,100,200],data:{open:d.open||'',chat:d.chat||''}})}))});
/* Klick auf eine Benachrichtigung → App nach vorne holen und das Richtige öffnen (Chat, Auftrag, Shop-Bestellungen) */
self.addEventListener('notificationclick',e=>{e.notification.close();const dt=e.notification.data||{},k=dt.chat,o=dt.open;
  e.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(cs=>{const c=cs.find(x=>x.url.includes(APP));
    if(c){if(k)c.postMessage({chat:k});if(o)c.postMessage({open:o});return c.focus()}
    return self.clients.openWindow(APP).then(w=>{if(w&&(o||k))setTimeout(()=>{try{if(k)w.postMessage({chat:k});if(o)w.postMessage({open:o})}catch(_){}},4000)})}))});
