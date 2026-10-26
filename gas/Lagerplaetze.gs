/* =====================================================================
   Lagerplaetze.gs – Lagerplätze (A01-1-2) + Zählliste für die Inventur
   Diese Datei MUSS die letzte Datei im Projekt sein: sie ersetzt
   srApi (Showroom.gs) sowie lagerInventur und lagerBestandVon (Lager.gs)
   durch erweiterte Fassungen. Neue Aktionen: lg_plan, lg_zaehl,
   lg_platz, lg_invstart, lg_report, users_get, users_set.
   Ersetzt außerdem srPin_ (Mitarbeiter-PINs), lagerBuche_ und lagerBewegungen
   (Benutzer-Spalte). Änderungen an diesen Funktionen künftig HIER vornehmen.
   ===================================================================== */

function srApi(pin, action, a, b, c, dev) {
  try {
    srPin_(pin, dev);
    /* Druck-PC-Schlüssel darf nur Druckaufträge holen */
    if (SR_DRUCK && action !== 'check' && action !== 'druckholen') return { err: 'NUR_DRUCK' };
    var need = srNeed_(action, a);
    if (need && !srCan_(need)) return { err: 'KEINE_BERECHTIGUNG' };
    switch (action) {
      case 'check':   if (!SR_DRUCK) srLog_(SR_USER, SR_DEV_N, 'دخول', ''); return { val: { ok: true, user: SR_USER, admin: SR_ADMIN, owner: SR_OWNER, perms: SR_PERMS } };
      case 'dev_list': return { val: srDevList_() };
      case 'dev_set':  return { val: srDevSet_(JSON.parse(a)) };
      case 'log_get':  return { val: srLogGet_() };
      case 'users_get': if (!SR_ADMIN) return { err: 'NUR_INHABER' }; return { val: srUsers_() };
      case 'users_set': return { val: srUsersSet_(JSON.parse(a)) };
      case 'lg_report': return { val: lagerBericht() };
      case 'list':    return { val: srList_(a) };
      case 'add':     return { val: srAdd_(a, b, c) };
      case 'pull':    { var pr = srPull_(a); if (!srCan_('cash') && pr && pr.data) delete pr.data.cash; if (SR_OWNER && pr) pr.devWait = srDevWait_(); return { val: pr }; }
      case 'pdf':     return { val: srPdf_(a) };
      case 'update':  return { val: srUpdate_(a, b, c) };
      case 'del':     return { val: srDel_(a, b) };
      case 'catalog': return { val: srCatalog_() };
      case 'sync':    return { val: srSync_() };
      case 'upload':  return { val: srUpload_(a, b) };
      case 'upload2': return { val: srUpload2_(a, b, c) };
      case 'logo':    return { val: srLogo_(a, b) };
      case 'clp':     { var au = JSON.parse(a); if (typeof chKontext_ === 'function') chKontext_(au); return { val: srClp_(au, b === 'rep') }; }
      case 'clpbasis': return { val: srClpBasis_() };
      case 'img':     return { val: srImg_(a) };
      case 'druck':   return { val: srDruck_(a, b) };
      case 'druckholen': return { val: srDruckHolen_(a === '1') };
      case 'druckstatus': return { val: srDruckStatus_() };
    case 'setpin': {   // nur der Inhaber darf seinen eigenen PIN ändern; Mitarbeiter-PINs und Druck-Schlüssel bleiben
      if (!SR_ADMIN) return { err: 'NUR_INHABER' };
      var np = String(a || '').trim();
      if (np.length < 8 || np.length > 40 || !/[A-Za-z]/.test(np) || !/[0-9]/.test(np)) return { err: '8 أحرف على الأقل: حروف إنجليزية وأرقام' };
      if (srUsers_().some(function (x) { return x && srPinKey_(x.pin) === srPinKey_(np); })) return { err: 'هذا الرمز مستخدم لموظف' };
      PropertiesService.getScriptProperties().setProperty('SR_PIN', np);
      return { val: true };
    }
      case 'lg_info': return { val: lagerBestandVon(a, b, c) };
      case 'lg_ein':  { var e = JSON.parse(a); return { val: lagerWareneingang(e.code, e.tier, e.oil, e.menge, e.title, e.notiz) }; }
      case 'lg_inv':  { var v = JSON.parse(a); return { val: lagerInventur(v.code, v.tier, v.oil, v.ist, v.title) }; }
      case 'lg_min':  { var mm = JSON.parse(a); return { val: lagerMinSetzen(mm.code, mm.tier, mm.oil, mm.min) }; }
      case 'lg_low':  return { val: lagerNiedrig() };
      case 'lg_bew':  return { val: lagerBewegungen(a, b, c, 20) };
      case 'lg_aus':  { var x = JSON.parse(a); return { val: lagerAusgang(x.code, x.tier, x.oil, x.menge, x.title, x.notiz) }; }
      case 'lg_plan': return { val: lagerZaehlPlan() };
      case 'lg_zaehl': { var z = JSON.parse(a); return { val: lagerZaehlung(z.code, z.tier, z.oil, z.ist, z.title) }; }
      case 'lg_platz': { var pl = JSON.parse(a); return { val: lagerPlatzSetzen(pl.code, pl.tier, pl.oil, pl.platz, !!pl.force) }; }
      case 'lg_invstart': return { val: lagerInventurStart() };
      case 'lg_zreset': { var zr = JSON.parse(a); return { val: lagerZaehlReset(zr.code, zr.tier, zr.oil) }; }
      case 'lex_draft': return { val: lexEntwurf_(JSON.parse(a)) };
      case 'pl_absatz': return { val: plAbsatz_() };
      case 'pl_kunden': return { val: plKunden_() };
      case 'pl_mail': return { val: plMail_(JSON.parse(a)) };
      case 'pl_quota': return { val: plQuota_() };
      case 'pl_mail_bulk': return { val: plMailBulk_(JSON.parse(a)) };
      case 'pl_optout': return { val: plOptout_(JSON.parse(a)) };
      case 'pl_kontakt': return { val: plKontaktSetzen_(JSON.parse(a)) };
      case 'so_info': return { val: soInfo_() };
      case 'so_pw': return { val: soPwSetzen_(JSON.parse(a)) };
      case 'so_list': return { val: soListe_(JSON.parse(a)) };
      case 'so_set': return { val: soSetzen_(JSON.parse(a)) };
      case 'dhl_status': return { val: dhlStatus_(JSON.parse(a)) };
      case 'dhl_set': return { val: dhlSetzen_(JSON.parse(a)) };
      case 'dhl_test': return { val: dhlTest_(JSON.parse(a)) };
      case 'dhl_vor': return { val: dhlVor_(JSON.parse(a)) };
      case 'dhl_label': return { val: dhlLabel_(JSON.parse(a)) };
      case 'dhl_storno': return { val: dhlStorno_(JSON.parse(a)) };
      case 'dhl_druck': return { val: dhlDruck_(JSON.parse(a)) };
      case 'dhlx': return { val: dhlxApi_(JSON.parse(a)) };
      case 'so_storno': return { val: soStorno_(JSON.parse(a)) };
      case 'so_edit': return { val: soEdit_(JSON.parse(a)) };
      case 'so_suche': return { val: soSuche_(JSON.parse(a)) };
      case 'so_kunden': return { val: soKunden_(JSON.parse(a)) };
      case 'so_neu': return { val: soNeu_(JSON.parse(a)) };
      case 'chat_poll': return { val: chatPoll_(JSON.parse(a || '{}')) };
      case 'chat_send': return { val: chatSend_(JSON.parse(a)) };
      case 'chat_media': return { val: chatMedia_(JSON.parse(a)) };
      case 'chat_read': return { val: chatRead_(JSON.parse(a)) };
      case 'chat_users': return { val: chatUsers_() };
      case 'pl_setup': if (!SR_ADMIN) return { err: 'NUR_INHABER' }; return { val: plSetup() };
      case 'lot_list': return { val: chListe_() };
      case 'lot_add':  return { val: chHinzu_(JSON.parse(a)) };
      case 'lot_done': return { val: chLeer_(JSON.parse(a)) };
      case 'lot_scan': if (!SR_ADMIN) return { err: 'NUR_INHABER' }; return { val: chZertifikateScan() };
      case 'lot_setup': if (!SR_ADMIN) return { err: 'NUR_INHABER' }; return { val: chSetup() };
    }
    return { err: 'Unbekannte Aktion' };
  } catch (e) {
    return { err: String(e && e.message || e) };
  }
}

function lagerInventur(code, tier, oil, ist, title) {
  ist = Number(String(ist).replace(',', '.'));
  if (isNaN(ist) || ist < 0) throw new Error('Menge fehlt');
  var key = lagerKey_(code, tier, !!oil);
  if (!key) throw new Error('Code fehlt');
  /* Lesen + Buchen unter EINER Sperre (Fix 21.10.2026): ein gleichzeitiger Verkauf / Shopify-Abzug kann nicht
     dazwischenkommen – der gezählte Wert wird exakt übernommen. */
  var lock = LockService.getScriptLock(); lock.waitLock(30000); LAGER_LOCKED = true;
  try {
    var e = lagerBestandMap_().map[key], alt = e ? Number(e.data[6]) || 0 : 0;
    var diff = Math.round((ist - alt) * 1000) / 1000;
    if (Math.abs(diff) < 0.0005) {                    // Zählung bestätigt den Bestand: trotzdem protokollieren (für den Zählfortschritt)
      lagerSS_().getSheetByName('Bewegungen').appendRow([new Date(), 'Inventur', '', '', key, key.split('|')[0], oil ? lagerTierName_(key) : '', 0, alt, 'Inventur bestätigt', SR_USER || 'System']);
      return alt;
    }
    return lagerBuche_('Inventur', '', '', { code: code, tier: tier, oil: !!oil, title: title }, diff, 'Inventur (vorher ' + alt + ')');
  } finally { LAGER_LOCKED = false; lock.releaseLock(); }
}
var LAGER_LOCKED = false;   // true, solange lagerInventur die Sperre hält (lagerBuche_ sperrt dann nicht erneut)

function lagerBestandVon(code, tier, oil) {
  var key = lagerKey_(code, tier, !!oil), e = lagerBestandMap_().map[key], pl = lagerPlaetzeMap_().byKey[key];
  var r = e ? { bestand: Number(e.data[6]) || 0, min: Number(e.data[8]) || 0, status: e.data[9], unit: e.data[5], title: e.data[3] } : { bestand: 0, min: 0, status: 'LEER', unit: lagerEinheit_(!!oil, ''), title: '' };
  r.platz = pl ? pl.platz : '';
  return r;
}


/* =====================================================================
   Lagerplätze & Zählliste (Inventur nach Regal)
   Blatt "Lagerplätze": Platz | Key | Code | Qualität | Notiz | Geändert am
   Platz = Reihe+Regal-Ebene-Platz, z. B. A01-1-2  (Reihe A–D, Regal 01–99,
   Ebene 1–6 von unten, Platz 1–9 von links). Ein Code = ein fester Platz.
   Inventur-Runde: Start-Zeitpunkt in den Script-Properties (LAGER_INV_START);
   als „gezählt“ gilt jeder Code mit einer Inventur-Buchung seit diesem Start.
   ===================================================================== */
var LAGER_PLATZ_RX_ = /^[A-D]\d{2}-[1-6]-[1-9]$/;
var LAGER_PLATZ_KOPF_ = ['Platz', 'Key', 'Code', 'Qualität', 'Geändert von', 'Geändert am'];

function lagerPlaetzeBlatt_() {
  var ss = lagerSS_(), sh = ss.getSheetByName('Lagerplätze');
  if (!sh) {
    sh = ss.insertSheet('Lagerplätze');
    sh.getRange(1, 1, 1, LAGER_PLATZ_KOPF_.length).setValues([LAGER_PLATZ_KOPF_]).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.getRange('A:A').setNumberFormat('@');
  }
  return sh;
}
function lagerPlatzNorm_(p) {
  p = String(p || '').trim().toUpperCase().replace(/\s+/g, '').replace(/[–—_.\/]/g, '-');
  var m = p.match(/^([A-D])-?(\d{1,2})-(\d)-(\d)$/);
  return m ? m[1] + ('0' + m[2]).slice(-2) + '-' + m[3] + '-' + m[4] : p;
}
function lagerPlatzSort_(p) {                       // A01-1-2 -> "A0112" (Reihe, Regal, Ebene, Platz)
  var m = String(p || '').match(/^([A-D])(\d{2})-(\d)-(\d)$/);
  return m ? m[1] + m[2] + m[3] + m[4] : '~';
}
function lagerPlaetzeMap_() {
  var sh = lagerPlaetzeBlatt_(), last = sh.getLastRow(), byKey = {}, byPlatz = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, 6).getValues().forEach(function (r, i) {
    var platz = String(r[0] || '').trim(), key = String(r[1] || '').trim();
    if (key) byKey[key] = { row: i + 2, platz: platz };
    if (platz && key) byPlatz[platz] = key;
  });
  return { sheet: sh, byKey: byKey, byPlatz: byPlatz };
}

/** Platz setzen / ändern / entfernen (platz leer). force = belegten Platz übernehmen (der andere Code verliert den Platz). */
function lagerPlatzSetzen(code, tier, oil, platz, force) {
  var key = lagerKey_(code, tier, !!oil);
  if (!key) throw new Error('Code fehlt');
  platz = lagerPlatzNorm_(platz);
  if (platz && !LAGER_PLATZ_RX_.test(platz)) throw new Error('FORMAT');
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    var pm = lagerPlaetzeMap_(), sh = pm.sheet, jetzt = new Date();
    var belegt = platz ? pm.byPlatz[platz] : '';
    if (belegt && belegt !== key) {
      if (!force) throw new Error('BELEGT:' + belegt);
      var alt = pm.byKey[belegt];
      if (alt) { sh.getRange(alt.row, 1).setValue(''); sh.getRange(alt.row, 5, 1, 2).setValues([[SR_USER || '', jetzt]]); }
    }
    var e = pm.byKey[key];
    if (e) {
      sh.getRange(e.row, 1).setValue(platz);
      sh.getRange(e.row, 5, 1, 2).setValues([[SR_USER || '', jetzt]]);
    } else if (platz) {
      sh.appendRow([platz, key, key.split('|')[0], oil ? lagerTierName_(key) : '', SR_USER || '', jetzt]);
    }
    return platz;
  } finally { lock.releaseLock(); }
}

/** Neue Inventur-Runde starten: der Zählfortschritt beginnt wieder bei 0 (Bestände bleiben unverändert). */
function lagerInventurStart() {
  var t = new Date().toISOString();
  PropertiesService.getScriptProperties().setProperty('LAGER_INV_START', t);
  return new Date(t).getTime();
}

/** Zählliste für die App: Reihenfolge = Platz, sonst Nr. im Blatt "Liste" (B2B-Preisliste), sonst Bestandsreihenfolge.
    Codes aus der Liste, die noch nicht im Bestand stehen, erscheinen mit Bestand 0 (Zählung legt sie an). */
function lagerZaehlPlan() {
  var start = PropertiesService.getScriptProperties().getProperty('LAGER_INV_START') || '';
  var startMs = start ? new Date(start).getTime() : 0;
  var bm = lagerBestandMap_(), pm = lagerPlaetzeMap_(), gez = {}, liste = {}, listeRows = [];
  var lsh = lagerSS_().getSheetByName('Liste');
  var lvk = {}, vkN = function (x) { var n = Number(String(x).replace(',', '.')); return x === '' || x == null || isNaN(n) ? null : n; };
  if (lsh && lsh.getLastRow() >= 2) lsh.getRange(2, 1, lsh.getLastRow() - 1, Math.min(10, lsh.getLastColumn())).getValues().forEach(function (r) {
    var key = String(r[1] || '').trim(); if (!key) return;
    liste[key] = Number(r[0]) || 0; listeRows.push(r);
    if (r.length >= 10) lvk[key] = [vkN(r[6]), vkN(r[7]), vkN(r[8]), vkN(r[9])];   // VK 100 g / 250 g / 500 g / 1 kg (Blatt "Liste", Spalten G–J)
  });
  var bw = lagerSS_().getSheetByName('Bewegungen'), last = bw.getLastRow();
  if (startMs && last >= 2) bw.getRange(2, 1, last - 1, 9).getValues().forEach(function (r) {
    if (r[1] !== 'Inventur' && r[1] !== 'Inventur-Reset') return;
    var t = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
    if (t < startMs) return;
    if (r[1] === 'Inventur-Reset') delete gez[r[4]]; else gez[r[4]] = { at: t, menge: Number(r[8]) || 0, vorher: gez[r[4]] && gez[r[4]].vorher != null ? gez[r[4]].vorher : Math.round(((Number(r[8]) || 0) - (Number(r[7]) || 0)) * 1000) / 1000 };
  });
  var mk = function (key, code, tier, title, orig, unit, bestand, n) {
    var p = pm.byKey[key], g = gez[key];
    return { key: key, code: code, tier: tier, title: title, orig: orig, unit: unit, bestand: bestand, oil: unit === 'kg' ? 1 : 0,
             platz: p ? p.platz : '', nr: liste[key] || 0, n: n, gez: g ? g.at : 0, gezMenge: g ? g.menge : null, vorher: g ? g.vorher : null, vk: lvk[key] || null };
  };
  var items = [];
  bm.rows.forEach(function (r, i) {
    var key = String(r[0] || ''); if (!key) return;
    items.push(mk(key, String(r[1] || ''), String(r[2] || ''), String(r[3] || ''), String(r[4] || ''), String(r[5] || ''), Number(r[6]) || 0, i));
  });
  listeRows.forEach(function (r) {
    var key = String(r[1] || '').trim(); if (bm.map[key]) return;
    var tl = key.split('|')[1] || 'S';
    items.push(mk(key, key.split('|')[0], lagerTierName_(key), String(r[3] || ''), (String(r[2] || '') + ' ' + String(r[3] || '')).trim(), 'kg', 0, 100000 + (Number(r[0]) || 0)));
  });
  var ord = function (x) { return x.platz ? '0' + lagerPlatzSort_(x.platz) : x.nr ? '1' + ('00000' + x.nr).slice(-5) : '2' + ('000000' + x.n).slice(-6); };
  items.sort(function (a, b) { var sa = ord(a), sb = ord(b); return sa < sb ? -1 : sa > sb ? 1 : 0; });
  return { start: startMs, items: items };
}

/** Zählung eines Artikels in der laufenden Runde zurücksetzen: alle Inventur-Korrekturen dieser Runde werden
    rückgebucht (andere Bewegungen wie Verkäufe bleiben), der Artikel gilt wieder als „nicht gezählt“. */
function lagerZaehlReset(code, tier, oil) {
  var key = lagerKey_(code, tier, !!oil);
  if (!key) throw new Error('Code fehlt');
  var start = PropertiesService.getScriptProperties().getProperty('LAGER_INV_START') || '';
  var startMs = start ? new Date(start).getTime() : 0, summe = 0;
  var bw = lagerSS_().getSheetByName('Bewegungen'), last = bw.getLastRow();
  if (startMs && last >= 2) bw.getRange(2, 1, last - 1, 8).getValues().forEach(function (r) {
    if (r[4] !== key) return;
    var t = r[0] instanceof Date ? r[0].getTime() : new Date(r[0]).getTime();
    if (t < startMs) return;
    if (r[1] === 'Inventur-Reset') summe = 0; else if (r[1] === 'Inventur') summe += Number(r[7]) || 0;
  });
  summe = Math.round(summe * 1000) / 1000;
  if (Math.abs(summe) >= 0.0005) return lagerBuche_('Inventur-Reset', '', '', { code: code, tier: tier, oil: !!oil }, -summe, 'Zählung zurückgesetzt');
  var e = lagerBestandMap_().map[key], best = e ? Number(e.data[6]) || 0 : 0;
  bw.appendRow([new Date(), 'Inventur-Reset', '', '', key, key.split('|')[0], oil ? lagerTierName_(key) : '', 0, best, 'Zählung zurückgesetzt', SR_USER || 'System']);
  return best;
}

/** Zählung aus der Zählliste: setzt den Bestand per Inventur und gibt den neuen Bestand zurück. */
function lagerZaehlung(code, tier, oil, ist, title) {
  return lagerInventur(code, tier, !!oil, ist, title);
}


/* =====================================================================
   Mitarbeiter-Zugänge & Protokoll
   Haupt-PIN (SR_PIN) = Inhaber (Admin). Jeder Mitarbeiter hat einen eigenen
   PIN (Script-Property SR_USERS = [{name, pin, on}]). Jede Lagerbuchung
   speichert den Benutzer in Spalte K ("Benutzer") des Blatts "Bewegungen".
   ===================================================================== */
var SR_USER = '', SR_ADMIN = false;
function srDigits_(p) {
  return String(p || '').replace(/[٠-٩]/g, function (c) { return c.charCodeAt(0) - 0x660; })
    .replace(/[۰-۹]/g, function (c) { return c.charCodeAt(0) - 0x6F0; }).replace(/[^0-9]/g, '');
}
function srUsers_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('SR_USERS') || '[]') || []; } catch (e) { return []; }
}
var SR_DRUCK = false, SR_OWNER = false, SR_PERMS = null;   // SR_PERMS null = alles erlaubt
var SR_RECHTE = ['new', 'wh', 'off', 'cust', 'lg', 'inv', 'shop', 'cash', 'acc'];
var SR_RECHTE_ALT = ['new', 'wh', 'off', 'cust', 'lg', 'inv', 'shop', 'cash'];   // Mitarbeiter ohne gespeicherte Rechte (wie bisher)
function srPinKey_(p) { var s = String(p || '').trim(); return (s && srDigits_(s).length === s.replace(/\s/g, '').length) ? 'd:' + srDigits_(s) : 't:' + s; }
function srNeed_(action, a) {
  if (action === 'users_get' || action === 'users_set' || action === 'setpin') return 'owner';
  if (action === 'dev_list' || action === 'dev_set' || action === 'log_get') return 'owner';
  if (/^(so_|dhl)/.test(action)) return 'shop';
  if (/^(lex_|pl_)/.test(action)) return 'acc';
  if (/^lg_(inv|invstart|zaehl|platz|plan|zreset)$/.test(action)) return 'inv';
  if (/^lg_/.test(action)) return 'lg';
  if ((action === 'list' || action === 'add' || action === 'update' || action === 'del') && a === 'cash') return 'cash';
  return '';
}
function srCan_(p) { if (p === 'owner') return SR_OWNER; return SR_PERMS === null || SR_PERMS.indexOf(p) >= 0; }
/* Einmal im Editor ausführen: legt den festen Schlüssel für den Druck-PC an (unabhängig von allen PINs) und zeigt ihn im Protokoll. */
function druckSchluesselEinrichten() {
  var p = PropertiesService.getScriptProperties(), k = p.getProperty('SR_DRUCK_KEY');
  if (!k) { k = 'fhdruck-' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8); p.setProperty('SR_DRUCK_KEY', k); }
  Logger.log('Druck-Schlüssel: ' + k);
  return k;
}
function srPin_(pin, dev) {
  SR_DRUCK = false; SR_OWNER = false; SR_PERMS = null; SR_DEV_ID = ''; SR_DEV_N = String((dev && dev.n) || '').slice(0, 120);
  var dk = PropertiesService.getScriptProperties().getProperty('SR_DRUCK_KEY');
  if (dk && String(pin || '') === dk) { SR_USER = 'Druck-PC'; SR_ADMIN = false; SR_DRUCK = true; SR_PERMS = []; return; }
  var cache = CacheService.getScriptCache();
  var fehl = Number(cache.get('SR_FAIL') || 0);
  if (fehl >= 10) throw new Error('Zu viele falsche Versuche. Bitte 10 Minuten warten.');
  var soll = PropertiesService.getScriptProperties().getProperty('SR_PIN');
  if (!soll) throw new Error('Kein Zugangscode gesetzt – zuerst srEinrichten() ausführen.');
  var roh = String(pin || '').trim(), sollS = String(soll).trim(), ein = srDigits_(pin);
  /* Inhaber: Passwort mit Buchstaben exakt vergleichen; reiner Ziffern-PIN wie bisher (auch arabische Ziffern) */
  var nurZiffern = srDigits_(sollS).length === sollS.replace(/\s/g, '').length;
  if (roh && (nurZiffern ? (ein && ein === srDigits_(sollS)) : roh === sollS)) { SR_USER = 'Inhaber'; SR_ADMIN = true; SR_OWNER = true; SR_PERMS = null; srDevCheck_(dev); return; }
  var key = srPinKey_(roh);
  var u = srUsers_().filter(function (x) { return x && x.on !== false && roh && srPinKey_(x.pin) === key; })[0];
  if (u) {
    SR_USER = String(u.name); SR_ADMIN = !!u.full;
    SR_PERMS = u.full ? null : (Array.isArray(u.perms) ? u.perms : SR_RECHTE_ALT.slice());
    srDevCheck_(dev);
    return;
  }
  /* leere Anfragen (z. B. Gerät ohne Anmeldung) zählen nicht als Rateversuch */
  if (!roh) throw new Error('PIN');
  /* dasselbe falsche Passwort (z. B. altes Gerät mit altem Passwort) zählt nur einmal – nur echte Rateversuche sperren */
  var fk = 'SR_F_' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, roh)).slice(0, 24);
  if (cache.get(fk)) throw new Error('PIN');
  cache.put(fk, '1', 600);
  srLog_('', SR_DEV_N, 'كلمة سر خاطئة', '');
  cache.put('SR_FAIL', String(fehl + 1), 600);
  throw new Error('PIN');
}
function srUsersSet_(list) {
  if (!SR_OWNER) throw new Error('NUR_INHABER');
  var haupt = srPinKey_(PropertiesService.getScriptProperties().getProperty('SR_PIN')), seen = {}, out = [];
  (list || []).forEach(function (x) {
    var name = String(x && x.name || '').trim(), pin = String(x && x.pin || '').trim();
    if (!name && !pin) return;
    if (!name) throw new Error('Name fehlt');
    var nur = srDigits_(pin).length === pin.replace(/\s/g, '').length;
    if (nur) { pin = srDigits_(pin); if (pin.length < 4 || pin.length > 8) throw new Error('PIN von ' + name + ': 4–8 Ziffern oder Passwort (mind. 6 Zeichen, Buchstaben + Ziffern)'); }
    else if (pin.length < 6 || pin.length > 40 || !/[A-Za-z]/.test(pin) || !/[0-9]/.test(pin)) throw new Error('Passwort von ' + name + ': mind. 6 Zeichen, Buchstaben + Ziffern');
    var k = srPinKey_(pin);
    if (k === haupt || seen[k]) throw new Error('PIN/Passwort von ' + name + ' ist schon vergeben');
    seen[k] = 1;
    var perms = Array.isArray(x.perms) ? x.perms.filter(function (p) { return SR_RECHTE.indexOf(p) >= 0; }) : SR_RECHTE_ALT.slice();
    out.push({ name: name, pin: pin, on: x.on !== false, full: !!x.full, perms: perms });
  });
  PropertiesService.getScriptProperties().setProperty('SR_USERS', JSON.stringify(out));
  return out;
}

/* Zentrale Buchung – wie in Lager.gs, zusätzlich mit Benutzer (Spalte K). */
function lagerBuche_(quelle, referenz, kunde, item, qty, notiz) {
  var key = lagerKey_(item.code, item.tier, item.oil);
  if (!key || !qty) return null;
  var own = !LAGER_LOCKED, lock = own ? LockService.getScriptLock() : null; if (own) lock.waitLock(30000);
  try {
    var bm = lagerBestandMap_(), unit = lagerEinheit_(item.oil, item.title), tierName = item.oil ? lagerTierName_(key) : '';
    var e = bm.map[key], row, bestand = 0, min;
    if (!e) {
      min = lagerMinFuer_(unit, tierName);
      row = bm.sheet.getLastRow() + 1;
      bm.sheet.getRange(row, 1, 1, 10).setValues([[key, key.split('|')[0], tierName, item.title || '', item.orig || '', unit, 0, 0, min, 'LEER']]);
    } else {
      row = e.row; bestand = Number(e.data[6]) || 0; min = Number(e.data[8]) || 0;
      if (item.title && !e.data[3]) bm.sheet.getRange(row, 4).setValue(item.title);
    }
    var neu = Math.round((bestand + qty) * 1000) / 1000;
    bm.sheet.getRange(row, 7).setValue(neu);
    bm.sheet.getRange(row, 10).setValue(lagerStatus_(neu, min));
    lagerSS_().getSheetByName('Bewegungen').appendRow([new Date(), quelle, referenz || '', kunde || '', key, key.split('|')[0], tierName, qty, neu, notiz || '', SR_USER || 'System']);
    if (qty < 0 && bestand >= min && neu < min && String(lagerEinstellung_('Alarm bei Unterschreitung', 'JA')).toUpperCase() === 'JA')
      lagerAlarm_(key, item.title || (e && e.data[3]) || '', tierName, neu, min, unit);
    return neu;
  } finally { if (own) lock.releaseLock(); }
}

/* Bewegungen mit Benutzer (für die App) */
function lagerBewegungen(code, tier, oil, n) {
  var key = lagerKey_(code, tier, !!oil), sh = lagerSS_().getSheetByName('Bewegungen'), last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, 11).getValues().filter(function (r) { return r[4] === key; });
  return rows.slice(-(n || 20)).reverse().map(function (r) { return { at: r[0] instanceof Date ? r[0].getTime() : r[0], quelle: r[1], ref: r[2], kunde: r[3], menge: r[7], danach: r[8], notiz: r[9], user: r[10] || '' }; });
}

/* Inventurbericht (Stichtag = jetzt): alle Bestandszeilen mit Platz und EK (Blatt "Liste", Spalte F = EK netto €/kg). */
function lagerBericht() {
  var plan = lagerZaehlPlan(), ek = {};
  var lsh = lagerSS_().getSheetByName('Liste');
  if (lsh && lsh.getLastRow() >= 2 && lsh.getLastColumn() >= 6) lsh.getRange(2, 1, lsh.getLastRow() - 1, 6).getValues().forEach(function (r) {
    var k = String(r[1] || '').trim(), v = Number(String(r[5]).replace(',', '.'));
    if (k && !isNaN(v) && r[5] !== '') ek[k] = v;
  });
  return { at: Date.now(), user: SR_USER, items: plan.items.map(function (x) {
    return { platz: x.platz, key: x.key, code: x.code, tier: x.tier, title: x.title, orig: x.orig, unit: x.unit, bestand: x.bestand, oil: x.oil, ek: ek[x.key] != null ? ek[x.key] : null };
  }) };
}


/* Unter Mindestbestand – zusätzlich Originalname (Bestand Sp. E, sonst Blatt "Liste") und 7-stelliger Werks-/Zertifikatscode. */
function lagerNiedrig() {
  var codes = null, ersatz = null, liste = {};
  try { codes = (typeof loadCodeMap === 'function') ? loadCodeMap() : null; } catch (e) { codes = null; }
  if (!codes) { try { ersatz = srFabrikCodes_(); } catch (e) { ersatz = {}; } }
  var lsh = lagerSS_().getSheetByName('Liste');
  if (lsh && lsh.getLastRow() >= 2) lsh.getRange(2, 1, lsh.getLastRow() - 1, 4).getValues().forEach(function (r) {
    var k = String(r[1] || '').trim(); if (k) liste[k] = (String(r[2] || '') + ' ' + String(r[3] || '')).trim();
  });
  return lagerBestandMap_().rows.filter(function (r) { return r[9] === 'NIEDRIG' || r[9] === 'LEER'; })
    .map(function (r) {
      var oil = r[5] === 'kg', werk = '';
      if (oil) { try { werk = srFabrik_(codes, ersatz, r[1]); } catch (e) { werk = ''; } }
      return { code: r[1], tier: r[2], title: r[3], orig: String(r[4] || '') || liste[String(r[0])] || '', werk: werk,
               bestand: r[6], min: r[8], unit: r[5], status: r[9] };
    });
}




/* Im Editor ausführen, wenn die App wegen Fehlversuchen gesperrt ist */
function sperreAufheben() { CacheService.getScriptCache().remove('SR_FAIL'); Logger.log('Sperre aufgehoben'); }

/* ===================== Geräte-Freigabe + Anmelde-Protokoll ===================== */
var SR_DEV_ID = '', SR_DEV_N = '';
function srDevs_() {
  var c = CacheService.getScriptCache(), s = c.get('SR_DEVICES_C');
  if (!s) { s = PropertiesService.getScriptProperties().getProperty('SR_DEVICES') || '{}'; c.put('SR_DEVICES_C', s, 21600); }
  try { return JSON.parse(s) || {}; } catch (e) { return {}; }
}
function srDevsSave_(m) {
  var s = JSON.stringify(m);
  PropertiesService.getScriptProperties().setProperty('SR_DEVICES', s);
  CacheService.getScriptCache().put('SR_DEVICES_C', s, 21600);
}
function srLog_(user, dev, ev, info) {
  try {
    var ss = srBlatt_('lists').getParent(), sh = ss.getSheetByName('Anmeldungen') || ss.insertSheet('Anmeldungen');
    if (sh.getLastRow() === 0) sh.appendRow(['Zeit', 'Benutzer', 'Gerät', 'Ereignis', 'Info']);
    sh.appendRow([new Date(), user || '', dev || '', ev, info || '']);
  } catch (e) {}
}
/* Mitarbeiter-Geräte brauchen die Freigabe des Inhabers. Inhaber-Geräte werden automatisch freigegeben (und protokolliert).
   Übergang: in den ersten 24 h nach Einführung werden bestehende Geräte automatisch freigegeben. */
function srDevCheck_(dev) {
  dev = dev || {};
  var id = String(dev.id || '').slice(0, 64), name = SR_DEV_N, p = PropertiesService.getScriptProperties();
  var bis = Number(p.getProperty('SR_DEV_GRACE') || 0);
  if (!bis) { bis = Date.now() + 24 * 3600 * 1000; p.setProperty('SR_DEV_GRACE', String(bis)); }
  var grace = Date.now() < bis;
  if (!id) { if (grace || SR_OWNER) return; throw new Error('GERAET_WARTET'); }
  SR_DEV_ID = id;
  var m = srDevs_(), d = m[id], now = Date.now();
  if (!d) {
    d = { user: SR_USER, n: name, st: (SR_OWNER || grace) ? 'ok' : 'wait', first: now, last: now };
    m[id] = d; srDevsSave_(m);
    srLog_(SR_USER, name, d.st === 'ok' ? 'جهاز جديد – معتمد تلقائياً' : 'جهاز جديد – بانتظار الموافقة', '');
  }
  if (d.st === 'block') throw new Error('GERAET_GESPERRT');
  if (d.st !== 'ok') {
    if (SR_OWNER) { d.st = 'ok'; m[id] = d; srDevsSave_(m); }
    else throw new Error('GERAET_WARTET');
  }
  if (now - (d.last || 0) > 30 * 60 * 1000 || d.user !== SR_USER) { d.last = now; d.user = SR_USER; if (name) d.n = name; m[id] = d; srDevsSave_(m); }
}
function srDevWait_() {
  var m = srDevs_(), out = [];
  Object.keys(m).forEach(function (k) { var d = m[k]; if (d && d.st === 'wait') out.push({ id: k, user: d.user, n: d.n, first: d.first }); });
  return out;
}
function srDevList_() {
  var m = srDevs_(), out = [];
  Object.keys(m).forEach(function (k) { var d = m[k] || {}; out.push({ id: k, user: d.user, n: d.n, st: d.st, first: d.first, last: d.last, me: k === SR_DEV_ID }); });
  out.sort(function (x, y) { return (y.last || 0) - (x.last || 0); });
  return out;
}
function srDevSet_(o) {
  var m = srDevs_(), id = String(o && o.id || ''), st = String(o && o.st || '');
  if (!m[id]) throw new Error('Gerät nicht gefunden');
  if (id === SR_DEV_ID && st !== 'ok') throw new Error('لا يمكنك إيقاف جهازك الحالي');
  var d = m[id];
  if (st === 'del') delete m[id]; else if (st === 'ok' || st === 'block') d.st = st; else throw new Error('Ungültig');
  srDevsSave_(m);
  srLog_('Inhaber', (d.n || '') + ' (' + (d.user || '') + ')', st === 'ok' ? 'تمت الموافقة على جهاز' : st === 'block' ? 'تم إيقاف جهاز' : 'تم حذف جهاز', '');
  return srDevList_();
}
function srLogGet_() {
  try {
    var sh = srBlatt_('lists').getParent().getSheetByName('Anmeldungen'); if (!sh) return [];
    var n = sh.getLastRow(); if (n < 2) return [];
    var from = Math.max(2, n - 299), rows = sh.getRange(from, 1, n - from + 1, 5).getValues();
    return rows.reverse().map(function (r) { return { t: r[0] instanceof Date ? r[0].getTime() : r[0], u: r[1], d: r[2], e: r[3], i: r[4] }; });
  } catch (e) { return []; }
}
