/* =====================================================================
   Echtzeit.gs – Showroom-App in Echtzeit (Firebase / Firestore + Push)
   Projekt: fragrance-hub-app (Firebase, kostenloser Spark-Tarif)

   • Die App schreibt Aufträge/Kunden/Kasse direkt in Firestore → alle Geräte
     sehen Änderungen sofort. Zusätzlich gehen sie wie bisher an diese
     Tabelle (Lager, Etiketten, Lexware usw. arbeiten unverändert weiter).
   • Änderungen, die NUR hier auf dem Server entstehen (z. B. CLP-Etiketten
     fertig), werden nach Firestore gespiegelt.
   • Anmeldung: nach gültigem Passwort bekommt das Gerät eine Sitzung
     (sessions/{uid}) – nur dann erlauben die Firestore-Regeln den Zugriff.
   • Push-Nachrichten (auch bei geschlossener App) über Firebase Cloud Messaging.
   • Neue Shopify-Bestellungen: Prüfung jede Minute (über etTelegramBefehle),
     Signal an alle Geräte (meta/shop) + Push.

   Einmalig ausführen: fsMigration()  (kopiert die aktuellen Daten nach Firestore)
   ===================================================================== */

var FS = { projekt: 'fragrance-hub-app', icon: 'https://app.fragranceshub.de/icon-192.png' };
var SR_FB = '', SR_FS = 0;   // pro Anfrage gesetzt in srDoPost_: Firebase-Geräte-ID, 1 = App hat schon selbst nach Firestore geschrieben

/* ---------------- Grundlagen ---------------- */
function fsBase_() { return 'https://firestore.googleapis.com/v1/projects/' + FS.projekt + '/databases/(default)/documents'; }
function fsName_(path) { return 'projects/' + FS.projekt + '/databases/(default)/documents/' + path; }
function fsHeaders_() { return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), 'x-goog-user-project': FS.projekt }; }
function fsFetch_(method, url, body) {
  var opt = { method: method, headers: fsHeaders_(), muteHttpExceptions: true };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  var r = UrlFetchApp.fetch(url, opt), c = r.getResponseCode(), t = r.getContentText();
  if (c >= 300) throw new Error('Firestore ' + c + ': ' + t.slice(0, 300));
  return t ? JSON.parse(t) : {};
}
/** Feldnamen für Feldpfade maskieren (Sonderzeichen in Backticks) */
function fsFeld_(k) { return /^[A-Za-z_][A-Za-z_0-9]*$/.test(k) ? k : '`' + String(k).replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`'; }
function fsCommit_(writes) {
  for (var i = 0; i < writes.length; i += 200) fsFetch_('post', fsBase_() + ':commit', { writes: writes.slice(i, i + 200) });
}
/** Datensatz: { d: {feld: JSON-Text}, u: Server-Zeit, del: false }.  voll = komplett ersetzen, sonst nur die Felder (wie Object.assign) */
function fsPatch_(coll, id, patch, voll) {
  var d = {}, mask = [];
  Object.keys(patch || {}).forEach(function (k) {
    if (patch[k] === undefined) return;
    d[k] = { stringValue: JSON.stringify(patch[k]) }; mask.push('d.' + fsFeld_(k));
  });
  var w = { update: { name: fsName_(coll + '/' + id), fields: { d: { mapValue: { fields: d } }, del: { booleanValue: false } } },
            updateTransforms: [{ fieldPath: 'u', setToServerValue: 'REQUEST_TIME' }] };
  if (!voll) w.updateMask = { fieldPaths: mask.concat(['del']) };
  return w;
}
/** Weiches Löschen: alle Geräte bekommen die Löschung als Änderung mit */
function fsLoesch_(coll, id) {
  return { update: { name: fsName_(coll + '/' + id), fields: { d: { mapValue: { fields: {} } }, del: { booleanValue: true } } },
           updateTransforms: [{ fieldPath: 'u', setToServerValue: 'REQUEST_TIME' }] };
}
/** Server-Änderung nach Firestore spiegeln (nicht, wenn die App sie schon selbst geschrieben hat) */
function fsSpiegel_(coll, id, obj, art) {
  if (SR_FS) return;
  try { fsCommit_([art === 'del' ? fsLoesch_(coll, id) : fsPatch_(coll, id, obj, art === 'add')]); }
  catch (e) { Logger.log('FS-Spiegel ' + coll + '/' + id + ': ' + e.message); }
}

/* ---------------- Sitzungen (Zugriff für angemeldete Geräte) ---------------- */
function fsSitzung_(uid) {
  if (!/^[A-Za-z0-9]{10,64}$/.test(String(uid || '')) || SR_DRUCK) return;
  var cash = true, shop = true; try { if (typeof srCan_ === 'function') { cash = !!srCan_('cash'); shop = !!srCan_('shop'); } } catch (e) {}
  var user = String(SR_USER || ''), c = CacheService.getScriptCache();
  var key = 'FBS2_' + uid + '_' + (cash ? 1 : 0) + (shop ? 1 : 0) + '_' + Utilities.base64EncodeWebSafe(Utilities.newBlob(user).getBytes()).slice(0, 60);
  if (c.get(key)) return;
  fsCommit_([{ update: { name: fsName_('sessions/' + uid), fields: {
    user: { stringValue: user }, owner: { booleanValue: !!SR_OWNER }, cash: { booleanValue: cash }, shop: { booleanValue: shop },
    exp: { integerValue: String(Date.now() + 14 * 864e5) }, at: { integerValue: String(Date.now()) } } } }]);
  c.put(key, '1', 6 * 3600);
}
function fsSitzungWeg_(uid) {
  try { if (/^[A-Za-z0-9]{10,64}$/.test(String(uid || ''))) fsFetch_('delete', fsBase_() + '/sessions/' + uid); } catch (e) {}
}

/* ---------------- Push-Nachrichten (Firebase Cloud Messaging) ---------------- */
/** an alle Geräte – außer denen des Benutzers ohneUser (der hat es selbst ausgelöst) */
function fsPush_(titel, text, data, ohneUser, nurUser) {
  try {
    var r = fsFetch_('get', fsBase_() + '/tokens?pageSize=300');
    var docs = (r.documents || []).filter(function (d) {
      var f = d.fields || {}, u = f.user ? f.user.stringValue : '';
      return f.t && f.t.stringValue && (!ohneUser || u !== String(ohneUser)) && (!nurUser || u === String(nurUser));
    });
    if (!docs.length) return 0;
    var url = 'https://fcm.googleapis.com/v1/projects/' + FS.projekt + '/messages:send', h = fsHeaders_();
    var payloadData = { title: String(titel || ''), body: String(text || '') };
    Object.keys(data || {}).forEach(function (k) { payloadData[k] = String(data[k]); });
    var reqs = docs.map(function (d) {
      return { url: url, method: 'post', contentType: 'application/json', headers: h, muteHttpExceptions: true,
        payload: JSON.stringify({ message: { token: d.fields.t.stringValue, data: payloadData,
          webpush: { headers: { Urgency: 'high', TTL: '86400' } }, android: { priority: 'high' } } }) };
    });
    var res = UrlFetchApp.fetchAll(reqs);
    res.forEach(function (x, i) {
      var c = x.getResponseCode();
      if (c === 404 || (c >= 400 && /UNREGISTERED|registration-token-not-registered/i.test(x.getContentText()))) {
        try { fsFetch_('delete', 'https://firestore.googleapis.com/v1/' + docs[i].name); } catch (e) {}
      }
    });
    return res.length;
  } catch (e) { Logger.log('Push: ' + e.message); return 0; }
}
/** kleines Signal an alle Geräte (z. B. meta/chat) */
function fsMetaPing_(name) {
  try { fsCommit_([{ update: { name: fsName_('meta/' + name), fields: { at: { integerValue: String(Date.now()) } } } }]); }
  catch (e) { Logger.log('Signal ' + name + ': ' + e.message); }
}
/** Team-Chat: Push nur an den Empfänger (bzw. alle außer dem Absender) */
function fsPushChat_(m) {
  if (!m) return;
  var an = String(m.an || 'alle'), von = String(m.von || ''), alle = an === 'alle';
  var text = m.typ === 'audio' ? '🎤 رسالة صوتية' : m.typ === 'bild' ? '📷 صورة' : String(m.text || '').slice(0, 140);
  fsPush_('💬 ' + von, text, { tag: 'chat-' + (alle ? 'alle' : von), chat: alle ? 'alle' : von }, von, alle ? null : an);
}
function fsKunde_(o) { return String((o && (o.customer || o.kunde)) || '').slice(0, 80) || 'بدون اسم'; }

/* ---------------- Shopify: neue Bestellungen sofort melden ---------------- */
function fsShopPing_(art, nr) {
  try {
    fsCommit_([{ update: { name: fsName_('meta/shop'), fields: {
      art: { stringValue: String(art || '') }, nr: { stringValue: String(nr || '') }, at: { integerValue: String(Date.now()) } } } }]);
  } catch (e) { Logger.log('Shop-Signal: ' + e.message); }
}
/** Shop-Bestellungen fertig aufbereitet in Firestore (shop/list) → die App zeigt sie sofort, ohne auf den Server zu warten */
function fsShopBauen_() {
  var alt = soPruefen_;
  soPruefen_ = function () {};   // Server baut die Liste selbst – das Shop-Passwort bleibt in der App bestehen
  var data; try { data = soListe_({}); } finally { soPruefen_ = alt; }
  var j = JSON.stringify(data);
  if (j.length > 950000) { Logger.log('Shop-Liste zu groß für Firestore: ' + j.length); return false; }
  fsCommit_([{ update: { name: fsName_('shop/list'), fields: { j: { stringValue: j }, at: { integerValue: String(data.at || Date.now()) } } } }]);
  var p = PropertiesService.getScriptProperties();
  p.setProperty('FS_SHOP_BUILD', String(Date.now())); p.deleteProperty('FS_SHOP_DIRTY');
  return true;
}
/** nach Änderungen in der App (Vorbereitung, DHL, Storno …): Liste beim nächsten Lauf neu aufbauen */
function fsShopDirty_() { try { PropertiesService.getScriptProperties().setProperty('FS_SHOP_DIRTY', '1'); } catch (e) {} }
/** jede Minute (aus etTelegramBefehle): neue Bestellungen erkennen + Liste aktuell halten */
function fsShopCheck_() {
  var c = CacheService.getScriptCache();
  if (c.get('FS_SHOP_CHK')) return;
  c.put('FS_SHOP_CHK', '1', 45);
  var d = shopifyGraphQL('query { orders(first: 10, sortKey: CREATED_AT, reverse: true) { nodes { name } } }', {});
  var n = (d && d.orders && d.orders.nodes) || [];
  var p = PropertiesService.getScriptProperties(), last = p.getProperty('FS_SHOP_LAST') || '', top = n.length ? n[0].name : last;
  var neu = [];
  if (top !== last) {
    p.setProperty('FS_SHOP_LAST', top);
    if (last) for (var i = 0; i < n.length && n[i].name !== last; i++) neu.push(n[i].name);
  }
  var bauen = neu.length || !!p.getProperty('FS_SHOP_DIRTY') || Date.now() - (+p.getProperty('FS_SHOP_BUILD') || 0) > 10 * 60e3;
  if (bauen) { try { fsShopBauen_(); } catch (e) { Logger.log('Shop-Liste: ' + e.message); } }
  if (neu.length) {
    fsShopPing_('neu', top);
    fsPush_('🛒 طلب جديد من المتجر', neu.join('، '), { tag: 'shop', open: 'shop' }, null);
  }
}

/* ---------------- Einmalig / Wartung ---------------- */
/** EINMAL ausführen: aktuelle Daten (lists, customers, cash) nach Firestore kopieren */
function fsMigration() {
  SR_FS = 0;
  ['lists', 'customers', 'cash'].forEach(function (n) {
    var writes = [];
    srList_(n).forEach(function (r) { var o; try { o = JSON.parse(r.json); } catch (e) { return; } writes.push(fsPatch_(n, r.id, o, true)); });
    fsCommit_(writes);
    Logger.log(n + ': ' + writes.length + ' Datensätze übertragen');
  });
  fsShopPing_('init', '');
  Logger.log('Fertig.');
}
/** Test: Verbindung zu Firestore + Push */
function fsTest() {
  fsShopPing_('test', '');
  Logger.log('Firestore OK. Push an ' + fsPush_('Fragrance Hub', 'Test-Benachrichtigung ✅', { tag: 'test' }, null) + ' Gerät(e).');
}
