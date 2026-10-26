/* =====================================================================
   Showroom-App  –  Web-App für die Auftragsannahme im Showroom
   Diese Datei + die HTML-Datei "Showroom" in das Projekt
   "Zertifikate-Versand" einfügen (dort liegen die CLP-Etiketten-Funktionen).
   Einmalig srEinrichten() ausführen, dann als Web-App bereitstellen.
   ===================================================================== */
var SR = {
  shop: 'https://fragranceshub.de',
  oelTyp: 'Fragrance Oil',
  duftTabelle: '1dlZxa6K2XASqn0oRWImRM2YgM1x7wMM4mzH8DmNiD5A',   // Blatt "Geschlecht": Code | Marke | Duftname
  codeTabelle: '1qETeGWZcHDYu7vdP0PxMVHgbyrUk9vv_TwQSL56fAk4',   // Sheet1: D = eigener Code, E = Fabrik-Code
  ordner: '1Ye62ewrcDskLJncRHYsGHaa_5g27GkCA',                   // Drive-Ordner "Showroom-Listen"
  linkFreigabe: true                                             // PDFs per Link lesbar (für WhatsApp)
};

function doGet(e) {
  var out = HtmlService.createHtmlOutputFromFile('ShowroomSeite')
    .setTitle('Fragrance Hub Showroom')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  // Web-App-URL (für QR-Etiketten) und ggf. gescannter Code aus ?code=
  var url = '', code = String((e && e.parameter && e.parameter.code) || '').slice(0, 80);
  try { url = ScriptApp.getService().getUrl() || ''; } catch (x) {}
  out.append('<script>window.SR_URL=' + JSON.stringify(url) + ';window.SR_CODE=' + JSON.stringify(code) + ';</script>');
  return out;
}

/** JSON-Schnittstelle für die eigenständige App (GitHub Pages / PWA), aufgerufen von doPost (Superchat.gs) bei ?app=sr. Body: {pin, action, a, b, c} */
function srDoPost_(e) {
  var r, q = {};
  try {
    q = JSON.parse(e.postData.contents);
    SR_FB = String(q.fb || ''); SR_FS = q.fs ? 1 : 0;   // Echtzeit.gs
    if (q.action === 'fs_ping') { srPin_(q.pin, q.dev); r = { val: { devWait: (SR_OWNER && typeof srDevWait_ === 'function') ? srDevWait_() : null } }; }
    else r = srApi(q.pin, q.action, q.a, q.b, q.c, q.dev);
    if (r && !r.err && SR_FB) { try { fsSitzung_(SR_FB); } catch (x1) { Logger.log('Sitzung: ' + x1.message); } }
    if (r && !r.err && /^(so_set|so_storno|so_edit|so_neu|dhl_label|dhl_storno)$/.test(String(q.action))) { fsShopDirty_(); fsShopPing_('stand', ''); }
    if (r && !r.err && q.action === 'chat_send') { fsMetaPing_('chat'); fsPushChat_(r.val); }
  } catch (x) { r = { err: String(x && x.message || x) }; }
  if (r && r.err && SR_FB && /^(PIN|GERAET_GESPERRT)$/.test(String(r.err))) fsSitzungWeg_(SR_FB);
  return ContentService.createTextOutput(JSON.stringify(r)).setMimeType(ContentService.MimeType.JSON);
}

/** EINMAL ausführen: legt die Daten-Tabelle an und erzeugt den Zugangscode (steht danach im Protokoll). */
function srEinrichten() {
  var p = PropertiesService.getScriptProperties();
  if (!p.getProperty('SR_DATA')) {
    var ss = SpreadsheetApp.create('Showroom-Daten');
    ss.getSheets()[0].setName('lists');
    ss.insertSheet('customers');
    p.setProperty('SR_DATA', ss.getId());
  }
  if (!p.getProperty('SR_PIN')) p.setProperty('SR_PIN', String(Math.floor(100000 + Math.random() * 900000)));
  Logger.log('Zugangscode (SR_PIN): ' + p.getProperty('SR_PIN'));
  Logger.log('Daten-Tabelle: https://docs.google.com/spreadsheets/d/' + p.getProperty('SR_DATA'));
  Logger.log('Artikel geladen: ' + JSON.parse(srSync_()).items.length);
}

/** Einziger Einstieg für die Seite. Antwort: {val: ...} oder {err: 'Text'} */
function srApi(pin, action, a, b, c) {
  try {
    srPin_(pin);
    switch (action) {
      case 'check':   return { val: true };
      case 'list':    return { val: srList_(a) };
      case 'add':     return { val: srAdd_(a, b, c) };
      case 'pull':    return { val: srPull_(a) };
      case 'pdf':     return { val: srPdf_(a) };
      case 'update':  return { val: srUpdate_(a, b, c) };
      case 'del':     return { val: srDel_(a, b) };
      case 'catalog': return { val: srCatalog_() };
      case 'sync':    return { val: srSync_() };
      case 'upload':  return { val: srUpload_(a, b) };
      case 'upload2': return { val: srUpload2_(a, b, c) };
      case 'logo':    return { val: srLogo_(a, b) };
      case 'clp':     return { val: srClp_(JSON.parse(a), b === 'rep') };
      case 'clpbasis': return { val: srClpBasis_() };
      case 'img':     return { val: srImg_(a) };
      case 'druck':   return { val: srDruck_(a, b) };
      case 'druckholen': return { val: srDruckHolen_(a === '1') };
      case 'druckstatus': return { val: srDruckStatus_() };
    case 'setpin':  return { err: 'تغيير رمز الدخول من التطبيق غير متاح – فقط عبر المدير.' };   // Sicherheit: Mitarbeiter dürfen den PIN nicht ändern
      case 'lg_info': return { val: lagerBestandVon(a, b, c) };
      case 'lg_ein':  { var e = JSON.parse(a); return { val: lagerWareneingang(e.code, e.tier, e.oil, e.menge, e.title, e.notiz) }; }
      case 'lg_inv':  { var v = JSON.parse(a); return { val: lagerInventur(v.code, v.tier, v.oil, v.ist, v.title) }; }
      case 'lg_min':  { var mm = JSON.parse(a); return { val: lagerMinSetzen(mm.code, mm.tier, mm.oil, mm.min) }; }
      case 'lg_low':  return { val: lagerNiedrig() };
      case 'lg_bew':  return { val: lagerBewegungen(a, b, c, 20) };
      case 'lg_aus':  { var x = JSON.parse(a); return { val: lagerAusgang(x.code, x.tier, x.oil, x.menge, x.title, x.notiz) }; }
    }
    return { err: 'Unbekannte Aktion' };
  } catch (e) {
    return { err: String(e && e.message || e) };
  }
}

function srSetPin_(neu) {
  neu = String(neu || '').replace(/[٠-٩]/g, function (d) { return '٠١٢٣٤٥٦٧٨٩'.indexOf(d); }).replace(/[۰-۹]/g, function (d) { return '۰۱۲۳۴۵۶۷۸۹'.indexOf(d); }).replace(/\D/g, '');
  if (neu.length < 4 || neu.length > 8) throw new Error('الرمز الجديد يجب أن يكون من 4 إلى 8 أرقام');
  PropertiesService.getScriptProperties().setProperty('SR_PIN', neu);
  return true;
}
function srPin_(pin) {
  var cache = CacheService.getScriptCache();
  var fehl = Number(cache.get('SR_FAIL') || 0);
  if (fehl >= 10) throw new Error('Zu viele falsche Versuche. Bitte 10 Minuten warten.');
  var soll = PropertiesService.getScriptProperties().getProperty('SR_PIN');
  if (!soll) throw new Error('Kein Zugangscode gesetzt – zuerst srEinrichten() ausführen.');
  var eingabe = String(pin || '').replace(/[\u0660-\u0669]/g, function (c) { return c.charCodeAt(0) - 0x660; })
    .replace(/[\u06F0-\u06F9]/g, function (c) { return c.charCodeAt(0) - 0x6F0; }).replace(/[^0-9]/g, '');
  if (eingabe !== String(soll).replace(/[^0-9]/g, '')) {
    cache.put('SR_FAIL', String(fehl + 1), 600);
    throw new Error('PIN');
  }
}

/* ---------------- Daten (Tabelle "Showroom-Daten": id | at | json) ---------------- */
function srBlatt_(name) {
  if (name !== 'lists' && name !== 'customers' && name !== 'cash') throw new Error('Unbekannte Liste');
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SR_DATA'));
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
var SR_NAMEN = ['lists', 'customers', 'cash'];
function srVer_(name) { return PropertiesService.getScriptProperties().getProperty('SR_V_' + name) || '1'; }
function srBump_(name) { PropertiesService.getScriptProperties().setProperty('SR_V_' + name, String(Date.now())); }
/** Eigener Lock für die Showroom-Tabelle – wartet nicht auf CLP-/Lager-Läufe */
function srLock_() {
  var l; try { l = LockService.getUserLock(); } catch (e) { l = null; }
  if (!l) l = LockService.getScriptLock();
  l.waitLock(20000); return l;
}
/** Nur geänderte Listen liefern. known = {"lists":"ver",...} */
function srPull_(known) {
  var k = {}; try { k = JSON.parse(known || '{}') || {}; } catch (e) {}
  var out = { v: {}, data: {} };
  SR_NAMEN.forEach(function (n) {
    var v = srVer_(n); out.v[n] = v;
    if (k[n] !== v) out.data[n] = srList_(n);
  });
  return out;
}
function srList_(name) {
  var sh = srBlatt_(name), n = sh.getLastRow();
  if (!n) return [];
  // lists: die letzten 2000 Aufträge + alle älteren, die noch offen oder nicht voll bezahlt sind (nichts Offenes geht verloren)
  var max = name === 'lists' ? 2000 : 100000, von = Math.max(1, n - max + 1), alt = [];
  if (name === 'lists' && von > 1) alt = sh.getRange(1, 1, von - 1, 3).getValues().filter(function (r) {
    try { var o = JSON.parse(r[2]), p = o.pay || {}; return o.status !== 'done' || p.status !== 'paid'; } catch (e) { return false; }
  });
  return alt.concat(sh.getRange(von, 1, n - von + 1, 3).getValues())
    .filter(function (r) { return r[0] && r[2]; })
    .map(function (r) { return { id: String(r[0]), json: String(r[2]) }; });
}
function srAdd_(name, json, wunschId) {
  var o = JSON.parse(json), id, neu = false;
  var lock = srLock_();
  try {
    var sh = srBlatt_(name);
    id = /^[a-z0-9]{12,24}$/.test(String(wunschId || '')) ? String(wunschId) : Utilities.getUuid().replace(/-/g, '').slice(0, 16);
    if (!wunschId || !srZeile_(sh, id)) { sh.appendRow([id, new Date(), json]); neu = true; srBump_(name); }   // gleiche ID nochmal = schon gespeichert
  } finally { lock.releaseLock(); }
  if (neu && name === 'lists') lagerShowroomSync_(id, o.customer, o.items, null);   // Lager: Angebot reserviert
  if (neu) {   // Echtzeit.gs: Firestore-Spiegel + Push an die anderen Geräte
    fsSpiegel_(name, id, o, 'add');
    if (name === 'lists' && o.status !== 'done') fsPush_('📦 طلب جديد في المستودع', fsKunde_(o), { tag: 'list-' + id, open: 'list:' + id }, SR_USER);
  }
  return id;
}
function srZeile_(sh, id) {
  var n = sh.getLastRow();
  if (!n) return 0;
  var f = sh.getRange(1, 1, n, 1).createTextFinder(String(id)).matchEntireCell(true).findNext();
  return f ? f.getRow() : 0;
}
function srUpdate_(name, id, json) {
  var patch = JSON.parse(json), alt, vorher, warReady = false;
  var lock = srLock_();
  try {
    var sh = srBlatt_(name), z = srZeile_(sh, id);
    if (!z) throw new Error('Eintrag nicht gefunden');
    alt = JSON.parse(sh.getRange(z, 3).getValue()); vorher = alt.items; warReady = !!alt.readyAt;
    Object.keys(patch).forEach(function (k) { alt[k] = patch[k]; });
    sh.getRange(z, 3).setValue(JSON.stringify(alt));
    srBump_(name);
  } finally { lock.releaseLock(); }
  if (name === 'lists' && patch.items) lagerShowroomSync_(id, alt.customer, alt.items, vorher || [], alt.at);   // Lager: nur Differenz
  fsSpiegel_(name, id, patch, 'patch');   // Echtzeit.gs
  if (name === 'lists' && patch.readyAt && !warReady) fsPush_('✅ الطلب جاهز للتسليم', fsKunde_(alt), { tag: 'ready-' + id, open: 'list:' + id }, SR_USER);
  return true;
}
function srDel_(name, id) {
  var lock = srLock_(), o = null, weg = false;
  try {
    var sh = srBlatt_(name), z = srZeile_(sh, id);
    if (z && name === 'lists') { try { o = JSON.parse(sh.getRange(z, 3).getValue()); } catch (e) {} }
    if (z) { sh.deleteRow(z); srBump_(name); weg = true; }
  } finally { lock.releaseLock(); }
  if (o) { try { lagerShowroomSync_(id, o.customer, [], o.items, o.at); } catch (e) {} }   // Lager: zurückbuchen
  if (weg) fsSpiegel_(name, id, null, 'del');   // Echtzeit.gs
  return true;
}

/* ---------------- Artikel aus dem Shop ---------------- */
function srBasis_(code) { return String(code || '').toUpperCase().replace(/-SH.*$/, '').replace(/-PQ/, ''); }

function srSync_() {
  var alle = [];
  for (var seite = 1; seite <= 12; seite++) {
    var r = UrlFetchApp.fetch(SR.shop + '/products.json?limit=250&page=' + seite, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('Shop antwortet mit ' + r.getResponseCode());
    var ps = JSON.parse(r.getContentText()).products || [];
    if (!ps.length) break;
    alle = alle.concat(ps);
  }
  if (!alle.length) throw new Error('Keine Artikel vom Shop erhalten');
  var namen = {};
  try {
    var w = SpreadsheetApp.openById(SR.duftTabelle).getSheetByName('Geschlecht').getDataRange().getValues();
    for (var i = 1; i < w.length; i++) if (w[i][0]) namen[srBasis_(w[i][0])] = (String(w[i][1] || '') + ' ' + String(w[i][2] || '')).trim();
  } catch (e) { Logger.log('Originalnamen nicht geladen: ' + e); }
  var items = alle.map(function (p) {
    var oel = p.product_type === SR.oelTyp;
    var o = { t: p.title, o: oel ? 1 : 0,
              v: (p.variants || []).map(function (v) { return [v.title === 'Default Title' ? '' : v.title, v.sku || '', v.price]; }) };
    if (oel) {
      var sku = ''; o.v.forEach(function (v) { if (!sku && v[1]) sku = v[1]; });
      if (namen[srBasis_(sku)]) o.a = namen[srBasis_(sku)];
    } else if (p.images && p.images[0]) {
      o.i = p.images[0].src + (p.images[0].src.indexOf('?') > -1 ? '&' : '?') + 'width=160';
    }
    return o;
  }).sort(function (x, y) { return x.t < y.t ? -1 : x.t > y.t ? 1 : 0; });
  var text = JSON.stringify({ at: Date.now(), items: items });
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('SR_CAT'), datei = null;
  if (id) { try { datei = DriveApp.getFileById(id); if (datei.isTrashed()) datei = null; } catch (e) { datei = null; } }
  if (datei) datei.setContent(text);
  else props.setProperty('SR_CAT', DriveApp.getFolderById(SR.ordner).createFile('showroom-katalog.json', text, 'application/json').getId());
  return text;
}
function srCatalog_() {
  var id = PropertiesService.getScriptProperties().getProperty('SR_CAT');
  if (id) { try { return DriveApp.getFileById(id).getBlob().getDataAsString('UTF-8'); } catch (e) {} }
  return srSync_();
}

/* ---------------- PDFs in Drive ablegen ---------------- */
function srDatei_(blob) {
  var f = DriveApp.getFolderById(SR.ordner).createFile(blob);
  if (SR.linkFreigabe) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getUrl();
}
function srUpload2_(name, b64, mime) {
  return srDatei_(Utilities.newBlob(Utilities.base64Decode(b64), String(mime || 'application/octet-stream'), String(name).replace(/[\\\/:*?"<>|]/g, '-')));
}
/** PDF aus dem Ordner "Showroom-Listen" als Base64 (für den Druck-Knopf) */
function srPdf_(url) {
  var m = String(url || '').match(/[-\w]{25,}/);
  if (!m) throw new Error('Datei-ID fehlt');
  var f = DriveApp.getFileById(m[0]), ok = false, p = f.getParents();
  while (p.hasNext()) if (p.next().getId() === SR.ordner) ok = true;
  if (!ok) throw new Error('Datei nicht erlaubt');
  return Utilities.base64Encode(f.getBlob().getBytes());
}
function srUpload_(name, b64) {
  return srDatei_(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', String(name).replace(/[\\\/:*?"<>|]/g, '-')));
}

/* ---------------- CLP-Etiketten über die vorhandenen Funktionen ---------------- */
function srFabrikCodes_() {
  var w = SpreadsheetApp.openById(SR.codeTabelle).getSheets()[0].getDataRange().getValues(), m = {};
  for (var i = 1; i < w.length; i++) if (w[i][3] && w[i][4]) m[String(w[i][3]).trim().toUpperCase()] = String(w[i][4]).trim();
  return m;
}
function srFabrik_(codes, ersatz, code) {
  var k = String(code || '').trim().toUpperCase();
  if (!codes) return (ersatz && ersatz[k]) || '';
  var e = codes[k];
  if (!e && codes.__canon && typeof canonCode === 'function') e = codes.__canon[canonCode(k)];
  return (e && e.factory) ? String(e.factory) : '';
}
function srClp_(auftrag, kompakt) {
  if (typeof erstelleEtikettenPdf_ !== 'function')
    throw new Error('CLP-Funktion nicht gefunden – die Showroom-Dateien müssen im Projekt "Zertifikate-Versand" liegen.');
  // Fabrik-Code wie beim Etikettenversand der Bestellungen: loadCodeMap() (exakt, sonst über canonCode)
  var codes = (typeof loadCodeMap === 'function') ? loadCodeMap() : null, ersatz = codes ? null : srFabrikCodes_();
  var gross = [], proben = [], fehlend = [];
  (auftrag.items || []).forEach(function (it) {
    if (!(it.oil != null ? it.oil : it.tier)) return;
    // ohne Fabrik-Code entscheidet erstelleEtikettenPdf_ selbst (VORLAGE-Zeile oder "fehlend")
    var fc = srFabrik_(codes, ersatz, it.code);
    var pos = { fabrikCode: fc, sku: it.code, qualitaet: it.tier, gewicht: it.size, menge: it.q || 1, titel: it.t, produkt: it.t };
    (/^6\s*g$/i.test(String(it.size || '').trim()) ? proben : gross).push(pos);
  });
  // Schnell: jedes unterschiedliche Etikett nur EINMAL bauen, die App vervielfältigt die Seiten (rep = Anzahl je Seite)
  var repGross = null, repProben = null;
  if (kompakt) {
    var einmal = function (liste) {
      var m = {}, out = [];
      liste.forEach(function (p) {
        var k = [p.fabrikCode, p.sku, p.qualitaet, p.gewicht, p.titel].join('|');
        if (m[k]) m[k].menge += p.menge; else { m[k] = p; out.push(p); }
      });
      return out;
    };
    gross = einmal(gross); proben = einmal(proben);
    var sprachen = etSprachen_(String(auftrag.country || 'DE').toUpperCase());
    repGross = [];
    gross.forEach(function (p) {
      var dd = p.fabrikCode ? etLadeClp_(p.fabrikCode) : null;
      if (!dd) dd = etVorlage_(p);
      if (dd) sprachen.forEach(function () { repGross.push(p.menge); });   // gleiche Reihenfolge wie erstelleEtikettenPdf_
    });
    repProben = proben.map(function (p) { return p.menge; });
    gross.forEach(function (p) { p.menge = 1; }); proben.forEach(function (p) { p.menge = 1; });
  }
  // die Charge wird aus den Ziffern des Namens gebildet → Kundennummer voranstellen
  var chargeName = String(auftrag.custNo || '') + ' ' + String(auftrag.customer || 'Showroom');
  var name = String(auftrag.customer || 'Showroom'), basis = name.replace(/[\\\/:*?"<>|]/g, '-'), dateien = [];
  function dazu(blob, titel, rep) {
    blob.setName(titel + '-' + basis + '.pdf');
    if (kompakt) dateien.push({ name: blob.getName(), b64: Utilities.base64Encode(blob.getBytes()), rep: rep });   // App lädt die fertige Datei hoch
    else dateien.push({ name: blob.getName(), url: srDatei_(blob), b64: Utilities.base64Encode(blob.getBytes()) });
  }
  // Kunden-Etikett: eigene Anschrift des Kunden statt Fragrance Hub (ohne Logo, ohne QR "Nachbestellen")
  var eigen = String(auftrag.clpAddr || '').trim(), alt = null;
  if (eigen && typeof ETIKETT !== 'undefined') {
    alt = { adresse: ETIKETT.adresse, logoId: ETIKETT.logoId, qr: (typeof ETIKETT_QR !== 'undefined') ? ETIKETT_QR.aktiv : null };
    ETIKETT.adresse = eigen; ETIKETT.logoId = String(auftrag.clpLogo || ''); ETIKETT.adresseOben = true;
    if (alt.qr !== null) ETIKETT_QR.aktiv = false;
  }
  try {
    if (gross.length) {
      var r = erstelleEtikettenPdf_({ name: chargeName, laenderCode: String(auftrag.country || 'DE').toUpperCase(), positionen: gross });
      if (r && r.fehlend && r.fehlend.length) fehlend = fehlend.concat(r.fehlend);
      if (r && r.pdf) dazu(r.pdf, 'CLP-Etiketten', repGross);
    }
    if (proben.length && typeof erstelleProbenPdf_ === 'function') {
      var q = erstelleProbenPdf_(chargeName, proben);
      if (q && q.pdf) dazu(q.pdf, 'Proben-Etiketten', repProben);
    }
  } finally { if (typeof ETIKETT !== 'undefined') ETIKETT.adresseOben = false;
    if (alt) { ETIKETT.adresse = alt.adresse; ETIKETT.logoId = alt.logoId; if (alt.qr !== null) ETIKETT_QR.aktiv = alt.qr; }
  }
  return { files: dateien, fehlend: fehlend };
}

/** Test: CLP-Etikett für einen Beispielartikel – Ergebnis steht im Protokoll */
function srTestClp() {
  var t0 = Date.now();
  try {
    var codes = loadCodeMap();
    Logger.log('Codes in Tabelle: ' + Object.keys(codes).length + ' | AR-ADG-H-02-PQ-SH -> ' + srFabrik_(codes, null, 'AR-ADG-H-02-PQ-SH') + ' | ohne Zertifikat (Test) -> [' + srFabrik_(codes, null, 'XX-TEST-U-99-SH') + ']');
    var r = srClp_({ customer: 'Test Kunde', custNo: 'K-1001', items: [{ t: 'Aqua Maris Signature', oil: 1, tier: 'Premium', code: 'AR-ADG-H-02-PQ-SH', size: '100 g', q: 1 }, { t: 'Testduft ohne Zertifikat', oil: 1, tier: 'Standard', code: 'XX-TEST-U-99-SH', size: '250 g', q: 1 }] });
    Logger.log('Dateien: ' + r.files.map(function (f) { return f.name + ' (' + f.b64.length + ' Zeichen)'; }).join(', '));
    Logger.log('Fehlend: ' + JSON.stringify(r.fehlend));
  } catch (e) {
    Logger.log('FEHLER: ' + (e && e.stack || e));
  }
  Logger.log('Dauer: ' + Math.round((Date.now() - t0) / 1000) + ' s');
}


/** Kundenlogo (PNG, Base64) im Showroom-Ordner ablegen → Drive-Datei-ID für das CLP-Etikett */
function srLogo_(name, b64) {
  var titel = 'Logo-' + String(name || 'Kunde').replace(/[\\\/:*?"<>|]/g, '-') + '.png';
  var f = DriveApp.getFolderById(SR.ordner).createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', titel));
  if (SR.linkFreigabe) f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getId();
}

/** Test: CLP-Etikett mit Kundenadresse + Logo (nimmt zum Test das eigene Logo) */
function srTestLogo() {
  var r = srClp_({ customer: 'Test Logo', custNo: 'K-1001', country: 'DE', clpAddr: 'Muster Parfum GmbH, Musterstraße 1, 12345 Musterstadt, Tel: 0123 456789', clpLogo: '196zzG6vCPLUtDBfxbb-J8F1j6WSBr4-H',
    items: [{ t: 'Aqua Maris Signature', oil: 1, tier: 'Premium', code: 'AR-ADG-H-02-PQ-SH', size: '100 g', q: 1 }, { t: 'AC Di Sale', oil: 1, tier: 'Standard', code: 'PR-ADS-U-01-SH', size: '1 kg', q: 1 }] });
  Logger.log('TESTURL ' + r.files.map(function (f) { return f.url; }).join(' | ') + ' Fehlend: ' + JSON.stringify(r.fehlend));
}


/* ===== Einmal-Import: Auftrag SHATTA MO AS aus der PDF-Liste (nur Namen; Code nur als Hilfe bei Gleichstand) ===== */
var SHATTA_OV = { 'MFK Oud Silk Mood PQ': 'Silk Oud', 'Carolina Herrera 212 Sexy Men': 'rrera 212 Sexy Man' };   // 'Dateiname' oder 'Dateiname ## Code' -> Shop-Titel (t) | '' = auslassen
var SHATTA_TXT = "Montale Honey Aoud ## MO-HOA-U-08\nMontale Mukhallat ## MO-MUK-U-17\nMontale Arabians Musk ## MO-ARM-U-30 PQ\nMaison Francis Kurkdjian Baccarat Rouge 540 (PQ) ## MF-BAC-U-02-PQ\nMaison Francis Kurkdjian Grand Soir ## MF-GRS-U-06\nMaison Francis Kurkdjian Baccarat Rouge 540 Extrait de Parfum ## MF-BAX-U-07\nMaison Francis Kurkdjian Oud Satin Mood ## MF-OSM-U-08\nMFK Oud Silk Mood PQ ## MF-OSM-U-08 PQ\nDior Homme Intense (PQ) ## DI-HOI-H-02-PQ\nDior Homme Sport ## DI-HOS-H-03\nDior Sauvage (PQ) ## DI-SAU-H-06-PQ\nDior Sauvage Elixir ## DI-SAE-H-07\nCreed Silver (PQ) ## CR-SIL-U-02-PQ\nCreed Aventus (PQ) ## CR-AVE-H-04-PQ\nCreed Absolu Aventus PQ ## CR-ABS-U-12 PQ\nTiziana Terenzi Kirke (PQ) ## TT-KIR-U-01-PQ-SH\nJean Paul Gaultier Le Male ## JP-LEM-H-01\nJean Paul Gaultier JPG 2 ## JP-JP2-U-02\nJean Paul Gaultier Scandal Man ## JP-SCM-H-03\nJean Paul Gaultier Le Male Elixir ## JP-LME-H-04\nJean Paul Gaultier Ultra Male ## JP-ULM-H-05\nJean Paul Gaultier Le Beau Male ## JP-LBM-H-06\nJean Paul Gaultier Scandal Women ## JP-SCW-D-07\nJean Paul Gaultier Gaultier Divine ## JP-GAU-D-10\nJean Paul Gaultier Scandal by Night ## JP-SBN-D-11\nJean Paul Gaultier La Belle ## JP-BEL-D-12\nJPG Scandal Absolu ## JP-SAB-13\nJPG le male elixir absolu ## JP-LEMEAB-14\nMancera Red Tobacco ## MA-RET-U-01\nMancera Instant Crush ## MA-INC-U-07\nTerre d'Hermès ## HE-TER-H-01-PQ-SH\nZadig & Voltaire This is Her! ## ZV-HER-D-02\nViktor & Rolf Spicebomb ## VR-SPI-H-01\nViktor & Rolf Bonbon ## VR-BON-D-02\nFrédéric Malle Carnal Flower ## FM-CAR-U-01\nFrédéric Malle Portrait of a Lady ## FM-POL-D-02-PQ\nSynthetic Jungle Frédéric Malle ## FM-SJ-03-SH\nByredo Gypsy Water ## BY-GYW-U-02-PQ\nByredo Blanche ## BY-BLA-U-03\nByredo Black Saffron ## BY-BK-SN-D-04\nMojave Ghost Byredo ## BYR-MJG-04-SH\nMugler Angel Man ## MU-ANG-H-01\nMugler Angel Women ## MU-ANG-D-02\nMugler Alien (PQ) ## MU-ALI-D-04-PQ\nKenzo Green ## KE-GRE-H-01\nGivenchy Amarige ## GV-AMA-D-07\nGivenchy L'Interdit 2018 ## GV-LIN-D-10\nGivenchy L'Interdit Rouge ## GV-LIR-D-29\nRoja Dove Amber Aoud ## RJ-AMA-U-01\nRoja Dove Elysium Pour Homme ## RJ-ELY-H-02\nRoja Dove Reckless Pour Homme ## RJ-REC-H-03\nRoja Dove Enigma ## ROJ-ENI-05-SH\nRalph Lauren Romance ## RL-ROM-D-07\nWidian London (PQ) ## WD-LON-U-01-PQ\nBvlgari Aqva ## BV-AQV-H-02\nBvlgari Le Gemme Tygar ## BV-TYG-H-03\nBvlgari Jasmin Noir ## BV-JAS-D-05\nOrto Parisi Megamare ## OP-MEG-U-01\nValentino Uomo Born In Roma ## VA-UBR-H-02\nValentino Donna ## VA-DON-D-03\nValentino Donna Born In Roma ## VA-DBR-D-04\nGisada Ambassador ## GI-AMB-H-01\nGisada Ambassador Women ## GI-AMB-D-02\nGisada Titanium ## GIS-TIT-03\nJo Malone Wood Sage & Sea Salt ## JM-WSS-U-01\nJo Malone Myrrh & Tonka Perfume ## JM-MYT-U-03\nJo Malone Cypress & Grapevine intense ## JM-CYP-U-04-PQ\nCacharel Amor Amor ## CA-AMO-D-01\nEstée Lauder Pleasures ## EL-PLE-D-02\nRasasi Blue Lady ## RA-BLU-D-03\nElie Saab Girl of Now ## ES-GON-D-01\nElie Saab Le Parfum ## ES-LEP-D-02\nVictoria's Secret Fabulous ## VS-FAB-D-01\nVictoria's Secret Love is Heavenly ## VS-LIH-D-03\nChloé Nomade Eau de Parfum ## CHL-NOM-D-02\nMarc-Antoine Barrois Ganymede ## MB-GAN-U-01\nMarc-Antoine Barrois Tilia ## MAB-TIL-U-02\nMarc-Antoine Barrois Encelade ## MAB-ENC-03-SH\nVoyage (PQ) ## VO-PHO-H-02-PQ\nParis Hilton man ## PAR-PAR-H-01\nParis Hilton (Women) ## PH-PAR-D-02\nDior Fahrenheit (PQ) ## DI-FAH-H-15-PQ\nDior Fahrenheit 32 ## DI-FA3-H-16\nDior Addict ## DI-ADD-D-17\nDior J'adore ## DI-JAD-D-19\nDior Miss Dior Chérie ## DI-MDC-D-21\nDior Miss Dior Rose N'Roses ## DI-MDR-D-23\nDior Hypnotic Poison (PQ) ## DI-HYP-D-25-PQ\nDior Miss Dior Blooming Bouquet (PQ) ## DI-MDB-D-27-PQ\nDior Homme Cologne ## DI-HOM-COL-29\nDior L'Or de J'adore ## DI-JADLOR-D-30 PQ\nAttar Collection Khaltat Night ## AC-KHA-U-01\nOrange Flamingo ## MGB-OF-001-SH\nProfumum Roma Acqua di Sale ## PR-ADS-U-01\nPaco Rabanne Invictus ## PR-INV-H-03\nPaco Rabanne Invictus Aqua ## PR-INA-H-02\nPaco Rabanne Black XS ## PR-BXS-H-05\nPaco Rabanne Phantom ## PR-PHA-H-06\nPaco Rabanne One Million (PQ) ## PR-OMI-H-09-PQ\nPaco Rabanne 1 Million Lucky ## PR-OML-H-11\nPaco Rabanne 1 Million Elixir ## PR-OEL-H-12\nPaco Rabanne Olympēa ## PR-OLY-D-15\nPaco Rabanne Fame ## PR-FAM-D-18\nPaco Rabanne Lady Million ## PR-LMI-D-19\nPaco Rabanne Lady Million Lucky ## PR-LML-D-20\nPaco Rabanne Lady Million Royal ## PR-LMR-D-21\nMancera Roses Vanille ## MA-ROV-U-08\nMancera Coco Vanille ## MA-COC-U-09\nVersace Blue Jeans ## VE-BLU-H-01\nVersace Absolu ## VE-ABS-H-03\nVersace EROS ## VE-ERO-H-04\nVersace Bright Crystal ## VE-BRC-D-06\nCrystal Noir Versace ## VE-CRN-D-08-PQ-SH\nGucci Guilty ## GU-GUI-H-01\nGucci Bloom ## GU-BLO-D-05\nGucci Rush 2 ## GU-RU2-D-07\nGucci Rush ## GU-RUS-D-08\nGucci Flora Gorgeous Gardenia ## GU-FLG-D-10\nGucci Guilty Intense Women ## GU-GUW-D-11\nGucci Flora ## GU-FLO-D-12\nYves Saint Laurent L'Homme ## YS-LHO-H-01\nYves Saint Laurent La Nuit De L'Homme ## YS-LAN-H-02\nYves Saint Laurent MYSLF ## YS-MYS-H-03\nYves Saint Laurent Y ## YS-YYY-H-04\nYves Saint Laurent Black Opium (PQ) ## YS-BLO-D-06-PQ\nYves Saint Laurent Libre Intense (PQ) ## YS-LIB-D-09-PQ\nLibre Ysl ## YS-LIB-D-08-PQ-SH\nYves Saint Laurent Manifesto ## YS-MAN-D-11\nChanel Allure Homme Sport (PQ) ## CH-ALS-H-02-PQ\nChanel Platinum Égoïste ## CH-PLT-H-03\nHugo Boss Women ## HB-HUG-D-15\nHugo Boss The Scent For Her ## HB-TSH-D-18\nLacoste Red ## LC-RED-H-03\nLacoste White L.12.12 Blanc ## LC-WHI-H-05\nDunhill Desire Blue ## DU-DEB-H-01\nDunhill Desire ## DU-DES-H-02\nDunhill Fresh ## DU-FRE-H-03\nCalvin Klein Eternity ## CK-ETE-H-01\nCalvin Klein CK1-PQ ## CK-CK1-H-04-PQ\nCalvin Klein Escape Women ## CK-ESC-D-08\nCalvin Klein Eternity Women ## CK-ETE-D-09\nJoop! Homme ## JP-HOM-H-01\nJoop! Nightflight ## JP-NIG-H-02\nJoop! WOW! ## JP-WOW-H-03\nAl-Jazeera Perfumes Magic ## AJ-MAG-U-01\nAl-Jazeera Perfumes SULTAN N° 9 ## AJ-SUL-U-03\nDavidoff Cool Water Man ## DV-CWM-H-04\nChanel Bleu de Chanel (PQ) ## CH-BLE-H-05-PQ\nChanel N°5 ## CH-NO5-D-06\nChanel N°19 ## CH-NO1-D-07\nChanel Chance ## CH-CHA-D-08\nChanel Coco Mademoiselle (PQ) ## CH-COM-D-10-PQ\nChanel Coco ## CH-COC-D-12\nChanel Gabrielle ## CH-GAB-D-13\nGuerlain L'Homme Idéal ## GU-LHI-H-01\nGuerlain Santal Royal ## GU-SAR-U-04\nGuerlain Samsara ## GU-SAM-D-06\nGuerlain Tobacco Honey ## GU-TOH-U-09 PQ\nGuerlain Cherry Oud ## GU-CHO-U-10 PQ\nTonka Sarrapia Extrait 75 Guerlain ## GU-TSR-U-10\nAzzaro Wanted ## AZ-WAN-H-02\nAzzaro The Most Wanted ## AZ-MOW-H-03\nAzzaro Chrome ## AZ-CHR-H-04\nWanted by Night Azzaro ## AZZ-WBN-05\nPrada Luna Rossa Black ## PR-LRB-H-01\nPrada Luna Rossa Carbon ## PR-LRC-H-02\nPrada L'Homme ## PR-LHO-H-04\nPrada Paradoxe ## PR-PAR-D-05\nPrada Candy ## PR-CAN-D-06\nDolce & Gabbana The One ## DG-ONE-H-02\nDolce & Gabbana Light Blue Man ## DG-LBM-H-05\nDolce & Gabbana (Classic) women ## DG-DAG-D-06\nDolce & Gabbana Light Blue women ## DG-LIB-D-09\nDolce & Gabbana Devotion ## DG-DEV-U-11\nGivenchy Gentleman ## GV-GEN-H-01\nGivenchy Pi ## GV-PIH-H-03\nTom Ford Tobacco Vanille (PQ) ## TF-TOV-U-04-PQ\nTom Ford Tobacco Oud ## TF-TOU-U-05\nTom Ford Vanille Fatale ## TF-VAF-U-06\nTom Ford Noir Extreme (PQ) ## TF-NEX-U-09-PQ\nTom Ford Costa Azzurra Parfum ## TF-CAP-U-12\nTom Ford Ébène Fumé ## TF-EBE-U-13\nTom Ford Tuscan Leather ## TF-TUS-U-15\nTom Ford Oud Wood ## TF-OUW-U-16-PQ-SH\nTom Ford Fucking Fabulous ## TF-FFF-U-17\nNeroli Portofino Tom Ford ## TF-NER-U-20-PQ-SH\nTom Ford Ombre Leather Parfum ## TF-OLP-U-21\nTom Ford Soleil Blanc ## TF-SOL-U-23\nTom Ford Cherry Smoke ## TF-CHS-U-28-PQ\nTom Ford Vanilla Sex ## TF-VSX-U-29\nTom Ford Lost Cherry (PQ) ## TF-LOC-U-32-PQ\nBDK Parfums Gris Charnel ## BD-GRI-U-01\nBDK Parfums Velvet Tonka ## BDK-VT-U-02\nMontale Aoud Black ## MO-AOB-U-01\nMontale Roses Musk ## MO-ROS-U-02\nMontale Intense Cafe ## MO-CAF-U-03\nMontale Arabien Tonka (PQ) ## MO-ART-U-05-PQ\nMontale Intense Cherry ## MO-INC-U-07\nXerjoff Torino 21 ## XJ-T21-U-22-PQ\nXerjoff White on White ## XJ-WOW-U-33\nClive Christian Blonde Amber ## XD-BA-U-01-PQ\nMaison Crivelli Oud Maracujá ## MC-OMA-U-01-PQ\nMaison Crivelli Hibiscus Mahajád ## MC-HIB-U-02-PQ\nStéphane Humbert Lucas God of Fire ## SH-GOF-U-01\nBond No. 9 Dubai Amber ## BN-DUA-U-02\nThe Spirit of Dubai Dubai - Turath ## SD-TUR-U-01\nLouis Vuitton Ombre Nomade (PQ) ## LV-OMB-U-02-PQ\nLouis Vuitton Afternoon Swim ## LV-AFS-U-03\nLouis Vuitton Cactus Garden ## LV-CAC-U-04\nChloé Love Story ## CHL-LOV-D-03\nNarciso Rodriguez Narciso Rouge ## NR-RGE-D-01\nNarciso Rodriguez for Her ## NR-FH-D-02\nNarciso Rodriguez Poudrée ## NR-PDR-D-03\nNarciso Rodriguez Musc Noir For Her ## NR-MNFH-D-04\nNarciso Rodriguez For Her Pure Musc ## NR-PMU-U-06\nMilton Lloyd Hawaii ## ML-HWI-D-01\nOriental Touch Harem des Sultans ## OT-HDS-D-01\nArabian Originals White Musk (PQ) ## AR-002\nArabian Originals Kaaba Musk ## AR-003\nArabian Originals Musk Makka ## AR-006\nArabian Originals Musk Tahara ## AR-007\nArabian Originals Rosen-Moschus Tahara ## AR-008\nArabian Originals Granatapfel- Moschus Tahara ## AR-009\nArabian Originals Puder-Moschus Tahara ## AR-010\nArabian Originals Vanille- Moschus Tahara ## AR-011\nArabian Originals Lavender ## AR-078\nArabian Originals Narzisse ## AR-079\nArabian Originals Cranberry ## AR-081\nArabian Originals Gory Roses / Blutige Rosen ## AR-083\nArabian Originals Perfume of Paradise ## AR-085\nLancôme Oud Bouquet ## LC-OUB-H-01\nArabian Originals Oud Mubakhar Saudi-Arabien ## AR-087\nArabian Originals Lataffa Yara ## AR-093\nArabian Originals Lataffa Ammerat Al Arab ## AR-094\nArabian Originals Lataffa Khamra ## AR-098\nArabian Originals Lataffa An Abiyadehe ## AR-099\nArabian Originals Imperial Valley Gissah ## AR-104\nArabian Originals Sheikh Al Shuyukh ## AR-107\nArabian Originals Al-Haitham ## AR-111\nAnfas Ishq ## AR-112\nRoyal Musk Saudi Arabien ## AR-115-PQ\nLouis Vuitton Imagination (PQ) ## LV-IMA-U-06-PQ\nLouis Vuitton Météore ## LV-MET-U-07\nLouis Vuitton California Dream ## LV-CAD-U-09\nLouis Vuitton L'Immensité ## LV-IMM-U-11\nLouis Vuitton Pacific Chill ## LV-PAC-U-15\nLouis Vuitton On the Beach ## LV-OTB-U-22-PQ\nJazz Club Maison Margiela ## MM-JC-001-SH\nParfums de Marly Herod ## PM-HER-H-23\nParfums de Marly Haltane ## PM-HAL-H-03\nParfums de Marly Layton (PQ) ## PM-LAY-H-05-PQ\nParfums de Marly Oajan ## PM-OAJ-H-08\nParfums de Marly Althaïr ## PM-ALT-H-10\nParfums de Marly Delina ## PM-DEL-D-14\nParfums de Marly Valaya ## PM-VAL-D-15\nParfums de Marly Palatine ## PDM-PLT-U-16\nParfums de Marly Sedley ## PDM-SDL-H-17\nParfums de Marly Greenley ## PM-GRN-U-18 PQ\nTom Ford Black Orchid (PQ) ## TF-BLO-U-02-PQ\nMontblanc Legend ## MB-LEG-H-01\nRalph Lauren Polo Explorer ## RL-PEX-H-03\nCarolina Herrera 212 ## CH-212-H-01\nCarolina Herrera VIP ## CH-VIP-H-03\nCarolina Herrera 212 Sexy Men ## CH-SEX-H-04\nCarolina Herrera Bad Boy ## CH-BAD-H-05\nCarolina Herrera Good Girl ## CH-GOG-D-06\nCarolina Herrera Good Girl Blush ## CH-GOB-D-07\nCarolina Herrera Good Girl Fantastic Pink ## CH-GFP-D-08\nCarolina Herrera Sexy 212 ## CH-SX2-D-09\nPlay boy ## PB-PLY-U-01\nLancôme Idôle ## LC-IDO-D-02\nLancôme Trésor ## LC-TRE-D-03\nLancôme Idôle Now ## LC-IDN-D-04\nLancôme La Vie Est Belle (PQ) ## LC-LVB-D-06-PQ\nKayali Vanilla | 28 ## KA-VAN-D-02\nKayali Vanilla Candy Rock Sugar | 42 ## KA-VCR-D-03\nKayali Oudgasm Vanilla Oud | 36 ## KA-OVO-D-04\nKayali Yum Boujee Marshmallow | 81 ## YU-BMM-U-11\nKayali Eden Juicy Apple | 01 ## KA-EJAP-12\nGiardini di Toscana Bianco Latte ## GT-BIA-D-01\nVanilla Powder Matiere Premiere ## MP-VP-01\nArmani Acqua di Gio (PQ) ## AR-ADG-H-02-PQ\nArmani Stronger with you (PQ) ## AR-STY-H-05-PQ\nArmani intensely Stronger with you ## AR-IST-H-06\nArmani Code ## AR-COD-H-08\nArmani Si Intense ## AR-SII-D-19\nArmani My Way ## AR-MYW-D-20\nBergamote 22 Le Labo ## LL-B22-002-SH\nArmani Code ## AR-COD-D-14\nXerjoff Accento ## XJ-ACC-U-01\nXerjoff Erba pura (PQ) ## XJ-ERB-U-03-PQ\nXerjoff Erba Gold ## XJ-EGO-U-04\nXerjoff Sospiro Vibrato ## SO-VIB-U-08\nXerjoff Alexandria II (PQ) ## XJ-AL2-U-10-PQ\nXerjoff Shooting Stars Oesel ## XJ-OES-U-14\nXerjoff Naxos (PQ) ## XJ-NAX-U-16-PQ\nXerjoff Purple Accento ## XJ-PAC-U-17\nAmouage Reflection Man ## AM-REF-H-01-PQ-SH\nAmouage Reflection Women ## AM-REF-D-08\nAmouage Guidance 46 ## AM-GUI-D-16 PQ\nAmouage Purpose 50 ## AMO-P50-17-SH\nAngels' Share Kilian Premium Qualität ## KL-ANG-U-01 PQ\nKilian Smoking Hot ## KL-SMK-U-02\nBy Kilian Back to Black, Aphrodisiac ## KL-APH-U-08\nKilian Musk Oud ## KL-MOU-U-07\nKilian Love Don't Be Shy (PQ) ## KL-LDS-U-10-PQ\nKilian Black Phantom ## KIL-BK-PM-15\nInitio Side Effect ## IN-SID-U-01\nInitio Oud for Greatness ## IN-OFG-U-02\nInitio Oud for Happiness ## IN-OFH-U-03\nInitio Musk Therapy ## IN-MUT-U-04\nNishane Hacivat ## NI-HAC-U-01\nNishane Ani ## NI-ANI-U-02\nNishane Hacivat X ## NI-HAX-U-03\nNishane Nefs (PQ) ## NI-NEF-U-06-PQ\nEx Nihilo Fleur Narcotique ## EN-FLN-U-01\nEx Nihilo Blue Talisman ## EN-BLT-U-02\nEscentric Molecules Molecule 02 ## EM-MO2-U-01\nEscentric Molecules Molecule 01 ## EM-MO1-U-02\nBurberry Burberry (Classic) ## BU-BUR-H-01\nBurberry Hero ## BU-HER-H-02\nBurberry Her ## BU-HER-D-05\nBurberry Goddess ## BU-GOD-D-06\nNasomatto Black Afgano (PQ) ## NA-BLA-U-02-PQ\nHugo Boss Hugo Boss (PQ) ## HB-HUG-H-02-PQ\nHugo Boss Bottled Elixir ## HB-ELI-H-03\nHugo Boss The Scent Elixir ## HB-TSE-H-04\nHugo Boss Bottled ## HB-BOT-H-07\nHugo Boss The Scent For Him ## HB-TSE-H-09\nFendi ## FEN-FEN-U-01\nUnknown Kaher Alnesaa ## UNK-KAH-U-01\nEscada Sexy Graffiti ## ES-SEG-D-01";
function shNz_(s) {
  s = ' ' + String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ') + ' ';
  s = s.replace(/ premium qualitat /g, ' ').replace(/ mfk /g, ' maison francis kurkdjian ').replace(/ jpg /g, ' jean paul gaultier ').replace(/ ysl /g, ' yves saint laurent ');
  var seen = {}, out = [];
  s.split(' ').forEach(function (t) { if (!t || t === 'pq' || seen[t]) return; seen[t] = 1; out.push(t); });
  return out;
}
function shDice_(A, B) { if (!A.length || !B.length) return 0; var m = {}, n = 0; A.forEach(function (t) { m[t] = 1; }); B.forEach(function (t) { if (m[t]) n++; }); return 2 * n / (A.length + B.length); }
function shTier_(p) {
  var c = {};
  // Varianten heißen "1 kg / Premium" ODER "Premium / 1 kg" – die Größe ist der Teil mit g/kg
  p.v.forEach(function (v) {
    var a = String(v[0] || '').split(' / '); if (a.length < 2) return;
    var iG = /\d\s*k?g$/i.test(a[0].trim()) ? 0 : a.length - 1, sz = a[iG].toLowerCase().replace(/\s+/g, '');
    if (!/(^|[^0-9.,])1kg$/.test(sz)) return;
    c[a[iG === 0 ? a.length - 1 : 0].trim()] = v;
  });
  var ks = Object.keys(c);
  var k = ks.filter(function (x) { return /premium/i.test(x); })[0] || ks.filter(function (x) { return /exklusiv/i.test(x); })[0] || ks.filter(function (x) { return /standard/i.test(x); })[0] || ks[0];
  return k ? { tier: k, v: c[k], alle: ks.join('/') } : null;
}
function shattaLauf_(anlegen) {
  var cat = JSON.parse(srSync_()).items.filter(function (p) { return p.o && p.v && p.v.length; });
  cat.forEach(function (p) { p.na = shNz_(p.a || p.t); var sku = ''; p.v.forEach(function (v) { if (!sku && v[1]) sku = v[1]; }); p.b = srBasis_(sku); });
  var gesehen = {}, alle = [], pruef = [], items = [], benutzt = {}, summe = 0;
  SHATTA_TXT.split('\n').map(function (z) { return z.trim(); }).filter(String).forEach(function (z) {
    if (gesehen[z]) return; gesehen[z] = 1;
    var teil = z.split(' ## '), name = teil[0], fc = srBasis_(String(teil[1] || '').replace(/\s+/g, '-')), A = shNz_(name);
    var status = '', p = null, sc = 0, alt = '';
    var hatOv = SHATTA_OV.hasOwnProperty(z) || SHATTA_OV.hasOwnProperty(name);
    if (hatOv) {
      var ov = SHATTA_OV.hasOwnProperty(z) ? SHATTA_OV[z] : SHATTA_OV[name];
      if (!ov) status = 'AUSGELASSEN';
      else { p = cat.filter(function (q) { return q.t === ov; })[0] || null; status = p ? 'OK-MANUELL' : 'MANUELL NICHT GEFUNDEN'; sc = 1; }
    } else {
      var rang = cat.map(function (q) { return { q: q, s: shDice_(A, q.na) }; }).sort(function (x, y) { return y.s - x.s; });
      var b = rang[0], c = rang[1], perCode = cat.filter(function (q) { return q.b === fc; })[0] || null;
      alt = rang.slice(0, 3).map(function (r) { return (r.q.a || '-') + ' [' + r.q.t + '] ' + r.s.toFixed(2); }).join(' | ') + (perCode ? ' || CODE: ' + (perCode.a || '-') + ' [' + perCode.t + ']' : ' || CODE: -');
      if (b.s >= 0.85 && (b.s - c.s >= 0.08 || perCode === b.q)) { p = b.q; sc = b.s; status = (perCode && perCode !== b.q) ? 'OK?-CODE-ANDERS' : 'OK'; }
      else if (perCode && shDice_(A, perCode.na) >= 0.5) { p = perCode; sc = shDice_(A, perCode.na); status = 'OK?-PER-CODE'; }
      else { status = 'PRUEFEN'; sc = b.s; }
    }
    var row = [name, teil[1] || '', status, Math.round(sc * 100) / 100, '', '', '', '', '', alt];
    if (p) {
      var tv = shTier_(p); row[4] = p.a || ''; row[5] = p.t;
      if (!tv) row[2] = 'KEIN-1KG';
      else {
        var sku = tv.v[1] || '', m = /^(.*?-SH)(?:-|$)/.exec(sku), code = m ? m[1] : sku;
        row[6] = tv.tier + ' (' + tv.alle + ')'; row[7] = code; row[8] = +tv.v[2];
        if (benutzt[p.t]) row[2] = 'DOPPELT mit: ' + benutzt[p.t];
        else { benutzt[p.t] = name; summe += +tv.v[2]; items.push({ t: p.t, a: p.a || '', oil: 1, tier: tv.tier, code: code, size: '1 kg', sku: sku, price: +tv.v[2], q: 1 }); }
      }
    }
    alle.push(row); if (row[2] !== 'OK') pruef.push(row);
  });
  var kopf = ['Datei-Name', 'Datei-Code', 'Status', 'Score', 'Shop-Originalname', 'Shop-Titel', 'Qualität', 'Code', 'Preis', 'Kandidaten'];
  if (!anlegen) {
    var ss = SpreadsheetApp.create('Shatta-Import-Pruefung');
    var s1 = ss.getSheets()[0].setName('Pruefen'); s1.getRange(1, 1, 1, 10).setValues([kopf]); if (pruef.length) s1.getRange(2, 1, pruef.length, 10).setValues(pruef);
    var s2 = ss.insertSheet('Alle'); s2.getRange(1, 1, 1, 10).setValues([kopf]); s2.getRange(2, 1, alle.length, 10).setValues(alle);
    Logger.log('SHATTA zeilen=' + alle.length + ' items=' + items.length + ' pruefen=' + pruef.length + ' summe=' + summe + ' katalog=' + cat.length + ' PID ' + ss.getId().split('').join('.'));
    return;
  }
  var kunden = srList_('customers').map(function (r) { var o = JSON.parse(r.json); o.id = r.id; return o; });
  var istS = function (x) { return String(x || '').toLowerCase().replace(/\s+/g, ' ').trim() === 'shatta mo as'; };
  var k = kunden.filter(function (c) { return istS(c.name); })[0] || {};
  var listen = srList_('lists').map(function (r) { return JSON.parse(r.json); }).filter(function (l) { return istS(l.customer); });
  var letzte = listen[listen.length - 1] || {};
  var rec = { customer: k.name || letzte.customer || 'Shatta MO AS', note: '', rabatt: 0, rabattFix: 0,
    clpAddr: 'Shatta MO AS, Linderudsletta 17A, 0597 Oslo, Telefon: 942 11 610', clpLogo: '1lg25QrVf4TtENDdCU1i33PbbmVQwAj3Q',   // zugeschnittenes Logo (Upload 13.10. 19:56)
    street: letzte.street || k.street || 'Linderudsletta 17A', city: letzte.city || k.city || '0597 Oslo', country: letzte.country || k.country || 'NO',
    items: items, status: 'new', at: Date.now(), custNo: k.no || letzte.custNo || '' };
  var json = JSON.stringify(rec), gekuerzt = '';
  if (json.length > 49000) { items.forEach(function (i) { delete i.a; }); json = JSON.stringify(rec); gekuerzt = 'ohne a'; }
  if (json.length > 49000) { items.forEach(function (i) { delete i.sku; }); json = JSON.stringify(rec); gekuerzt = 'ohne a+sku'; }
  if (json.length > 49000) throw new Error('Auftrag zu gross: ' + json.length);
  var id = srAdd_('lists', json);
  PropertiesService.getScriptProperties().setProperty('SHATTA_CLP', JSON.stringify({ id: id }));
  ScriptApp.newTrigger('shattaClp').timeBased().after(5000).create();
  Logger.log('SHATTA ANGELEGT id=' + id + ' items=' + items.length + ' summe=' + summe + ' laenge=' + json.length + ' ' + gekuerzt + ' kunde=' + rec.customer + ' nr=' + rec.custNo + ' land=' + rec.country + ' logo=' + (rec.clpLogo ? 'ja' : 'nein'));
}
function shattaPruefen() { shattaLauf_(false); }
function shattaAnlegen() { shattaLauf_(true); }

function shattaDebug() {
  var cat = JSON.parse(srCatalog_()).items.filter(function (p) { return p.o; });
  var re = /saffron|safran|flamingo|fire|herod|valaya|herm|jungle|mojave|enigma|encelade|crystal|jazz|purpose|alexandri/i;
  var rows = cat.filter(function (p) { return re.test(p.t + ' ' + (p.a || '')); }).map(function (p) { return [p.t, p.a || '', p.v.map(function (v) { return v[0] + ' = ' + v[2]; }).join(' ; ')]; });
  var tiers = {};
  cat.forEach(function (p) { var s = {}; p.v.forEach(function (v) { var a = String(v[0] || '').split(' / '); s[a.length > 1 ? a[a.length - 1].trim() : '(ohne)'] = 1; }); var k = Object.keys(s).sort().join('+'); tiers[k] = (tiers[k] || 0) + 1; });
  rows.push(['TIERS', JSON.stringify(tiers), '']);
  var ss = SpreadsheetApp.openById('1jERnxPPZ3VsUoE90Otc5EpT6eShcVh80zNTAE0KAfw8');
  var sh = ss.getSheetByName('Debug') || ss.insertSheet('Debug'); sh.clear(); sh.getRange(1, 1, rows.length, 3).setValues(rows);
  Logger.log('DEBUG ' + rows.length);
}

/** CLP-Etiketten des SHATTA-Auftrags in Teilen (je 40) im Schnellmodus erzeugen; ruft sich per Trigger selbst weiter auf. */
function shattaClp() {
  var props = PropertiesService.getScriptProperties();
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'shattaClp') ScriptApp.deleteTrigger(t); });
  var st = JSON.parse(props.getProperty('SHATTA_CLP') || '{}');
  var melde = function (txt) { try { var ss = SpreadsheetApp.openById('19rTU-95CIv6477ImRhqrsZubw5zuDezhDUzebEbqCu8'); var sh = ss.getSheetByName('Status') || ss.insertSheet('Status'); sh.appendRow([new Date(), txt]); } catch (e) {} Logger.log('SHATTA CLP ' + txt); };
  if (!st.id || st.fertig) { melde('nichts zu tun'); return; }
  var GR = [4, 3.5, 3.2, 3], N = 40;
  st.teil = st.teil || 0; st.gi = st.gi || 0; st.files = st.files || []; st.fehlend = st.fehlend || []; st.versuche = (st.versuche || 0) + 1;
  if (st.versuche > 4) { st.fertig = true; props.setProperty('SHATTA_CLP', JSON.stringify(st)); melde('ABBRUCH bei Teil ' + (st.teil + 1) + ' (zu viele Versuche)'); return; }
  props.setProperty('SHATTA_CLP', JSON.stringify(st));
  ScriptApp.newTrigger('shattaClp').timeBased().after(7 * 60 * 1000).create();   // Wächter, falls dieser Lauf abbricht
  var sh = srBlatt_('lists'), z = srZeile_(sh, st.id); if (!z) { melde('Auftrag nicht gefunden'); return; }
  var l = JSON.parse(sh.getRange(z, 3).getValue());
  var oele = (l.items || []).filter(function (i) { return i.oil != null ? !!i.oil : !!i.tier; });
  var teile = Math.ceil(oele.length / N), stueck = oele.slice(st.teil * N, st.teil * N + N), t0 = Date.now();
  try {
    var kopie = JSON.parse(JSON.stringify(l)); kopie.items = stueck;
    ETIKETT.festSchrift = GR[st.gi];
    var r = srClp_(kopie);
    ETIKETT.festSchrift = 0;
    var f = (r.files || []).filter(function (x) { return /^CLP-Etiketten/.test(x.name); })[0];
    var erwartet = (stueck.length - (r.fehlend || []).length) * etSprachen_(String(l.country || 'DE').toUpperCase()).length;
    var seiten = f ? etSeiten_(Utilities.newBlob(Utilities.base64Decode(f.b64), 'application/pdf', 'x.pdf')) : 0;
    var fid = f ? (/\/d\/([^\/]+)/.exec(f.url) || [])[1] : '';
    if (f && seiten > erwartet && st.gi < GR.length - 1) {
      if (fid) DriveApp.getFileById(fid).setTrashed(true);
      melde('Teil ' + (st.teil + 1) + '/' + teile + ' bei ' + GR[st.gi] + ' pt: ' + seiten + ' Seiten statt ' + erwartet + ' -> kleiner (' + Math.round((Date.now() - t0) / 1000) + ' s)');
      st.gi++; st.versuche = 0;
    } else {
      if (f) { var name = 'CLP-Etiketten-' + String(l.customer) + '-Teil-' + (st.teil + 1) + '-von-' + teile + '.pdf'; if (fid) DriveApp.getFileById(fid).setName(name); st.files.push({ name: name, url: f.url }); }
      st.fehlend = st.fehlend.concat(r.fehlend || []);
      melde('Teil ' + (st.teil + 1) + '/' + teile + ' fertig: ' + seiten + ' Seiten (erwartet ' + erwartet + '), ' + GR[st.gi] + ' pt, fehlend ' + (r.fehlend || []).length + ', ' + Math.round((Date.now() - t0) / 1000) + ' s');
      st.teil++; st.gi = 0; st.versuche = 0;
    }
    if (st.teil >= teile) {
      st.fertig = true;
      var sig = JSON.stringify([oele.map(function (i) { return [i.code, i.tier, i.size, i.q || 1, i.t]; }), l.clpAddr || '', l.country || 'DE', l.custNo || ''].concat(l.clpLogo ? [l.clpLogo] : []));
      srUpdate_('lists', st.id, JSON.stringify({ clpFiles: st.files, clpSig: sig, clpAt: Date.now(), clpNote: st.fehlend.length ? 'بدون ملصق CLP: ' + st.fehlend.join('، ') : '' }));
      melde('ALLES FERTIG: ' + st.files.length + ' Dateien, fehlend: ' + JSON.stringify(st.fehlend));
    }
  } catch (e) {
    ETIKETT.festSchrift = 0;
    melde('FEHLER Teil ' + (st.teil + 1) + ': ' + (e && e.message || e));
  }
  props.setProperty('SHATTA_CLP', JSON.stringify(st));
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'shattaClp') ScriptApp.deleteTrigger(t); });
  if (!st.fertig) ScriptApp.newTrigger('shattaClp').timeBased().after(10 * 1000).create();
}


/* ---------------- Automatische Bereinigung: Showroom-Listen nach 7 Tagen endgültig löschen ---------------- */
var SR_LOESCHEN_TAGE = 7;

/** EINMAL ausführen: richtet den täglichen Lauf (03:00) ein. */
function srBereinigungEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'srBereinigung') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('srBereinigung').timeBased().everyDays(1).atHour(3).create();
  Logger.log('Bereinigung eingerichtet: täglich 03:00, Dateien älter als ' + SR_LOESCHEN_TAGE + ' Tage werden endgültig gelöscht.');
  return srBereinigung();
}

/** Löscht PDFs im Ordner "Showroom-Listen", die älter als SR_LOESCHEN_TAGE sind, ENDGÜLTIG (ohne Papierkorb). */
function srBereinigung() {
  var grenze = Date.now() - SR_LOESCHEN_TAGE * 24 * 60 * 60 * 1000;
  var it = DriveApp.getFolderById(SR.ordner).getFiles(), n = 0;
  while (it.hasNext()) {
    var f = it.next();
    if (f.getDateCreated().getTime() < grenze) {
      try { Drive.Files.remove(f.getId()); n++; }
      catch (e) { try { f.setTrashed(true); n++; } catch (x) {} }
    }
  }
  Logger.log('Bereinigung: ' + n + ' Datei(en) gelöscht.');
  return n;
}

/** Test: schneller CLP-Modus (40 Etiketten aus 2 Düften) – Dauer und Seiten-Wiederholungen im Protokoll */
function srTestClpSchnell() {
  var t0 = Date.now();
  var r = srClp_({ customer: 'Test Kunde', custNo: 'K-1001', items: [{ t: 'Aqua Maris Signature', oil: 1, tier: 'Premium', code: 'AR-ADG-H-02-PQ-SH', size: '100 g', q: 25 }, { t: 'Testduft ohne Zertifikat', oil: 1, tier: 'Standard', code: 'XX-TEST-U-99-SH', size: '250 g', q: 15 }] }, true);
  Logger.log('Dateien: ' + r.files.map(function (f) { return f.name + ' rep=' + JSON.stringify(f.rep) + ' (' + f.b64.length + ' Zeichen)'; }).join(', '));
  Logger.log('Fehlend: ' + JSON.stringify(r.fehlend));
  Logger.log('Dauer: ' + Math.round((Date.now() - t0) / 1000) + ' s');
}


/* ===== CLP schnell (17.10.2026): die App baut die Etiketten selbst – hier nur die Grunddaten ===== */
function srClpBasis_() {
  var codes = {}, canon = {};
  if (typeof loadCodeMap === 'function') {
    var m = loadCodeMap(), c = m.__canon || {};
    Object.keys(m).forEach(function (k) { if (k !== '__canon' && m[k] && m[k].factory) codes[k] = String(m[k].factory); });
    Object.keys(c).forEach(function (k) { if (c[k] && c[k].factory) canon[k] = String(c[k].factory); });
  } else codes = srFabrikCodes_();
  var ss = openCodesSpreadsheet(), clp = {}, w = ss.getSheetByName(etClpBlatt_()).getDataRange().getValues();
  for (var i = 1; i < w.length; i++) {
    var r = w[i], k = String(r[0]).replace(/\.0$/, '').trim();
    if (!k || clp.hasOwnProperty(k)) continue;                       // erster Treffer zählt (wie etLadeClp_)
    var ufi = String(r[13] || '').trim().toUpperCase();
    clp[k] = { s: String(r[2]).trim(), g: etListe_(r[3]), h: etListe_(r[4]), p: etListe_(r[5]),
               e: String(r[11] || r[6] || '').trim(), b: String(r[7] || '').trim(),
               u: /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(ufi) ? ufi : '' };
  }
  var saetze = {}, ws = ss.getSheetByName('Sätze').getDataRange().getValues();
  for (var j = 1; j < ws.length; j++) {
    var code = String(ws[j][0]).replace(/\s+/g, '').toUpperCase();
    if (code) saetze[code] = ws[j].slice(1, 8).map(function (x) { return String(x).trim(); });
  }
  var props = PropertiesService.getScriptProperties(), pikto = {};
  ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'].forEach(function (g) { pikto[g] = props.getProperty('PIKTO_' + g) || ''; });
  return JSON.stringify({ at: Date.now(), codes: codes, canon: canon, clp: clp, saetze: saetze, pikto: pikto,
    adresse: ETIKETT.adresse, ohneP: ETIKETT.ohneP, immerP: (typeof ET_IMMER_P !== 'undefined') ? ET_IMMER_P : ['P102'],
    qrShop: (typeof ETIKETT_QR !== 'undefined') ? ETIKETT_QR.shop : 'https://fragranceshub.de' });
}
/** Bild (Piktogramm / Kundenlogo) aus Drive als Base64 – nur Bilder */
function srImg_(id) {
  var b = DriveApp.getFileById(String(id)).getBlob(), mime = b.getContentType();
  if (!/^image\//.test(mime)) throw new Error('Keine Bilddatei');
  return { mime: mime, b64: Utilities.base64Encode(b.getBytes()) };
}
/** Test: Größe der CLP-Grunddaten */
function srTestClpBasis() { var t = Date.now(), s = srClpBasis_(), o = JSON.parse(s);
  Logger.log('CLP-Basis: ' + s.length + ' Zeichen, Codes ' + Object.keys(o.codes).length + ', CLP ' + Object.keys(o.clp).length + ', Sätze ' + Object.keys(o.saetze).length + ', ' + (Date.now() - t) + ' ms'); }


/* ===== Druck-Warteschlange (17.10.2026): Handy/Tablet → Mini-PC im Lager → Epson ColorWorks ===== */
function srDruckOrdner_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('SR_DRUCK_ORDNER');
  if (id) { try { var f0 = DriveApp.getFolderById(id); if (!f0.isTrashed()) return f0; } catch (e) {} }
  var f = DriveApp.getFolderById(SR.ordner).createFolder('Druck-Warteschlange');
  p.setProperty('SR_DRUCK_ORDNER', f.getId());
  return f;
}
/** App legt ein PDF in die Warteschlange */
function srDruck_(name, b64) {
  var n = String(name || 'Etiketten.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
            .replace(/[^A-Za-z0-9 ._-]/g, '-').slice(0, 80);
  if (!/\.pdf$/i.test(n)) n += '.pdf';
  b64 = String(b64 || '');
  var p = PropertiesService.getScriptProperties(), c = CacheService.getScriptCache();
  // schneller Weg (Druck-PC online): Auftrag im Zwischenspeicher, der Druck-PC wartet schon darauf (srDruckHolen_) → druckt in 1–2 Sekunden
  if (Date.now() - (+p.getProperty('SR_DRUCK_PC') || 0) < 60000 && b64.length <= 1800000) {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), teile = {}, k = 0;
    for (var i = 0; i < b64.length; i += 95000) teile['SRJ_' + id + '_' + (k++)] = b64.slice(i, i + 95000);
    c.putAll(teile, 21600);
    p.setProperty('SRJQ_' + id, JSON.stringify({ n: n, k: k, t: Date.now() }));
    c.put('SR_NEU', String(Date.now()), 21600);
    return 'c' + id;
  }
  // Druck-PC aus / sehr große Datei: wie bisher als Datei – wird beim nächsten Einschalten gedruckt
  var f = srDruckOrdner_().createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', n));
  p.setProperty('SR_DRUCK', String(Date.now()));
  c.put('SR_NEU', String(Date.now()), 21600);
  return f.getId();
}
/** Mini-PC holt neue Druckaufträge (älteste zuerst). Wartet bis zu 15 s auf neue Aufträge (Long-Polling) → sofortiger Druck */
function srDruckHolen_(immer) {
  var p = PropertiesService.getScriptProperties(), c = CacheService.getScriptCache(), ende = Date.now() + 15000, erst = true;
  p.setProperty('SR_DRUCK_PC', String(Date.now()));
  while (true) {
    if (erst || c.get('SR_NEU')) {
      c.remove('SR_NEU');
      var out = srDruckSammeln_(p, c, immer);
      if (out.length) return out;
    }
    erst = false;
    if (Date.now() > ende) return [];
    Utilities.sleep(500);
  }
}
function srDruckSammeln_(p, c, mitDrive) {
  var alleP = p.getProperties(), out = [];
  // 1) DHL-Etiketten (klein, direkt als Eigenschaft) und Aufträge im Zwischenspeicher – nach Zeit sortiert
  var keys = Object.keys(alleP).filter(function (k) { return k.indexOf('SRQ_') === 0 || k.indexOf('SRJQ_') === 0; })
    .sort(function (a, b) { return a.replace(/^SRJ?Q_/, '').localeCompare(b.replace(/^SRJ?Q_/, '')); });
  keys.slice(0, 5).forEach(function (k) {
    try {
      var j = JSON.parse(alleP[k]);
      if (k.indexOf('SRQ_') === 0) out.push({ id: k, name: j.n, b64: j.b });
      else {
        var id = k.slice(5), names = []; for (var i = 0; i < j.k; i++) names.push('SRJ_' + id + '_' + i);
        var got = c.getAll(names), b64 = names.map(function (x) { return got[x] || ''; });
        if (b64.every(function (x) { return x; })) { out.push({ id: k, name: j.n, b64: b64.join('') }); c.removeAll(names); }
      }
    } catch (e) {}
    p.deleteProperty(k);
  });
  if (keys.length > 5) c.put('SR_NEU', '1', 21600);
  // 2) ältere Aufträge als Datei (Druck-PC war aus)
  if (out.length < 5 && (mitDrive || p.getProperty('SR_DRUCK'))) {
    var it = srDruckOrdner_().getFiles(), alle = [];
    while (it.hasNext()) alle.push(it.next());
    alle.sort(function (x, y) { return x.getDateCreated() - y.getDateCreated(); });
    var take = Math.min(alle.length, 5 - out.length);
    alle.slice(0, take).forEach(function (f) { out.push({ id: f.getId(), name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) }); f.setTrashed(true); });
    if (alle.length <= take) p.deleteProperty('SR_DRUCK'); else c.put('SR_NEU', '1', 21600);
  }
  return out;
}
/** App fragt: war der Drucker-PC in den letzten 30 s online? */
function srDruckStatus_() { var t = +PropertiesService.getScriptProperties().getProperty('SR_DRUCK_PC') || 0; return { online: Date.now() - t < 30000, zuletzt: t }; }