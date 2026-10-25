/* =====================================================================
   Planung.gs – Absatzdaten aus Shopify für
     (1) Bestellvorschlag an das Werk (Verbrauch je Öl + Qualität)
     (2) Kundenprofile & Reaktivierung (letzte Bestellung, Rhythmus, Umsatz)
   Blatt "Auftragsdaten" in der Lager-Tabelle: eine Zeile je Shopify-Bestellung (12 Monate),
   stündlich nachgeführt (plSync). Erstbefüllung läuft automatisch in mehreren Schritten.
   Blatt "Kunden-Shop": alle Shop-Kunden mit Bestellungen (täglich, auch ältere Bestellungen).
   App-Aktionen (über srApi in Lagerplaetze.gs): pl_absatz, pl_kunden, pl_setup – nur Inhaber.
   ===================================================================== */

var PL_BLATT = 'Auftragsdaten';
var PL_KOPF = ['ID', 'Nr', 'Datum', 'Gültig', 'Kunde-ID', 'Name', 'Firma', 'E-Mail', 'Telefon', 'Land', 'Netto', 'Öle (Key=kg)', 'Artikel'];
var PL_TAGE = 400;                    // so weit zurück wird beim ersten Mal geladen
var PL_SEK = 300;                     // Laufzeitgrenze je Lauf

function plBlatt_() {
  var ss = lagerSS_(), sh = ss.getSheetByName(PL_BLATT);
  if (sh) return sh;
  sh = ss.insertSheet(PL_BLATT);
  sh.getRange(1, 1, 1, PL_KOPF.length).setValues([PL_KOPF]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A:J').setNumberFormat('@');
  return sh;
}

/** Shopify-Bestellung → Tabellenzeile */
function plZeile_(o) {
  var ok = !o.test && !o.cancelledAt && ['VOIDED', 'REFUNDED', 'EXPIRED'].indexOf(o.displayFinancialStatus) < 0;
  var b = o.billingAddress || {}, s = o.shippingAddress || {}, c = o.customer || {};
  var name = (c.displayName || ((b.firstName || '') + ' ' + (b.lastName || '')).trim() || c.email || '').trim();
  var oele = {}, artikel = [];
  ((o.lineItems && o.lineItems.nodes) || []).forEach(function (li) {
    var q = Number(li.currentQuantity) || 0;
    if (!q) return;
    var p = lagerParseSku_(li.sku, li.title, li.variantTitle);
    if (p && p.item.oil) {
      var k = lagerKey_(p.item.code, p.item.tier, true);
      oele[k] = Math.round(((oele[k] || 0) + q * p.menge) * 1000) / 1000;
    }
    artikel.push(String(li.title || '').replace(/[|;]/g, ' ').slice(0, 60) + (li.variantTitle ? ' · ' + String(li.variantTitle).replace(/[|;]/g, ' ').slice(0, 40) : '') + '×' + q);
  });
  return [String(o.id).split('/').pop(), o.name || '', o.createdAt, ok ? 'ja' : 'nein', c.id ? String(c.id).split('/').pop() : '',
          name, String(b.company || '').trim(), String(c.email || '').trim(), String(c.phone || b.phone || s.phone || '').trim(),
          b.countryCodeV2 || '', Number((o.currentSubtotalPriceSet && o.currentSubtotalPriceSet.shopMoney.amount) || 0),
          Object.keys(oele).map(function (k) { return k + '=' + oele[k]; }).join(';'), artikel.join('|').slice(0, 2000)];
}

/** stündlich: neue/geänderte Bestellungen übernehmen (setzt nach Zeitlimit beim nächsten Lauf fort) */
function plSync() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return { busy: true };
  try {
    var start = Date.now(), props = PropertiesService.getScriptProperties();
    var ab = props.getProperty('PL_AB') || new Date(start - PL_TAGE * 864e5).toISOString();
    var cursor = props.getProperty('PL_CURSOR') || null, laufAb = props.getProperty('PL_LAUF_AB') || new Date(start - 120e3).toISOString();
    var sh = plBlatt_(), n = sh.getLastRow(), rows = n >= 2 ? sh.getRange(2, 1, n - 1, PL_KOPF.length).getValues() : [], idx = {};
    rows.forEach(function (r, i) { idx[String(r[0])] = i; });
    var q = 'updated_at:>=' + "'" + ab + "'";
    var felder = 'id name createdAt cancelledAt displayFinancialStatus test currentSubtotalPriceSet { shopMoney { amount } } ' +
                 'customer { id displayName email phone } billingAddress { company firstName lastName phone countryCodeV2 } shippingAddress { phone } ' +
                 'lineItems(first: 40) { nodes { sku title variantTitle currentQuantity } }';
    var fertig = false, neu = 0, geaendert = 0;
    while (true) {
      if ((Date.now() - start) / 1000 > PL_SEK) break;
      var d = shopifyGraphQL('query($q: String!, $c: String) { orders(first: 12, after: $c, query: $q, sortKey: UPDATED_AT) { pageInfo { hasNextPage endCursor } nodes { ' + felder + ' } } }', { q: q, c: cursor });
      d.orders.nodes.forEach(function (o) {
        var z = plZeile_(o), i = idx[z[0]];
        if (i == null) { idx[z[0]] = rows.length; rows.push(z); neu++; } else { rows[i] = z; geaendert++; }
      });
      cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
      if (!cursor) { fertig = true; break; }
    }
    rows.sort(function (a, b) { return String(a[2]) < String(b[2]) ? -1 : String(a[2]) > String(b[2]) ? 1 : 0; });
    var grenze = new Date(start - PL_TAGE * 864e5).toISOString();
    rows = rows.filter(function (r) { return String(r[2]) >= grenze; });
    if (rows.length) sh.getRange(2, 1, rows.length, PL_KOPF.length).setValues(rows);
    if (sh.getLastRow() > rows.length + 1) sh.getRange(rows.length + 2, 1, sh.getLastRow() - rows.length - 1, PL_KOPF.length).clearContent();
    if (fertig) {
      props.setProperty('PL_AB', laufAb);
      props.deleteProperty('PL_CURSOR'); props.deleteProperty('PL_LAUF_AB');
      props.setProperty('PL_STAND', String(Date.now()));
    } else {
      props.setProperty('PL_CURSOR', cursor); props.setProperty('PL_LAUF_AB', laufAb);
      if (!props.getProperty('PL_AB')) props.setProperty('PL_AB', ab);
    }
    CacheService.getScriptCache().remove('PL_KUNDEN');
    var kd = null;
    if (fertig && props.getProperty('PL_KD_TAG') !== Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd')) {
      try { kd = plKundenSync_(); } catch (e) { Logger.log('Kunden-Sync: ' + e.message); }
    }
    return { fertig: fertig, neu: neu, geaendert: geaendert, zeilen: rows.length, kunden: kd };
  } finally { lock.releaseLock(); }
}

/** täglich: alle Shop-Kunden mit Bestellungen (Anzahl, Umsatz, erste/letzte Bestellung – auch älter als 60 Tage) */
var PL_KD_BLATT = 'Kunden-Shop';
var PL_KD_KOPF = ['Kunde-ID', 'Name', 'Firma', 'E-Mail', 'Telefon', 'Land', 'Bestellungen', 'Umsatz gesamt', 'Kunde seit', 'Letzte Bestellung'];
function plKundenSync_() {
  var ss = lagerSS_(), sh = ss.getSheetByName(PL_KD_BLATT);
  if (!sh) { sh = ss.insertSheet(PL_KD_BLATT); sh.getRange(1, 1, 1, PL_KD_KOPF.length).setValues([PL_KD_KOPF]).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('A:F').setNumberFormat('@'); sh.getRange('I:J').setNumberFormat('@'); }
  var rows = [], cursor = null;
  do {
    var d = shopifyGraphQL('query($c: String) { customers(first: 100, after: $c, query: "orders_count:>0") { pageInfo { hasNextPage endCursor } nodes { ' +
      'id displayName email phone createdAt numberOfOrders amountSpent { amount } lastOrder { createdAt } defaultAddress { company phone countryCodeV2 } } } }', { c: cursor });
    d.customers.nodes.forEach(function (k) {
      var a = k.defaultAddress || {};
      rows.push([String(k.id).split('/').pop(), k.displayName || k.email || '', String(a.company || '').trim(), k.email || '', String(k.phone || a.phone || '').trim(),
                 a.countryCodeV2 || '', Number(k.numberOfOrders) || 0, Number(k.amountSpent && k.amountSpent.amount) || 0, k.createdAt || '', (k.lastOrder && k.lastOrder.createdAt) || '']);
    });
    cursor = d.customers.pageInfo.hasNextPage ? d.customers.pageInfo.endCursor : null;
  } while (cursor);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, PL_KD_KOPF.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, PL_KD_KOPF.length).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('PL_KD_TAG', Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd'));
  CacheService.getScriptCache().remove('PL_KUNDEN');
  return rows.length;
}

function plZeilen_() {
  var sh = plBlatt_(), n = sh.getLastRow();
  return n >= 2 ? sh.getRange(2, 1, n - 1, PL_KOPF.length).getValues() : [];
}
function plStand_() {
  var p = PropertiesService.getScriptProperties();
  return { stand: Number(p.getProperty('PL_STAND')) || 0, laeuft: !!p.getProperty('PL_CURSOR') };
}

/** Öl-Verbrauch aus dem Shop: kg je Key in den letzten 30 / 90 Tagen */
function plAbsatz_() {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var jetzt = Date.now(), g30 = new Date(jetzt - 30 * 864e5).toISOString(), g90 = new Date(jetzt - 90 * 864e5).toISOString();
  var k30 = {}, k90 = {}, n90 = {}, von = '';
  plZeilen_().forEach(function (r) {
    if (r[11] && (!von || String(r[2]) < von)) von = String(r[2]);
    if (r[3] !== 'ja' || String(r[2]) < g90 || !r[11]) return;
    var d = String(r[2]);
    String(r[11]).split(';').forEach(function (p) {
      var i = p.lastIndexOf('='); if (i < 1) return;
      var k = p.slice(0, i), v = Number(p.slice(i + 1)) || 0;
      k90[k] = (k90[k] || 0) + v; n90[k] = (n90[k] || 0) + 1;
      if (d >= g30) k30[k] = (k30[k] || 0) + v;
    });
  });
  var r3 = function (o) { Object.keys(o).forEach(function (k) { o[k] = Math.round(o[k] * 1000) / 1000; }); return o; };
  var min = {};
  lagerBestandMap_().rows.forEach(function (r) { if (r[0] && r[5] === 'kg') min[String(r[0])] = Number(r[8]) || 0; });
  var tage = von ? Math.max(1, Math.min(90, Math.round((jetzt - new Date(von).getTime()) / 864e5))) : 90;
  return { at: jetzt, kg30: r3(k30), kg90: r3(k90), n90: n90, min: min, tage: tage, stand: plStand_() };
}

/** Kundenprofile aus dem Shop: Anzahl/Umsatz/erste+letzte Bestellung aus "Kunden-Shop" (gesamt), Top-Artikel aus den Auftragsdaten */
function plKunden_() {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var cache = CacheService.getScriptCache(), c = cache.get('PL_KUNDEN');
  if (c) return c;
  var sh = lagerSS_().getSheetByName(PL_KD_BLATT);
  if (!sh || sh.getLastRow() < 2) { plKundenSync_(); sh = lagerSS_().getSheetByName(PL_KD_BLATT); }
  var top = {};
  plZeilen_().forEach(function (r) {
    if (r[3] !== 'ja' || !r[4]) return;
    var a = top[r[4]] = top[r[4]] || {};
    String(r[12] || '').split('|').forEach(function (x) { var t = x.replace(/\u00d7\d+$/, '').trim(); if (t) a[t] = (a[t] || 0) + 1; });
  });
  var out = sh.getRange(2, 1, sh.getLastRow() - 1, PL_KD_KOPF.length).getValues().filter(function (r) { return r[0] && Number(r[6]) > 0; }).map(function (r) {
    var a = top[String(r[0])] || {};
    return { id: String(r[0]), n: String(r[1]), f: String(r[2]), e: String(r[3]), p: String(r[4]), c: String(r[5]), o: Number(r[6]) || 0,
             u: Math.round((Number(r[7]) || 0) * 100) / 100, a: String(r[8]).slice(0, 10), l: String(r[9]).slice(0, 10),
             t: Object.keys(a).sort(function (x, y) { return a[y] - a[x]; }).slice(0, 3) };
  });
  var antw = []; try { antw = plAntworten_(); } catch (e) {}
  var s = JSON.stringify({ at: Date.now(), stand: plStand_(), k: out, kontakt: plKontakte_(), abmeld: plAbmeldungen_(), antw: antw });
  try { cache.put('PL_KUNDEN', s, 1800); } catch (e) {}   // > 100 KB: ohne Cache
  return s;
}

/** Trigger anlegen (stündlich) und ersten Lauf starten */
function plSetup() {
  plBlatt_();
  var da = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'plSync'; });
  if (!da) ScriptApp.newTrigger('plSync').timeBased().everyHours(1).create();
  return plSync();
}


/* ---------- Kontakt-Protokoll & Abmeldungen (für alle Geräte gleich) ---------- */
var PL_KONTAKT = 'Kunden-Kontakte', PL_ABMELD = 'Kunden-Abmeldungen';
function plLogBlatt_(name, kopf) {
  var ss = lagerSS_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('A:Z').setNumberFormat('@'); }
  return sh;
}
function plKontaktLog_(rows) {   // rows: [[E-Mail, Name, Betreff, Art]]
  if (!rows.length) return;
  var sh = plLogBlatt_(PL_KONTAKT, ['Datum', 'E-Mail', 'Name', 'Betreff', 'Art', 'Von']), t = new Date().toISOString();
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, 6).setValues(rows.map(function (r) { return [t, String(r[0]).toLowerCase(), r[1] || '', r[2] || '', r[3] || '', SR_USER || '']; }));
  CacheService.getScriptCache().remove('PL_KUNDEN');
}
function plKontakte_() {   // E-Mail → letzter Kontakt (ms), letzte 90 Tage
  var sh = lagerSS_().getSheetByName(PL_KONTAKT), m = {}, g = Date.now() - 90 * 864e5;
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var t = new Date(r[0]).getTime(), e = String(r[1]).toLowerCase(); if (e && t > g && (!m[e] || t > m[e])) m[e] = t; });
  return m;
}
function plAbmeldungen_() {
  var sh = lagerSS_().getSheetByName(PL_ABMELD), m = {};
  if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(function (r) { var e = String(r[1]).toLowerCase(); if (e) m[e] = 1; });
  return m;
}
/** Abmeldung setzen/aufheben: o = {e, name, on} */
function plOptout_(o) {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var e = String(o && o.e || '').trim().toLowerCase(); if (!e) throw new Error('E-Mail fehlt');
  var sh = plLogBlatt_(PL_ABMELD, ['Datum', 'E-Mail', 'Name', 'Von']), n = sh.getLastRow();
  if (n > 1) { var v = sh.getRange(2, 2, n - 1, 1).getValues(); for (var i = v.length - 1; i >= 0; i--) if (String(v[i][0]).toLowerCase() === e) sh.deleteRow(i + 2); }
  if (o.on) sh.appendRow([new Date().toISOString(), e, o.name || '', SR_USER || '']);
  CacheService.getScriptCache().remove('PL_KUNDEN');
  return true;
}
/** „Tel./WhatsApp kontaktiert“ oder manuell „✓ تم التواصل“ ebenfalls protokollieren */
function plKontaktSetzen_(o) { if (!SR_ADMIN) throw new Error('NUR_INHABER'); plKontaktLog_([[o.e || o.k || '', o.name || '', '', o.art || 'manuell']]); return true; }

/** HTML-Fassung der Kunden-E-Mail (Firmenkopf, klickbare Links) */
function plHtml_(text) {
  var esc = function (s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var html = esc(String(text || ''))
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#9a7b2f">$1</a>')
    .replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1" style="color:#9a7b2f">$1</a>')
    .replace(/\n/g, '<br>');
  return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1a1714;max-width:620px">' +
         '<div style="border-bottom:2px solid #b8975a;padding:0 0 10px;margin:0 0 18px;font-family:Georgia,serif;letter-spacing:2px;color:#9a7b2f;font-size:18px">FRAGRANCE HUB <span style="font-size:11px;letter-spacing:4px">GERMANY</span></div>' +
         html + '</div>';
}
function plVon_() {
  var von = fhAbsender_();
  if (!von) throw new Error('ABSENDER_FEHLT: info@fragranceshub.de ist in Gmail nicht als „Senden als“-Adresse eingerichtet');
  return von;
}
var PL_MAIL_RX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** E-Mail an einen Kunden – immer vom offiziellen Firmen-Absender info@fragranceshub.de (Gmail „Senden als“). */
function plMail_(o) {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var to = String(o && o.to || '').trim();
  if (!PL_MAIL_RX.test(to)) throw new Error('E-Mail-Adresse ungültig');
  var von = plVon_(), text = String(o.b || '');
  GmailApp.sendEmail(to, String(o.s || 'Fragrance Hub Germany').slice(0, 200), text,
    { from: von, name: 'Fragrance Hub Germany', replyTo: 'info@fragranceshub.de', htmlBody: plHtml_(text) });
  plKontaktLog_([[to, o.name || '', o.s || '', 'E-Mail']]);
  return { ok: true, von: von };
}

/** Tageskontingent für E-Mails (Gmail-Grenze) */
function plQuota_() { if (!SR_ADMIN) throw new Error('NUR_INHABER'); return { frei: MailApp.getRemainingDailyQuota(), von: fhAbsender_() || '' }; }

/** Sammelversand: liste = [{k, to, s, b}] – jede E-Mail einzeln (persönlich), stoppt beim Tageskontingent */
function plMailBulk_(liste) {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var von = plVon_(), ok = [], fehler = [], frei = MailApp.getRemainingDailyQuota(), abm = plAbmeldungen_(), log = [];
  (liste || []).slice(0, 25).forEach(function (o) {
    if (frei <= 0) return;
    var to = String(o.to || '').trim();
    if (!PL_MAIL_RX.test(to)) { fehler.push({ k: o.k, e: 'Adresse ungültig' }); return; }
    if (abm[to.toLowerCase()]) { fehler.push({ k: o.k, e: 'abgemeldet' }); return; }
    try {
      GmailApp.sendEmail(to, String(o.s || '').slice(0, 200), String(o.b || ''),
        { from: von, name: 'Fragrance Hub Germany', replyTo: 'info@fragranceshub.de', htmlBody: plHtml_(o.b) });
      ok.push(o.k); frei--; log.push([to, o.name || '', o.s || '', 'E-Mail (Sammelversand)']);
    } catch (e) { fehler.push({ k: o.k, e: e.message }); if (/limit|quota|kontingent/i.test(e.message)) frei = 0; }
  });
  try { plKontaktLog_(log); } catch (e) { Logger.log('Kontakt-Log: ' + e.message); }
  return { ok: ok, fehler: fehler, frei: Math.max(0, frei) };
}

/* =====================================================================
   Automatische Verarbeitung der Kundenantworten (stündlich alle 15 Min.)
   Proton leitet Antworten mit „Rabatt“, „discount“ oder „Willkommen bei Fragrance Hub“ im Betreff
   an Gmail weiter. Hier wird jede Antwort gelesen:
     • „Abmelden / Unsubscribe …“      → Kunde abgemeldet (kein Sammelversand mehr)
     • EU-USt-IdNr. (VIES gültig)       → Shopify-Kunde mit Tag b2b-ust (15 % Öle / 10 % Rest) + Bestätigungs-Mail
     • USt-IdNr. ungültig / Steuernummer → freundliche Rückfrage per Mail
     • Nicht-EU-Nummer (CH, GB, NO …)   → Eingangsbestätigung an Kunden, Entscheidung durch den Inhaber (Telegram)
     • alles andere                      → nur protokolliert (bleibt in Proton zur Beantwortung)
   ===================================================================== */
var PL_ANTW = 'Kunden-Antworten';
var PL_ANTW_LABEL = 'FH-Antwort-verarbeitet';
var PL_UST_RX = { AT: /^ATU\d{8}$/, BE: /^BE[01]\d{9}$/, BG: /^BG\d{9,10}$/, CY: /^CY\d{8}[A-Z]$/, CZ: /^CZ\d{8,10}$/, DE: /^DE\d{9}$/,
  DK: /^DK\d{8}$/, EE: /^EE\d{9}$/, EL: /^EL\d{9}$/, ES: /^ES[A-Z0-9]\d{7}[A-Z0-9]$/, FI: /^FI\d{8}$/, FR: /^FR[A-Z0-9]{2}\d{9}$/,
  HR: /^HR\d{11}$/, HU: /^HU\d{8}$/, IE: /^IE\d[A-Z0-9+*]\d{5}[A-Z]{1,2}$/, IT: /^IT\d{11}$/, LT: /^LT(\d{9}|\d{12})$/, LU: /^LU\d{8}$/,
  LV: /^LV\d{11}$/, MT: /^MT\d{8}$/, NL: /^NL\d{9}B\d{2}$/, PL: /^PL\d{10}$/, PT: /^PT\d{9}$/, RO: /^RO\d{2,10}$/, SE: /^SE\d{12}$/,
  SI: /^SI\d{8}$/, SK: /^SK\d{10}$/, XI: /^XI\d{9}$/ };
var PL_NICHT_EU_RX = /\b(CHE[\s.\-]?\d{3}[\s.\-]?\d{3}[\s.\-]?\d{3}|GB\s?\d{9}(\d{3})?|NO\s?\d{9}\s?MVA)\b/i;

/** Antworttext ohne zitierte Original-Mail */
function plAntwText_(t) {
  t = String(t || '').replace(/\r/g, '');
  var cut = t.search(/^(Am .{3,80}schrieb|On .{3,80}wrote|-{2,}\s*(Original|Ursprüngliche)|_{5,}|Von:\s|From:\s|Gesendet:\s|Sent:\s)/m);
  if (cut > 0) t = t.slice(0, cut);
  return t.split('\n').filter(function (l) { return !/^\s*>/.test(l); }).join('\n').trim();
}
/** Original-Absender (auch bei Weiterleitung über Proton) */
function plAntwAbsender_(msg) {
  var eigene = /@(fragranceshub\.de|proton\.me|protonmail\.(com|ch)|pm\.me)$|^almasri9696@gmail\.com$/i;
  var kand = [msg.getReplyTo(), msg.getFrom()];
  ['X-Original-From', 'X-Original-Sender', 'X-Forwarded-For', 'Return-Path'].forEach(function (h) { try { kand.push(msg.getHeader(h)); } catch (e) {} });
  var b = String(msg.getPlainBody() || '');
  var m = b.match(/^(?:From|Von|Absender):.*?([\w.+-]+@[\w-]+\.[\w.-]+)/mi); if (m) kand.push(m[1]);
  for (var i = 0; i < kand.length; i++) {
    var x = String(kand[i] || '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    if (x && !eigene.test(x[0])) return { e: x[0].toLowerCase(), name: String(kand[i]).replace(/<.*$/, '').replace(/"/g, '').trim() };
  }
  return null;
}
/** erste formal gültige EU-USt-IdNr. im Text */
function plUstFinden_(text) {
  var U = String(text || '').toUpperCase().replace(/\bGR(?=[\s.\-]?\d{9}\b)/g, 'EL');
  var c = U.match(/\b(?:AT|BE|BG|CY|CZ|DE|DK|EE|EL|ES|FI|FR|HR|HU|IE|IT|LT|LU|LV|MT|NL|PL|PT|RO|SE|SI|SK|XI)[\s.\-]?[0-9A-Z](?:[\s.\-]?[0-9A-Z+*]){6,14}/g) || [];
  for (var i = 0; i < c.length; i++) {
    var k = c[i].replace(/[\s.\-]/g, ''), rx = PL_UST_RX[k.slice(0, 2)];
    for (var n = Math.min(k.length, 14); n >= 8 && rx; n--) if (rx.test(k.slice(0, n))) return k.slice(0, n);
  }
  return '';
}
function plAntwLog_(r) {
  var sh = plLogBlatt_(PL_ANTW, ['Datum', 'E-Mail', 'Name', 'Ergebnis', 'USt-IdNr.', 'Details', 'Betreff']);
  sh.appendRow([new Date().toISOString()].concat(r));
}
function plAbmeldenIntern_(e, name) {
  var sh = plLogBlatt_(PL_ABMELD, ['Datum', 'E-Mail', 'Name', 'Von']);
  if (!plAbmeldungen_()[e]) sh.appendRow([new Date().toISOString(), e, name || '', 'automatisch (Antwort)']);
  CacheService.getScriptCache().remove('PL_KUNDEN');
}
/** Kundendaten aus "Kunden-Shop" (Name, Firma, Land) */
function plShopKunde_(e) {
  var sh = lagerSS_().getSheetByName(PL_KD_BLATT); if (!sh || sh.getLastRow() < 2) return null;
  var v = sh.getRange(2, 1, sh.getLastRow() - 1, 6).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][3]).toLowerCase() === e) return { name: String(v[i][1]), firma: String(v[i][2]), land: String(v[i][5]) };
  return null;
}
function plDe_(land) { return ['DE', 'AT', 'CH', 'LI', 'LU'].indexOf(String(land || '').toUpperCase()) >= 0; }
var PL_SIG_DE = '\n\nMit freundlichen Grüßen\n\nFragrance Hub Germany\nAm Alten Kirchplatz 10 · 45665 Recklinghausen\nTel. / WhatsApp: +49 2361 4878835\nE-Mail: info@fragranceshub.de\nhttps://fragranceshub.de';
var PL_SIG_EN = '\n\nKind regards\n\nFragrance Hub Germany\nAm Alten Kirchplatz 10 · 45665 Recklinghausen · Germany\nPhone / WhatsApp: +49 2361 4878835\nE-mail: info@fragranceshub.de\nhttps://fragranceshub.de';
function plAntwMail_(to, betreff, text) {
  GmailApp.sendEmail(to, betreff, text, { from: plVon_(), name: 'Fragrance Hub Germany', replyTo: 'info@fragranceshub.de', htmlBody: plHtml_(text) });
}

function plAntwortenLauf() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return;
  try {
    var label = GmailApp.getUserLabelByName(PL_ANTW_LABEL) || GmailApp.createLabel(PL_ANTW_LABEL);
    var q = 'newer_than:30d -in:sent -label:' + PL_ANTW_LABEL + ' subject:"Fragrance Hub" (subject:Rabatt OR subject:discount OR subject:Willkommen) -from:shopify -from:noreply -from:no-reply -from:mailer-daemon';
    var threads = GmailApp.search(q, 0, 30), tg = [];
    threads.forEach(function (th) {
      var fertig = true;
      th.getMessages().forEach(function (msg) {
        if (msg.isInTrash()) return;
        if (/fragranceshub\.de|almasri9696@gmail\.com/i.test(msg.getFrom()) && !/almasri9696@gmail\.com/i.test(msg.getTo())) return;   // eigene ausgehende Mail
        var abs = plAntwAbsender_(msg); if (!abs) return;
        var key = 'PL_ANTW_' + msg.getId(), props = PropertiesService.getScriptProperties();
        if (props.getProperty(key)) return;
        var text = plAntwText_(msg.getPlainBody()), betreff = msg.getSubject(), sk = plShopKunde_(abs.e) || {};
        var name = sk.name || abs.name || abs.e, land = sk.land || '';
        var erledigt = function (erg, ust, det) { plAntwLog_([abs.e, name, erg, ust || '', det || '', betreff]); props.setProperty(key, '1'); };

        // 1) Abmeldung
        if (/\b(abmelden|abmeldung|abbestellen|austragen|unsubscribe|opt[\s-]?out|remove me)\b|keine\s+(weiteren\s+)?(e-?mails|mails|nachrichten|werbung|informationen)|no\s+more\s+e-?mails/i.test(text) ||
            (/^\s*stop+\s*[.!]?\s*$/i.test(text))) {
          plAbmeldenIntern_(abs.e, name); erledigt('Abmeldung', '', 'automatisch abgemeldet');
          tg.push('🚫 Abgemeldet: ' + name + ' <' + abs.e + '>'); return;
        }
        // 2) EU-USt-IdNr.
        var ust = plUstFinden_(text);
        if (ust) {
          var vies = b2bVies_(ust);
          if (vies.status === 'unklar') {   // VIES gerade nicht erreichbar → später erneut (max. 1 Tag)
            if (Date.now() - msg.getDate().getTime() < 864e5) { fertig = false; return; }
            erledigt('USt – VIES nicht erreichbar', ust, 'bitte manuell prüfen'); tg.push('⚠️ VIES nicht erreichbar – bitte prüfen: ' + name + ' <' + abs.e + '> · ' + ust); return;
          }
          var de = plDe_(land || ust.slice(0, 2));
          if (vies.status === 'gueltig') {
            var teile = String(name).trim().split(/\s+/), firma = vies.name || sk.firma || name;
            var d = { firma: firma, taet: 'Antwort auf E-Mail-Angebot', ust: ust, vn: teile.slice(0, -1).join(' ') || teile[0] || '', nn: teile.length > 1 ? teile[teile.length - 1] : '',
                      em: abs.e, tel: '', str: '', plz: '', ort: '', land: '', msg: '' };
            var kunde = '';
            try { kunde = b2bShopifyKunde_(d, vies); } catch (e) { kunde = '⚠️ ' + e.message; }
            if (kunde.indexOf('⚠️') === 0) { erledigt('USt gültig – Shopify-Fehler', ust, kunde); tg.push('⚠️ USt gültig, aber Shopify-Fehler: ' + name + ' · ' + ust + ' · ' + kunde); return; }
            plAntwMail_(abs.e, de ? 'Ihr Geschäftskunden-Rabatt ist aktiviert – Fragrance Hub Germany' : 'Your business discount is activated – Fragrance Hub Germany',
              de ? 'Guten Tag ' + name + ',\n\nvielen Dank für Ihre Rückmeldung.\n\nIhre USt-IdNr. ' + ust + ' wurde erfolgreich über das EU-System VIES geprüft' + (vies.name ? ' (' + vies.name + ')' : '') + '. ' +
                   'Ihr Kundenkonto ist ab sofort als Geschäftskunde freigeschaltet:\n\n• 15 % Rabatt auf alle Duftöle\n• 10 % Rabatt auf Flakons und Zubehör\n\n' +
                   'Der Rabatt wird automatisch abgezogen, sobald Sie beim Bestellen in Ihrem Kundenkonto angemeldet sind – mit dieser E-Mail-Adresse (' + abs.e + '):\nhttps://fragranceshub.de/account/login\n\n' +
                   'Unser komplettes Sortiment finden Sie unter https://fragranceshub.de\n\nGerne stellen wir Ihnen auch ein individuelles Angebot zusammen – antworten Sie einfach auf diese E-Mail.' + PL_SIG_DE
                 : 'Dear ' + name + ',\n\nthank you for your reply.\n\nYour VAT ID ' + ust + ' has been successfully verified via the EU VIES system' + (vies.name ? ' (' + vies.name + ')' : '') + '. ' +
                   'Your customer account is now activated as a business customer:\n\n• 15 % discount on all fragrance oils\n• 10 % discount on bottles and accessories\n\n' +
                   'The discount is applied automatically as soon as you are logged in to your customer account when ordering – with this e-mail address (' + abs.e + '):\nhttps://fragranceshub.de/account/login\n\n' +
                   'You can find our complete range at https://fragranceshub.de\n\nWe are also happy to prepare an individual offer for you – simply reply to this e-mail.' + PL_SIG_EN);
            erledigt('USt gültig – Rabatt aktiviert', ust, (vies.name || '') + ' · ' + kunde);
            tg.push('✅ Geschäftskunde aktiviert (15 % Öle / 10 % Rest): ' + firma + ' <' + abs.e + '> · ' + ust + ' · ' + kunde); return;
          }
          plAntwMail_(abs.e, de ? 'Ihre USt-IdNr. – Fragrance Hub Germany' : 'Your VAT ID – Fragrance Hub Germany',
            de ? 'Guten Tag ' + name + ',\n\nvielen Dank für Ihre Rückmeldung.\n\nLeider konnte die USt-IdNr. ' + ust + ' im EU-System VIES nicht als gültig bestätigt werden. ' +
                 'Bitte prüfen Sie die Nummer und senden Sie uns Ihre gültige USt-IdNr. einfach als Antwort auf diese E-Mail – wir aktivieren Ihren Geschäftskunden-Rabatt dann sofort.' + PL_SIG_DE
               : 'Dear ' + name + ',\n\nthank you for your reply.\n\nUnfortunately the VAT ID ' + ust + ' could not be confirmed as valid in the EU VIES system. ' +
                 'Please check the number and send us your valid VAT ID as a reply to this e-mail – we will then activate your business discount right away.' + PL_SIG_EN);
          erledigt('USt ungültig – Rückfrage gesendet', ust, vies.text); tg.push('❌ USt-IdNr. ungültig (Rückfrage gesendet): ' + name + ' <' + abs.e + '> · ' + ust); return;
        }
        // 3) Nicht-EU-Nummer → Inhaber entscheidet
        var ne = text.match(PL_NICHT_EU_RX);
        if (ne) {
          var de2 = plDe_(land || (/^CHE/i.test(ne[0]) ? 'CH' : ''));
          plAntwMail_(abs.e, de2 ? 'Ihre Unternehmensnummer – Fragrance Hub Germany' : 'Your company number – Fragrance Hub Germany',
            de2 ? 'Guten Tag ' + name + ',\n\nvielen Dank für Ihre Rückmeldung und Ihre Unternehmensnummer ' + ne[0] + '. Wir prüfen Ihre Angaben und melden uns in Kürze persönlich bei Ihnen.' + PL_SIG_DE
                : 'Dear ' + name + ',\n\nthank you for your reply and your company number ' + ne[0] + '. We will check your details and get back to you personally shortly.' + PL_SIG_EN);
          erledigt('Nicht-EU-Nummer – Entscheidung Inhaber', ne[0], ''); tg.push('🌍 Nicht-EU-Nummer – bitte entscheiden (Tag b2b-ust in Shopify setzen?): ' + name + ' <' + abs.e + '> · ' + ne[0]); return;
        }
        // 4) Nur Steuernummer (z. B. 123/456/78901) → um USt-IdNr. bitten
        if (/\b\d{2,3}\/\d{3,4}\/\d{4,5}\b/.test(text)) {
          plAntwMail_(abs.e, 'Ihre USt-IdNr. – Fragrance Hub Germany', 'Guten Tag ' + name + ',\n\nvielen Dank für Ihre Rückmeldung.\n\n' +
            'Für den Geschäftskunden-Rabatt benötigen wir Ihre Umsatzsteuer-Identifikationsnummer (USt-IdNr., z. B. DE123456789) – die Steuernummer können wir leider nicht automatisch prüfen. ' +
            'Ihre USt-IdNr. finden Sie z. B. auf Ihren Rechnungen oder im Schreiben des Bundeszentralamts für Steuern. Senden Sie sie uns einfach als Antwort auf diese E-Mail.' + PL_SIG_DE);
          erledigt('Steuernummer statt USt-IdNr. – Rückfrage gesendet', '', ''); tg.push('ℹ️ Steuernummer statt USt-IdNr. (Rückfrage gesendet): ' + name + ' <' + abs.e + '>'); return;
        }
        // 5) sonstige Antwort → nur protokollieren
        erledigt('Sonstige Antwort – in Proton beantworten', '', text.replace(/\s+/g, ' ').slice(0, 300));
        tg.push('💬 Antwort von ' + name + ' <' + abs.e + '> (bitte in Proton beantworten): ' + text.replace(/\s+/g, ' ').slice(0, 200));
      });
      if (fertig) { th.addLabel(label); th.moveToArchive(); }
    });
    if (tg.length) etTelegram_('📥 Kundenantworten (automatisch verarbeitet):\n\n' + tg.join('\n'), null);
    if (tg.length) CacheService.getScriptCache().remove('PL_KUNDEN');
  } finally { lock.releaseLock(); }
}
function plAntworten_() {
  var sh = lagerSS_().getSheetByName(PL_ANTW); if (!sh || sh.getLastRow() < 2) return [];
  var n = sh.getLastRow() - 1, ab = Math.max(0, n - 40);
  return sh.getRange(2 + ab, 1, n - ab, 6).getValues().reverse().map(function (r) { return { t: String(r[0]), e: String(r[1]), n: String(r[2]), r: String(r[3]), u: String(r[4]), d: String(r[5]) }; });
}
/** Trigger alle 15 Minuten */
function plAntwortenSetup() {
  var da = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'plAntwortenLauf'; });
  if (!da) ScriptApp.newTrigger('plAntwortenLauf').timeBased().everyMinutes(15).create();
  plAntwortenLauf();
  return true;
}
/** Test ohne Mail: erkennt USt-IdNr./Abmeldung in Beispieltexten */
function plAntwortenTest() {
  ['Hallo, unsere USt-IdNr. lautet DE 811 569 869. Viele Grüße', 'Bitte abmelden', 'VAT: NL 8532.10.457B01 thanks', 'MWST CHE-123.456.789', 'Steuernr. 123/456/78901', 'Danke!'].forEach(function (t) {
    Logger.log(t + ' → ust=' + plUstFinden_(plAntwText_(t)) + ' · nichtEU=' + ((t.match(PL_NICHT_EU_RX) || [''])[0]));
  });
}

/* =====================================================================
   Telegram: zwei Kanäle
     • Etiketten-Gruppe (TELEGRAM_CHAT_ID)      – Etiketten-PDFs, Shop-Bestellungen, Packlisten, /neu-Befehle
     • Berichte-Chat (TELEGRAM_CHAT_BERICHTE)   – alles andere (Kundenantworten, B2B, Lager, Chargen, IFRA, Prüfberichte …)
   Einrichten: im Telegram-Chat mit dem Bot (oder einer neuen Gruppe mit dem Bot) /berichte senden.
   Solange kein Berichte-Chat verbunden ist, geht alles wie bisher in die Etiketten-Gruppe.
   ===================================================================== */
var PL_TG_ETIKETT_RX = /^(📦 Bestellung|🏷️|🧪 (?!TEST)|❌ (Die Etiketten|\d)|⚠️ [^\n]*\nOHNE Etikett|⏳ Erstelle Etiketten|❓ Bestellung|⏸️|❗ Bitte Bestellnummer|ℹ️ Befehle|🤖 Befehle|✅ Etiketten|✅ Fragrance Hub Etiketten|\u{1F501})/u;
function plTgSenden_(chat, text, pdf) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token || !chat) return;
  try {
    var base = 'https://api.telegram.org/bot' + token + '/';
    var r = pdf
      ? UrlFetchApp.fetch(base + 'sendDocument', { method: 'post', muteHttpExceptions: true,
          payload: { chat_id: chat, caption: String(text).slice(0, 1000), document: pdf.copyBlob() } })
      : UrlFetchApp.fetch(base + 'sendMessage', { method: 'post', muteHttpExceptions: true,
          payload: { chat_id: chat, text: String(text).slice(0, 4000) } });
    if (r.getResponseCode() !== 200) Logger.log('Telegram-Fehler ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  } catch (e) { Logger.log('Telegram nicht gesendet: ' + e.message); }
}
/** ersetzt etTelegram_ aus CLP-Etikett.gs: Etiketten/Bestellungen → Etiketten-Gruppe, Rest → Berichte-Chat */
function etTelegram_(text, pdf) {
  var p = PropertiesService.getScriptProperties(), haupt = p.getProperty('TELEGRAM_CHAT_ID'), ber = p.getProperty('TELEGRAM_CHAT_BERICHTE');
  var etikett = !!pdf || PL_TG_ETIKETT_RX.test(String(text || ''));
  plTgSenden_(etikett || !ber ? haupt : ber, text, pdf);
}
/** ersetzt etTelegramBefehle: /neu in der Etiketten-Gruppe wie bisher + /berichte verbindet den Berichte-Chat */
function etTelegramBefehle() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('TELEGRAM_TOKEN'), chat = props.getProperty('TELEGRAM_CHAT_ID');
    if (!token || !chat) return;
    var offset = Number(props.getProperty('TG_OFFSET') || 0);
    var res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token +
              '/getUpdates?timeout=0&offset=' + offset, { muteHttpExceptions: true }).getContentText());
    var updates = res.result || [];
    if (!updates.length) return;
    var nummern = [];
    updates.forEach(function (u) {
      offset = Math.max(offset, u.update_id + 1);
      var m = u.message;
      if (!m || !m.text) return;
      if (/^\/berichte(@\w+)?\s*$/i.test(m.text.trim())) {                       // Berichte-Chat verbinden
        if (String(m.chat.id) === String(chat)) { plTgSenden_(chat, '❗ Bitte /berichte in einem ANDEREN Chat senden (privat mit dem Bot oder neue Gruppe) – diese Gruppe bleibt für Etiketten.', null); return; }
        props.setProperty('TELEGRAM_CHAT_BERICHTE', String(m.chat.id));
        plTgSenden_(String(m.chat.id), '✅ Berichte-Chat verbunden.\nHier kommen ab jetzt: Kundenantworten, Geschäftskunden, Lager, Chargen, Zertifikate und alle Berichte.\nDie Etiketten und Shop-Bestellungen bleiben in der Etiketten-Gruppe.', null);
        return;
      }
      if (String(m.chat.id) !== String(chat)) return;
      var b = m.text.trim().match(/^\/(neu|hilfe|help)(?:@\w+)?\s*(.*)$/i);
      if (!b) return;
      if (/hilfe|help/i.test(b[1])) { etTelegram_('ℹ️ Befehle:\n/neu 3796  → Etiketten neu senden\n/neu 3796 3801  → mehrere Bestellungen', null); return; }
      var n = b[2].match(/\d+/g);
      if (!n) { etTelegram_('❗ Bitte Bestellnummer angeben, z.B.  /neu 3796', null); return; }
      n.forEach(function (x) { if (nummern.indexOf(x) === -1) nummern.push(x); });
    });
    props.setProperty('TG_OFFSET', String(offset));
    if (!nummern.length) return;
    var map = loadCodeMap(), start = Date.now();
    nummern.forEach(function (nr) {
      if (Date.now() - start > 4 * 60 * 1000) { etTelegram_('⏸️ ' + nr + ' nicht mehr geschafft – bitte erneut senden.', null); return; }
      try {
        var order = etFindeBestellung_(nr);
        if (!order) { etTelegram_('❓ Bestellung ' + nr + ' nicht gefunden.', null); return; }
        etTelegram_('⏳ Erstelle Etiketten für ' + order.name + ' …', null);
        etVerarbeiteBestellung_(order, map);
      } catch (e) { etTelegram_('❌ ' + nr + ': ' + e.message, null); }
    });
  } finally { lock.releaseLock(); }
}
/** zeigt den Bot-Namen (für die Einrichtung des Berichte-Chats) */
function plTelegramBot() {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  var me = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getMe').getContentText()).result;
  Logger.log('Bot: @' + me.username + ' (' + me.first_name + ') · Berichte-Chat: ' + (PropertiesService.getScriptProperties().getProperty('TELEGRAM_CHAT_BERICHTE') || 'noch nicht verbunden'));
  return me.username;
}
