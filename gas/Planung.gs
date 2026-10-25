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
  var s = JSON.stringify({ at: Date.now(), stand: plStand_(), k: out, kontakt: plKontakte_(), abmeld: plAbmeldungen_() });
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
