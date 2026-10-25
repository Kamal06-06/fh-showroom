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
  plHb_('auftragsdaten');
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
var PL_MAIL_RESERVE = 25;   // für Zertifikate, Rechnungen, Antworten – Sammelversand nutzt nur den Rest
function plQuota_() { if (!SR_ADMIN) throw new Error('NUR_INHABER'); return { frei: Math.max(0, MailApp.getRemainingDailyQuota() - PL_MAIL_RESERVE), von: fhAbsender_() || '' }; }

/** Sammelversand: liste = [{k, to, s, b}] – jede E-Mail einzeln (persönlich), stoppt beim Tageskontingent */
function plMailBulk_(liste) {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var von = plVon_(), ok = [], fehler = [], frei = MailApp.getRemainingDailyQuota() - PL_MAIL_RESERVE, abm = plAbmeldungen_(), log = [];
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
  plHb_('antworten');
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
  plHb_('telegram');
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

/* =====================================================================
   Etiketten nur tagsüber: 07:00–19:00 (Berlin). Bestellungen von 19:00–07:00 bleiben liegen
   und werden ab 07:00 automatisch nacheinander gesendet (5 Bestellungen je Lauf, Lauf alle 5 Min.).
   /neu in der Gruppe funktioniert weiterhin jederzeit.
   ===================================================================== */
var PL_ETK_VON = 7, PL_ETK_BIS = 19;
function plEtikettZeit_() { var h = Number(Utilities.formatDate(new Date(), 'Europe/Berlin', 'H')); return h >= PL_ETK_VON && h < PL_ETK_BIS; }
/** ersetzt processEtiketten aus CLP-Etikett.gs (gleicher Ablauf, nur mit Zeitfenster) */
function processEtiketten() {
  plHb_('etiketten');
  if (!plEtikettZeit_()) return;                 // nachts nichts senden – ab 07:00 wird nachgeholt
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  var start = Date.now();
  try {
    var props = PropertiesService.getScriptProperties();
    var ab = props.getProperty('ETK_START_DATE');
    if (!ab) throw new Error('Bitte zuerst setupEtiketten() ausführen.');
    var orders = etHoleBestellungen_("created_at:>='" + ab + "' -status:cancelled -tag:" + ETIKETT.tag, ETIKETT.maxBestellungenProLauf);
    if (!orders.length) return;
    var map = loadCodeMap();
    orders.forEach(function (order) {
      if (Date.now() - start > 4 * 60 * 1000) return;
      if ((order.tags || []).indexOf(ETIKETT.tag) > -1) return;
      if (props.getProperty('etk_' + order.id)) return;
      try {
        etVerarbeiteBestellung_(order, map);
        addTag(order.id, ETIKETT.tag);
        props.setProperty('etk_' + order.id, '1');
      } catch (e) {
        if (!props.getProperty('etkerr_' + order.id)) {
          props.setProperty('etkerr_' + order.id, '1');
          var fehlerText = 'Die Etiketten für ' + order.name + ' konnten nicht erstellt werden:\n\n' + e.message;
          if (ETIKETT.emailSenden) MailApp.sendEmail(ETIKETT.empfaenger, 'Fehler bei Etiketten ' + order.name, fehlerText);
          else etTelegram_('❌ ' + fehlerText, null);
        }
        Logger.log(order.name + ': ' + e.message);
      }
    });
  } finally { lock.releaseLock(); }
}

/* =====================================================================
   Tägliche Prüfung (07:45) → Berichte-Chat: läuft alles? Fehler? Grenzen?
   plPruefungJetzt() kann jederzeit von Hand gestartet werden (Ergebnis im Log + Telegram).
   ===================================================================== */
function plHb_(name) { try { PropertiesService.getScriptProperties().setProperty('HB_' + name, String(Date.now())); } catch (e) {} }
var PL_PFLICHT = { processEtiketten: 'Etiketten (Shop)', etTelegramBefehle: 'Telegram-Befehle', processPaidOrders: 'Zertifikate nach Zahlung',
  lagerShopifyLauf: 'Lager ← Shopify', plSync: 'Auftragsdaten', plAntwortenLauf: 'Kundenantworten', chStuendlich: 'Chargen/Zertifikate lesen',
  zertQueueLauf: 'Zertifikat-Anfragen' };
function plPruefung_() {
  var ok = [], warn = [], p = PropertiesService.getScriptProperties(), alle = p.getProperties(), jetzt = Date.now();
  var std = function (ms) { var m = Math.round((jetzt - ms) / 60000); return m < 120 ? m + ' Min.' : Math.round(m / 60) + ' Std.'; };
  // 1) Trigger vorhanden / doppelt
  var anz = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { var h = t.getHandlerFunction(); anz[h] = (anz[h] || 0) + 1; });
  var fehlt = Object.keys(PL_PFLICHT).filter(function (h) { return !anz[h]; }).map(function (h) { return PL_PFLICHT[h]; });
  var doppelt = Object.keys(anz).filter(function (h) { return anz[h] > 1; });
  if (fehlt.length) warn.push('Automatik fehlt: ' + fehlt.join(', ')); else ok.push('Alle ' + Object.keys(PL_PFLICHT).length + ' Automatiken aktiv (' + ScriptApp.getProjectTriggers().length + ' Trigger)');
  if (doppelt.length) warn.push('Doppelte Trigger (verbrauchen Laufzeit): ' + doppelt.map(function (h) { return h + ' ×' + anz[h]; }).join(', '));
  // 2) Lebenszeichen
  [['etiketten', 'Etiketten-Prüfung', 20], ['telegram', 'Telegram-Befehle', 20], ['auftragsdaten', 'Auftragsdaten', 150], ['antworten', 'Kundenantworten', 45]].forEach(function (x) {
    var t = Number(alle['HB_' + x[0]] || 0);
    if (!t) warn.push(x[1] + ': noch kein Lauf registriert');
    else if (jetzt - t > x[2] * 60000) warn.push(x[1] + ': letzter Lauf vor ' + std(t)); else ok.push(x[1] + ' läuft (vor ' + std(t) + ')');
  });
  try {
    var ev = lagerSS_().getSheetByName('Einstellungen').getDataRange().getValues(), ls = 0;
    ev.forEach(function (r) { if (r[0] === 'Letzter Shopify-Lauf' && r[1] instanceof Date) ls = r[1].getTime(); });
    if (!ls || jetzt - ls > 60 * 60000) warn.push('Lager ← Shopify: letzter Lauf ' + (ls ? 'vor ' + std(ls) : 'unbekannt')); else ok.push('Lager-Abgleich läuft (vor ' + std(ls) + ')');
  } catch (e) { warn.push('Lager-Tabelle nicht lesbar: ' + e.message); }
  // 3) Fehlermeldungen von Google (letzte 24 Std.)
  try {
    var th = GmailApp.search('from:apps-scripts-notifications@google.com newer_than:1d', 0, 10), zeilen = [];
    th.forEach(function (t) { t.getMessages().forEach(function (m) {
      if (jetzt - m.getDate().getTime() > 864e5) return;
      String(m.getPlainBody()).split('\n').forEach(function (l) { l = l.trim(); if (/^\S+\s+(Exception|Error|TypeError|ReferenceError|Fehler|Exceeded|Service|Zeitüberschreitung|Timeout)/i.test(l) || /Exception:|Error:|exceeded|Überschritten|Zeitlimit/i.test(l)) zeilen.push(l.slice(0, 160)); });
    }); });
    var uniq = zeilen.filter(function (v, i, a) { return a.indexOf(v) === i; });
    if (uniq.length) warn.push('Fehler laut Google (24 Std.):\n   • ' + uniq.slice(0, 8).join('\n   • ') + (uniq.length > 8 ? '\n   • … +' + (uniq.length - 8) : ''));
    else ok.push('Keine Fehlermeldungen von Google');
  } catch (e) { warn.push('Fehler-Mails nicht lesbar: ' + e.message); }
  // 4) Etiketten hängen?
  try {
    var ab = p.getProperty('ETK_START_DATE'), grenze = new Date(jetzt - 75 * 60000).toISOString();
    var offen = shopifyGraphQL('query($q:String!){orders(first:50,query:$q){nodes{name createdAt}}}',
      { q: "created_at:>='" + ab + "' created_at:<'" + grenze + "' -status:cancelled -tag:" + ETIKETT.tag }).orders.nodes;
    var tag = plEtikettZeit_();
    if (offen.length && tag) warn.push('Bestellungen ohne Etikett (älter als 75 Min.): ' + offen.length + ' – ' + offen.slice(0, 6).map(function (o) { return o.name; }).join(', '));
    else ok.push(offen.length ? offen.length + ' Nachtbestellungen warten auf 07:00' : 'Alle Bestellungen haben Etiketten');
  } catch (e) { warn.push('Shopify nicht erreichbar: ' + e.message.slice(0, 120)); }
  // 5) Grenzen
  try { var q = MailApp.getRemainingDailyQuota(); (q < 20 ? warn : ok).push('E-Mail-Kontingent heute: noch ' + q); } catch (e) {}
  var groesse = 0; Object.keys(alle).forEach(function (k) { groesse += k.length + String(alle[k]).length; });
  var kb = Math.round(groesse / 1024);
  (kb > 400 ? warn : ok).push('Skript-Speicher: ' + kb + ' KB von 500 KB (' + Object.keys(alle).length + ' Einträge)');
  if (!fhAbsender_()) warn.push('Absender info@fragranceshub.de ist in Gmail nicht verfügbar – Kunden-E-Mails werden nicht gesendet');
  else ok.push('Absender info@fragranceshub.de bereit');
  try { var tk = p.getProperty('TELEGRAM_TOKEN'); var me = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + tk + '/getMe', { muteHttpExceptions: true }).getContentText()); (me.ok ? ok : warn).push(me.ok ? 'Telegram-Bot erreichbar' : 'Telegram-Bot Fehler'); } catch (e) { warn.push('Telegram nicht erreichbar'); }
  if (!p.getProperty('TELEGRAM_CHAT_BERICHTE')) warn.push('Berichte-Chat nicht verbunden (/berichte senden)');
  // 6) Kundenantworten der letzten 24 Std.
  try {
    var sh = lagerSS_().getSheetByName(PL_ANTW), n24 = 0;
    if (sh && sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) { if (jetzt - new Date(r[0]).getTime() < 864e5) n24++; });
    ok.push('Kundenantworten verarbeitet (24 Std.): ' + n24);
  } catch (e) {}
  return { ok: ok, warn: warn };
}
function plPruefungText_(r) {
  var d = Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy HH:mm');
  return (r.warn.length ? '🩺 Tagesprüfung ' + d + ' – ⚠️ ' + r.warn.length + ' Hinweis(e)\n\n⚠️ ' + r.warn.join('\n⚠️ ') + '\n\n' : '🩺 Tagesprüfung ' + d + ' – ✅ alles in Ordnung\n\n') +
         '✅ ' + r.ok.join('\n✅ ');
}
function plPruefungTaeglich() { var t = plPruefungText_(plPruefung_()); etTelegram_(t, null); return t; }
function plPruefungJetzt() { var t = plPruefungTaeglich(); Logger.log(t); return t; }
function plPruefungEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'plPruefungTaeglich') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('plPruefungTaeglich').timeBased().everyDays(1).atHour(7).nearMinute(45).inTimezone('Europe/Berlin').create();
  return plPruefungJetzt();
}

/* =====================================================================
   🛒 Shop-Bestellungen in der Showroom-App (eigener Bereich, eigenes Passwort)
   • nur LESEN aus Shopify + Vorbereitungsstand im Blatt "Shop-Vorbereitung"
   • KEIN Einfluss auf Lager, Inventur, Kundenkonten (eigene Daten, nicht in "lists")
   App-Aktionen: so_list, so_set, so_pw (Passwort setzen, nur Inhaber), so_info
   ===================================================================== */
var SO_BLATT = 'Shop-Vorbereitung';
function soHash_(pw) { return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, 'fh-shop|' + String(pw || ''), Utilities.Charset.UTF_8)); }
function soPruefen_(pw) {
  var h = PropertiesService.getScriptProperties().getProperty('SO_PW');
  if (!h) throw new Error('SO_KEIN_PW');
  if (soHash_(pw) !== h) throw new Error('SO_PW_FALSCH');
}
function soInfo_() { return { pw: !!PropertiesService.getScriptProperties().getProperty('SO_PW') }; }
function soPwSetzen_(o) {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var neu = String(o && o.neu || '');
  if (neu.length < 4) throw new Error('Passwort zu kurz (mind. 4 Zeichen)');
  PropertiesService.getScriptProperties().setProperty('SO_PW', soHash_(neu));
  return true;
}
function soBlatt_() {
  var ss = lagerSS_(), sh = ss.getSheetByName(SO_BLATT);
  if (!sh) { sh = ss.insertSheet(SO_BLATT); sh.getRange(1, 1, 1, 4).setValues([['Bestell-ID', 'Bestellung', 'Stand (JSON)', 'Geändert']]).setFontWeight('bold'); sh.setFrozenRows(1); sh.getRange('A:B').setNumberFormat('@'); }
  return sh;
}
function soStaende_() {
  var sh = soBlatt_(), n = sh.getLastRow(), m = {};
  if (n > 1) sh.getRange(2, 1, n - 1, 3).getValues().forEach(function (r, i) { try { m[String(r[0])] = { row: i + 2, d: JSON.parse(r[2] || '{}') }; } catch (e) {} });
  return m;
}
function soShopHandle_() {
  var p = PropertiesService.getScriptProperties(), h = p.getProperty('SO_SHOP_HANDLE');
  if (!h) { try { h = String(shopifyGraphQL('{ shop { myshopifyDomain } }').shop.myshopifyDomain).replace('.myshopify.com', ''); p.setProperty('SO_SHOP_HANDLE', h); } catch (e) { h = ''; } }
  return h;
}
var SO_TIER = { S: 'Standard', P: 'Premium', E: 'Exklusiv' };
function soPosition_(li) {
  var q = Number(li.currentQuantity) || 0, vt = String(li.variantTitle || ''), p = lagerParseSku_(li.sku, li.title, li.variantTitle);
  if (p && p.item.oil) {
    var probe = /pro\s*gramm/i.test(vt), g = Math.round(p.menge * 1000 * 1000) / 1000;
    var size = probe ? q + ' g' : (g >= 1000 ? (g / 1000) + ' kg' : g + ' g');
    return { t: li.title, a: '', oil: 1, code: p.item.code, tier: SO_TIER[String(p.item.tier).charAt(0)] || 'Standard', size: size, q: probe ? 1 : q, sku: li.sku || '', probe: probe || g <= 20, vt: vt };
  }
  return { t: li.title, oil: 0, code: '', size: vt, q: q, sku: li.sku || '', vt: vt };
}
/** offene Shop-Bestellungen (nicht versendet, nicht storniert, letzte 21 Tage) */
function soListe_(o) {
  soPruefen_(o && o.pw);
  var ab = Utilities.formatDate(new Date(Date.now() - 21 * 864e5), 'UTC', "yyyy-MM-dd'T'HH:mm:ss'Z'");
  // nur bezahlte bzw. autorisierte Bestellungen – „Zahlung ausstehend" (PENDING) erscheint nicht in der App
  var q = "created_at:>='" + ab + "' -status:cancelled -fulfillment_status:shipped (financial_status:paid OR financial_status:authorized OR financial_status:partially_paid OR financial_status:partially_refunded)";
  var felder = 'id name createdAt displayFinancialStatus displayFulfillmentStatus note tags email phone ' +
    'customer { displayName } shippingAddress { name company address1 address2 zip city country countryCodeV2 phone } ' +
    'billingAddress { name company address1 address2 zip city country } shippingLine { title } ' +
    'currentSubtotalPriceSet { shopMoney { amount } } lineItems(first: 80) { nodes { title variantTitle sku currentQuantity customAttributes { key value } image { url(transform: { maxWidth: 160, maxHeight: 160 }) } } }';
  var nodes = shopifyGraphQL('query($q:String!){orders(first:100,query:$q,sortKey:CREATED_AT,reverse:true){nodes{' + felder + '}}}', { q: q }).orders.nodes;
  var BEZAHLT = { PAID: 1, AUTHORIZED: 1, PARTIALLY_PAID: 1, PARTIALLY_REFUNDED: 1 };
  nodes = nodes.filter(function (n) { return BEZAHLT[String(n.displayFinancialStatus || '').toUpperCase()]; });
  var st = soStaende_(), handle = soShopHandle_();
  // Bestellungen mit DHL-Etikett der letzten 3 Tage bleiben sichtbar (auch wenn in Shopify schon „versendet“) – damit man sie noch stornieren kann
  var da = {}; nodes.forEach(function (n) { da[String(n.id).split('/').pop()] = 1; });
  var nach = Object.keys(st).filter(function (k) { var d = st[k].d || {}; return !da[k] && d.dhl && d.dhl.nr && Date.now() - (d.dhl.at || 0) < 3 * 864e5; }).slice(0, 40);
  if (nach.length) { try {
    var mehr = shopifyGraphQL('query($q:String!){orders(first:40,query:$q){nodes{' + felder + '}}}', { q: nach.map(function (k) { return 'id:' + k; }).join(' OR ') }).orders.nodes;
    nodes = nodes.concat(mehr.filter(function (n) { return BEZAHLT[String(n.displayFinancialStatus || '').toUpperCase()]; }));
  } catch (e) {} }
  var out = nodes.map(function (n) {
    var id = String(n.id).split('/').pop(), a = n.shippingAddress || {};
    var items = (n.lineItems.nodes || []).filter(function (li) { return Number(li.currentQuantity) > 0; }).map(function (li) {
      var x = soPosition_(li);   // + Rohdaten für den Lieferschein (gleiche Logik wie die Order-Printer-Vorlage)
      x.rq = Number(li.currentQuantity) || 0; x.img = (li.image && li.image.url) || '';
      x.props = (li.customAttributes || []).map(function (c) { return [c.key, c.value]; });
      return x;
    });
    var b = n.billingAddress || null;
    return { id: id, nr: n.name, at: new Date(n.createdAt).getTime(), fin: n.displayFinancialStatus, ful: n.displayFulfillmentStatus,
      kunde: (a.company || a.name || (n.customer && n.customer.displayName) || ''), name: a.name || '', firma: a.company || '',
      adr: [a.address1, a.address2, (a.zip || '') + ' ' + (a.city || '')].filter(function (x) { return String(x || '').trim(); }), land: a.countryCodeV2 || '',
      landName: a.country || '', liefer: n.shippingAddress ? { name: a.name || '', firma: a.company || '', a1: a.address1 || '', a2: a.address2 || '', plz: a.zip || '', ort: a.city || '', land: a.country || '', tel: a.phone || '' } : null,
      rechnung: b ? { name: b.name || '', firma: b.company || '', a1: b.address1 || '', a2: b.address2 || '', plz: b.zip || '', ort: b.city || '', land: b.country || '' } : null,
      tel: a.phone || n.phone || '', email: n.email || '', versand: (n.shippingLine && n.shippingLine.title) || '', notiz: n.note || '',
      netto: Number(n.currentSubtotalPriceSet && n.currentSubtotalPriceSet.shopMoney.amount || 0), tags: n.tags || [],
      items: items, stand: (st[id] && st[id].d) || {}, admin: handle ? 'https://admin.shopify.com/store/' + handle + '/orders/' + id : '' };
  });
  return { at: Date.now(), orders: out };
}
/** Lieferadresse einer Shop-Bestellung direkt in Shopify korrigieren (aus der App) – a = { name, firma, a1, a2, plz, ort, land, tel } */
function soAdresseSetzen_(id, a) {
  var name = String(a.name || '').trim().replace(/\s+/g, ' '), i = name.lastIndexOf(' ');
  var adr = { firstName: i > 0 ? name.slice(0, i) : '', lastName: i > 0 ? name.slice(i + 1) : name, company: String(a.firma || '').trim(),
    address1: String(a.a1 || '').trim(), address2: String(a.a2 || '').trim(), zip: String(a.plz || '').trim(), city: String(a.ort || '').trim(),
    countryCode: String(a.land || 'DE').trim().toUpperCase(), phone: String(a.tel || '').trim() };
  if (!adr.lastName || !adr.address1 || !adr.zip || !adr.city) throw new Error('Name, Straße, PLZ und Ort sind Pflicht');
  var d = shopifyGraphQL('mutation($i:OrderInput!){orderUpdate(input:$i){order{id shippingAddress{name company address1 address2 zip city country countryCodeV2 phone}} userErrors{field message}}}',
    { i: { id: 'gid://shopify/Order/' + id, shippingAddress: adr } });
  var e = d.orderUpdate.userErrors || [];
  if (e.length) throw new Error('Shopify: ' + e.map(function (x) { return x.message; }).join('; '));
  return d.orderUpdate.order.shippingAddress;
}
/** Vorbereitungsstand speichern: o = { pw, id, nr, patch:{prep, lots, ready} } */
function soSetzen_(o) {
  soPruefen_(o && o.pw);
  var id = String(o.id || ''); if (!/^\d+$/.test(id)) throw new Error('Bestellung fehlt');
  try {
    var p = o.patch || {};
    if (p.adr) { var neu = soAdresseSetzen_(id, p.adr); delete p.adr; if (!Object.keys(p).length) return { adresse: neu }; }
    var sh = soBlatt_(), st = soStaende_(), alt = (st[id] && st[id].d) || {};
    Object.keys(p).forEach(function (k) { alt[k] = p[k]; });
    if (p.ready === true) { alt.readyAt = Date.now(); alt.readyBy = SR_USER || ''; }
    if (p.ready === false) { delete alt.readyAt; delete alt.readyBy; }
    var zeile = [id, String(o.nr || ''), JSON.stringify(alt), new Date()];
    if (st[id]) sh.getRange(st[id].row, 1, 1, 4).setValues([zeile]); else sh.appendRow(zeile);
    return alt;
  } finally { /* ohne Script-Lock: Etiketten-Läufe sollen das Abhaken nicht blockieren */ }
}

/* =====================================================================
   📦 DHL Paket (Inland) – Versandetiketten direkt aus «طلبات المتجر»
   • Parcel DE Shipping API v2 · OAuth (API-Key + Secret + GKP-Systembenutzer)
   • Zugangsdaten nur in den Skript-Eigenschaften (gibt der Inhaber in der App ein)
   • KEIN Einfluss auf Lager / Inventur / Kundenkonten
   App-Aktionen: dhl_status, dhl_set (nur Inhaber), dhl_test, dhl_vor, dhl_label, dhl_storno
   ===================================================================== */
var DHL_BASE = 'https://api-eu.dhl.com/parcel/de/shipping/v2';
var DHL_TOKEN_URL = 'https://api-eu.dhl.com/parcel/de/account/auth/ropc/v1/token';
var DHL_EKP = '6388620821';
var DHL_PROD = {                       // Produkt → Abrechnungsnummer (EKP + Verfahren + Teilnahme)
  V01PAK: { t: 'DHL Paket', bn: DHL_EKP + '0101', max: 31.5 },
  V62KP:  { t: 'DHL Kleinpaket', bn: DHL_EKP + '6201', max: 1 }
};
var DHL_ABSENDER = { name1: 'Fragrance Hub Germany', name2: 'Inh. Mohammad Kamal Al Masri', addressStreet: 'Am Alten Kirchplatz', addressHouse: '10',
  postalCode: '45665', city: 'Recklinghausen', country: 'DEU', email: 'info@fragranceshub.de', phone: '+49 2361 4878835' };
var DHL_FELDER = { key: 'DHL_KEY', secret: 'DHL_SECRET', user: 'DHL_USER', pass: 'DHL_PASS' };
/** Etikettenformat: Zebra GK420t (Thermo-Rolle) oder A4 (Brother). Druckauftrag "Z-…" → Zebra, "A4-…" → Brother */
var DHL_FORMATE = { '910-300-610': 'Zebra · 103 × 199 mm (Rolle)', '910-300-410': 'Zebra · 103 × 150 mm (Rolle)', 'A4': 'A4 · Brother' };
function dhlFormat_() { var f = PropertiesService.getScriptProperties().getProperty('DHL_FORMAT'); return DHL_FORMATE[f] ? f : '910-300-610'; }
function dhlDruckName_(datei) { return (dhlFormat_() === 'A4' ? 'A4-' : 'Z-') + datei; }

function dhlCfg_() {
  var p = PropertiesService.getScriptProperties(), c = {};
  Object.keys(DHL_FELDER).forEach(function (k) { c[k] = p.getProperty(DHL_FELDER[k]) || ''; });
  return c;
}
function dhlStatus_(o) {
  soPruefen_(o && o.pw);
  var c = dhlCfg_(), u = c.user;
  return { key: !!c.key, secret: !!c.secret, user: u ? u.slice(0, 3) + '…' + u.slice(-3) : '', pass: !!c.pass,
    bereit: !!(c.key && c.secret && c.user && c.pass), absender: DHL_ABSENDER, produkte: DHL_PROD, fmt: dhlFormat_(), formate: DHL_FORMATE };
}
/** nur Inhaber: o = { pw, key, secret, user, pass } – leere Felder bleiben unverändert */
function dhlSetzen_(o) {
  soPruefen_(o && o.pw);
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var p = PropertiesService.getScriptProperties(), n = 0;
  Object.keys(DHL_FELDER).forEach(function (k) { var v = String(o[k] || '').trim(); if (v) { p.setProperty(DHL_FELDER[k], v); n++; } });
  if (o.fmt && DHL_FORMATE[o.fmt]) { p.setProperty('DHL_FORMAT', o.fmt); n++; }
  CacheService.getScriptCache().remove('DHL_TOKEN');
  return { gespeichert: n, status: dhlStatus_(o) };
}
function dhlToken_(neu) {
  var cache = CacheService.getScriptCache(), t = !neu && cache.get('DHL_TOKEN');
  if (t) return t;
  var c = dhlCfg_();
  if (!(c.key && c.secret && c.user && c.pass)) throw new Error('DHL_NICHT_EINGERICHTET');
  var r = UrlFetchApp.fetch(DHL_TOKEN_URL, { method: 'post', muteHttpExceptions: true, contentType: 'application/x-www-form-urlencoded',
    payload: { grant_type: 'password', username: c.user, password: c.pass, client_id: c.key, client_secret: c.secret } });
  var code = r.getResponseCode(), j = {};
  try { j = JSON.parse(r.getContentText()); } catch (e) {}
  if (code !== 200 || !j.access_token) throw new Error('DHL-Anmeldung fehlgeschlagen (' + code + '): ' + (j.error_description || j.error || j.detail || r.getContentText().slice(0, 200)));
  cache.put('DHL_TOKEN', j.access_token, Math.max(60, Math.min(21000, (Number(j.expires_in) || 1800) - 120)));
  return j.access_token;
}
function dhlFetch_(method, pfad, body) {
  var mach = function (tok) {
    var opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + tok, Accept: 'application/json', 'Accept-Language': 'de-DE' } };
    if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
    return UrlFetchApp.fetch(DHL_BASE + pfad, opt);
  };
  var r = mach(dhlToken_());
  if (r.getResponseCode() === 401) r = mach(dhlToken_(true));
  var j = {}; try { j = JSON.parse(r.getContentText() || '{}'); } catch (e) { j = { raw: r.getContentText().slice(0, 300) }; }
  return { code: r.getResponseCode(), j: j };
}
function dhlTest_(o) {
  soPruefen_(o && o.pw);
  dhlToken_(true);
  var r = dhlFetch_('get', '/', null);
  return { ok: r.code === 200, code: r.code, info: r.j && (r.j.amp || r.j.backend || r.j) };
}
/** Straße / Hausnummer trennen: "Lohmühlenweg 28b" → ["Lohmühlenweg","28b"] */
function dhlStrasse_(s) {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  var m = s.match(/^(.*?[^\d\s].*?)[\s,]+(\d+\s*[a-zA-Z]?(?:\s*[-\/]\s*\d*\s*[a-zA-Z]?)?)$/);
  if (m) return [m[1].replace(/,$/, '').trim(), m[2].replace(/\s+/g, '')];
  m = s.match(/^(\d+\s*[a-zA-Z]?)[\s,]+(.+)$/);           // "12 Hauptstraße"
  if (m) return [m[2].trim(), m[1].replace(/\s+/g, '')];
  return [s, ''];
}
function dhlCut_(s, n) { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) : s; }
/** Shopify-Bestellung → DHL-Empfänger (Hausadresse, Packstation oder Postfiliale) */
function dhlEmpfaenger_(a, email) {
  var name = dhlCut_(a.name, 50), firma = dhlCut_(a.company, 50), zeilen = [a.address1, a.address2].join(' ');
  var postNr = (zeilen.match(/(?:post\s*nr|postnummer|kundennr|kd\.?\s*nr)\.?\s*:?\s*(\d{6,10})/i) || zeilen.match(/\b(\d{6,10})\b/) || [])[1] || '';
  var ps = zeilen.match(/packstation\s*(?:nr\.?)?\s*(\d{3})/i), pf = zeilen.match(/(?:postfiliale|filiale|paketshop)\s*(?:nr\.?)?\s*(\d{3,4})/i);
  var w = [];
  if (ps || pf) {
    if (!postNr) w.push('Packstation/Filiale ohne Postnummer – DHL lehnt das ab');
    var e = { name: name || firma, postNumber: postNr, postalCode: String(a.zip || '').trim(), city: dhlCut_(a.city, 40) };
    if (ps) e.lockerID = Number(ps[1]); else e.retailID = Number(pf[1]);
    return { e: e, typ: ps ? 'Packstation ' + ps[1] : 'Postfiliale ' + pf[1], w: w };
  }
  var st = dhlStrasse_(a.address1);
  if (!st[1]) w.push('Keine Hausnummer erkannt: „' + (a.address1 || '') + '“');
  var e2 = { name1: firma || name, addressStreet: dhlCut_(st[0], 50), postalCode: String(a.zip || '').trim(), city: dhlCut_(a.city, 40), country: 'DEU' };
  if (st[1]) e2.addressHouse = dhlCut_(st[1], 10);
  if (firma && name) e2.name2 = name;
  if (a.address2) e2.additionalAddressInformation1 = dhlCut_(a.address2, 60);
  if (email) e2.email = String(email).trim();
  if (a.phone) e2.phone = dhlCut_(a.phone, 20);
  return { e: e2, typ: 'Hausadresse', w: w };
}
function dhlOrder_(id) {
  var q = 'query($id:ID!){order(id:$id){id name email phone displayFulfillmentStatus shippingAddress{name company address1 address2 zip city countryCodeV2 phone} ' +
    'lineItems(first:60){nodes{currentQuantity variant{inventoryItem{measurement{weight{value unit}}}}}}}}';
  var n = shopifyGraphQL(q, { id: 'gid://shopify/Order/' + id }).order;
  if (!n) throw new Error('Bestellung nicht gefunden');
  return n;
}
function dhlGewicht_(n) {
  var f = { KILOGRAMS: 1, GRAMS: 0.001, POUNDS: 0.4536, OUNCES: 0.02835 }, kg = 0;
  (n.lineItems.nodes || []).forEach(function (li) {
    var w = li.variant && li.variant.inventoryItem && li.variant.inventoryItem.measurement && li.variant.inventoryItem.measurement.weight;
    if (w && w.value) kg += Number(li.currentQuantity || 0) * Number(w.value) * (f[w.unit] || 1);
  });
  return Math.max(0.5, Math.ceil((kg + 0.3) * 10) / 10);   // + Verpackung, auf 100 g aufrunden
}
/** Vorbereitung: Adresse wie DHL sie bekommt + vorgeschlagenes Gewicht + vorhandenes Etikett */
function dhlVor_(o) {
  soPruefen_(o && o.pw);
  var n = dhlOrder_(String(o.id)), a = n.shippingAddress || {};
  if (String(a.countryCodeV2 || '').toUpperCase() !== 'DE') throw new Error('Nur Inland (DE) – Ausland folgt mit DHL Express');
  var em = dhlEmpfaenger_(a, n.email), st = soStaende_()[String(o.id)];
  return { empf: em.e, typ: em.typ, warn: em.w, kg: dhlGewicht_(n), dhl: (st && st.d && st.d.dhl) || null, bereit: dhlStatus_(o).bereit, fmt: dhlFormat_() };
}
function dhlFehler_(j) {
  var m = [];
  (j.items || []).forEach(function (it) { (it.validationMessages || []).forEach(function (v) { m.push((v.validationState === 'Warning' ? '⚠️ ' : '❌ ') + (v.property ? v.property + ': ' : '') + v.validationMessage); }); });
  if (!m.length && j.status) m.push((j.status.title || '') + ' ' + (j.status.detail || ''));
  if (!m.length && j.detail) m.push(j.detail);
  if (!m.length && j.title) m.push(j.title);
  return m;
}
function dhlOrdner_() {
  var p = PropertiesService.getScriptProperties(), id = p.getProperty('DHL_ORDNER');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  var f = DriveApp.createFolder('DHL-Versandetiketten'); p.setProperty('DHL_ORDNER', f.getId()); return f;
}
/**
 * Etikett prüfen (nurPruefen) oder kostenpflichtig erstellen.
 * o = { pw, id, nr, kg, prod:'V01PAK'|'V62KP', nurPruefen, druck, shopify, empf (optional korrigiert) }
 */
function dhlLabel_(o) {
  soPruefen_(o && o.pw);
  var id = String(o.id || ''); if (!/^\d+$/.test(id)) throw new Error('Bestellung fehlt');
  var prod = DHL_PROD[o.prod] ? o.prod : 'V01PAK', P = DHL_PROD[prod], kg = Math.round(Number(o.kg) * 1000) / 1000;
  if (!(kg > 0)) throw new Error('Gewicht fehlt');
  if (kg > P.max) throw new Error(P.t + ': max. ' + P.max + ' kg');
  var lock = LockService.getScriptLock(); if (!o.nurPruefen && !lock.tryLock(20000)) throw new Error('Bitte gleich nochmal versuchen');
  try {
    var st = soStaende_()[id], alt = st && st.d && st.d.dhl;
    if (!o.nurPruefen && alt && alt.nr) throw new Error('Für diese Bestellung gibt es schon ein Etikett: ' + alt.nr);
    var n = dhlOrder_(id), a = n.shippingAddress || {};
    if (String(a.countryCodeV2 || '').toUpperCase() !== 'DE') throw new Error('Nur Inland (DE)');
    var empf = o.empf || dhlEmpfaenger_(a, n.email).e;
    var ref = String(n.name || o.nr || id).replace(/[^\w\- ]/g, ' ').replace(/\s+/g, ' ').trim();
    if (ref.length < 8) ref = ('FH ' + ref + '        ').slice(0, 8).trim() + '-' + id.slice(-4);
    var body = { profile: 'STANDARD_GRUPPENPROFIL', shipments: [{ product: prod, billingNumber: P.bn, refNo: ref.slice(0, 35),
      shipDate: Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd'), shipper: DHL_ABSENDER, consignee: empf,
      details: { weight: { uom: 'kg', value: kg } } }] };
    var pfad = '/orders?' + (o.nurPruefen ? 'validate=true&' : '') + 'mustEncode=true&printFormat=' + encodeURIComponent(dhlFormat_()) + '&combine=true';
    var r = dhlFetch_('post', pfad, body), j = r.j, it = (j.items || [])[0] || {};
    var msgs = dhlFehler_(j);
    if (o.nurPruefen) return { ok: r.code < 300 && !msgs.some(function (x) { return x.charAt(0) === '❌'; }), code: r.code, msgs: msgs, empf: empf };
    if (r.code >= 300 || !it.shipmentNo || !it.label || !it.label.b64) throw new Error('DHL: ' + (msgs.join(' · ') || ('Fehler ' + r.code)));
    var nr = String(it.shipmentNo), datei = 'DHL ' + String(n.name || id).replace(/[^\w\-]+/g, '-') + ' ' + nr + '.pdf';
    var fileId = '';
    try { fileId = dhlOrdner_().createFile(Utilities.newBlob(Utilities.base64Decode(it.label.b64), 'application/pdf', datei)).getId(); } catch (e) {}
    var info = { nr: nr, prod: prod, kg: kg, at: Date.now(), by: SR_USER || '', file: fileId, ref: ref };
    var gedruckt = false, druckFehler = '';
    if (o.druck !== false) { try { srDruck_(dhlDruckName_(datei), it.label.b64); gedruckt = true; } catch (e) { druckFehler = String(e.message || e); } }
    var shop = '';
    if (o.shopify !== false) { try { shop = dhlShopifyVersand_(id, nr); } catch (e) { shop = 'Fehler: ' + (e.message || e); } }
    info.shopify = shop;
    soSetzen_({ pw: o.pw, id: id, nr: n.name || o.nr, patch: { dhl: info } });
    return { ok: true, nr: nr, b64: it.label.b64, datei: datei, gedruckt: gedruckt, druckFehler: druckFehler, shopify: shop, msgs: msgs };
  } finally { try { lock.releaseLock(); } catch (e) {} }
}
/** Etikett stornieren (geht nur, solange DHL die Sendung noch nicht bearbeitet hat – i. d. R. am selben Tag) */
function dhlStorno_(o) {
  soPruefen_(o && o.pw);
  var id = String(o.id || ''), st = soStaende_()[id], alt = st && st.d && st.d.dhl;
  if (!alt || !alt.nr) throw new Error('Kein Etikett vorhanden');
  var r = dhlFetch_('delete', '/orders?profile=STANDARD_GRUPPENPROFIL&shipment=' + encodeURIComponent(alt.nr), null);
  var msgs = dhlFehler_(r.j), ok = r.code < 300;
  if (!ok) throw new Error('DHL: ' + (msgs.join(' · ') || ('Fehler ' + r.code)));
  var verlauf = (st.d.dhlStorniert || []).concat([{ nr: alt.nr, at: Date.now(), by: SR_USER || '' }]);
  soSetzen_({ pw: o.pw, id: id, nr: o.nr, patch: { dhl: null, dhlStorniert: verlauf } });
  // automatisch auch in Shopify zurücknehmen: Versand (Fulfillment) mit dieser Sendungsnummer stornieren → Bestellung wieder „nicht ausgeführt“
  var hinweis = '';
  try {
    var fs = shopifyGraphQL('query($id:ID!){order(id:$id){fulfillments(first:20){id status trackingInfo{number}}}}', { id: 'gid://shopify/Order/' + id }).order.fulfillments || [];
    var f = fs.filter(function (x) { return x.status === 'SUCCESS' && (x.trackingInfo || []).some(function (t) { return String(t.number) === String(alt.nr); }); })[0];
    if (f) {
      var c = shopifyGraphQL('mutation($id:ID!){fulfillmentCancel(id:$id){fulfillment{id status} userErrors{field message}}}', { id: f.id }).fulfillmentCancel;
      var e = c.userErrors || [];
      hinweis = e.length ? 'Shopify: ' + e.map(function (x) { return x.message; }).join('; ') : 'Shopify: أُلغي الشحن – الطلب مفتوح من جديد.';
    }
  } catch (err) { hinweis = 'تعذّر إرجاع الطلب في Shopify: ' + (err.message || err); }
  return { ok: true, nr: alt.nr, hinweis: hinweis };
}
/** Bestellung in Shopify als versendet markieren + Sendungsnummer (Kunde bekommt die Versand-Mail von Shopify) */
function dhlShopifyVersand_(id, nr) {
  var fo = shopifyGraphQL('query($id:ID!){order(id:$id){fulfillmentOrders(first:10){nodes{id status}}}}', { id: 'gid://shopify/Order/' + id }).order.fulfillmentOrders.nodes
    .filter(function (f) { return /OPEN|IN_PROGRESS|SCHEDULED/.test(f.status); });
  if (!fo.length) return 'schon versendet';
  var url = 'https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=' + nr;
  var inp = { lineItemsByFulfillmentOrder: fo.map(function (f) { return { fulfillmentOrderId: f.id }; }), notifyCustomer: true,
    trackingInfo: { company: 'DHL', number: nr, url: url } };
  var d = shopifyGraphQL('mutation($f:FulfillmentInput!){fulfillmentCreate(fulfillment:$f){fulfillment{id status} userErrors{field message}}}', { f: inp });
  var e = d.fulfillmentCreate.userErrors || [];
  if (e.length) throw new Error(e.map(function (x) { return x.message; }).join('; '));
  return 'versendet';
}
/** Etikett nochmal drucken / als PDF holen: o = { pw, id, druck } */
function dhlDruck_(o) {
  soPruefen_(o && o.pw);
  var st = soStaende_()[String(o.id || '')], alt = st && st.d && st.d.dhl;
  if (!alt || !alt.file) throw new Error('Etikett-Datei nicht gefunden');
  var f = DriveApp.getFileById(alt.file), b64 = Utilities.base64Encode(f.getBlob().getBytes());
  if (o.druck) srDruck_(dhlDruckName_(f.getName()), b64);
  return { ok: true, b64: b64, datei: f.getName(), gedruckt: !!o.druck };
}
