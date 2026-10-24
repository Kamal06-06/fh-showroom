/* =====================================================================
   Planung.gs – Absatzdaten aus Shopify für
     (1) Bestellvorschlag an das Werk (Verbrauch je Öl + Qualität)
     (2) Kundenprofile & Reaktivierung (letzte Bestellung, Rhythmus, Umsatz)
   Blatt "Auftragsdaten" in der Lager-Tabelle: eine Zeile je Shopify-Bestellung (12 Monate),
   stündlich nachgeführt (plSync). Erstbefüllung läuft automatisch in mehreren Schritten.
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
    return { fertig: fertig, neu: neu, geaendert: geaendert, zeilen: rows.length };
  } finally { lock.releaseLock(); }
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
  var k30 = {}, k90 = {}, n90 = {};
  plZeilen_().forEach(function (r) {
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
  return { at: jetzt, kg30: r3(k30), kg90: r3(k90), n90: n90, min: min, stand: plStand_() };
}

/** Kundenprofile aus dem Shop (12 Monate): je Kunde Bestellungen, Umsatz, erste/letzte Bestellung, Rhythmus, Top-Artikel */
function plKunden_() {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  var cache = CacheService.getScriptCache(), c = cache.get('PL_KUNDEN');
  if (c) return c;
  var grenze = new Date(Date.now() - 365 * 864e5).toISOString(), m = {};
  plZeilen_().forEach(function (r) {
    if (r[3] !== 'ja' || String(r[2]) < grenze) return;
    var key = r[4] ? 'S' + r[4] : 'E' + String(r[7] || r[5]).toLowerCase();
    var k = m[key] = m[key] || { id: String(r[4] || ''), n: '', f: '', e: '', p: '', c: '', o: 0, u: 0, d: [], a: {} };
    k.n = String(r[5] || k.n); if (r[6]) k.f = String(r[6]); if (r[7]) k.e = String(r[7]); if (r[8]) k.p = String(r[8]); if (r[9]) k.c = String(r[9]);
    k.o++; k.u += Number(r[10]) || 0; k.d.push(String(r[2]).slice(0, 10));
    String(r[12] || '').split('|').forEach(function (x) { var t = x.replace(/×\d+$/, '').trim(); if (t) k.a[t] = (k.a[t] || 0) + 1; });
  });
  var out = Object.keys(m).map(function (key) {
    var k = m[key]; k.d.sort();
    var top = Object.keys(k.a).sort(function (a, b) { return k.a[b] - k.a[a]; }).slice(0, 3);
    return { id: k.id, n: k.n, f: k.f, e: k.e, p: k.p, c: k.c, o: k.o, u: Math.round(k.u * 100) / 100, d: k.d, t: top };
  }).filter(function (k) { return k.u > 0; });
  var s = JSON.stringify({ at: Date.now(), stand: plStand_(), k: out });
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
