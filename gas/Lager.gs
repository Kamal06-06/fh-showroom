/* =====================================================================
   Lager.gs – Bestandsführung Fragrance Hub
   Tabelle "Lager Fragrance Hub": Bestand | Bewegungen | Einstellungen
   Quellen: Shopify (bezahlt / storniert / erstattet), Showroom (Angebot,
   Änderung, Löschen), Wareneingang, Ausgang, Inventur. WhatsApp-Alarm bei
   Unterschreitung des Mindestbestands, Wochenbericht montags.
   Einmalig: lagerEinrichten()  (baut Bestand aus dem Katalog auf + Trigger)
   Neu sortieren / neue Artikel aufnehmen: lagerBestandAufbauen()
   ===================================================================== */
var LAGER_SHEET_ID = '1BQBLp03qNfUmu3VEIx5UR0BBYbb-SoUJ33vhL0jnioc';

function lagerSS_() { return SpreadsheetApp.openById(LAGER_SHEET_ID); }
function lagerIstAlkohol_(t) { return /alkohol|alcohol|ethanol/i.test(String(t || '')); }

/* ---------------- Schlüssel & Mengen ---------------- */
// Öl: CODE|S / CODE|P / CODE|E   – Flakons/Zubehör: Modell-SKU ohne Stückzahl-Endung, Alkohol: SKU
function lagerKey_(code, tier, oil) {
  code = String(code || '').trim().toUpperCase();
  if (!code) return '';
  if (!oil) return code.replace(/-\d{4}$/, '');          // Flakon-Modell: Stückzahl-Endung weg
  var tl = String(tier || 'Standard').trim().charAt(0).toUpperCase();
  if (tl !== 'S' && tl !== 'P' && tl !== 'E') tl = 'S';
  return code + '|' + tl;
}
function lagerTierName_(key) { return ({ S: 'Standard', P: 'Premium', E: 'Exklusiv' })[String(key).split('|')[1]] || ''; }

// "250 g" -> 0.25 (kg) | "5 Liter" -> 5 (L) | "80 Stück / Schwarz" -> 80
function lagerMenge_(size, unit) {
  var s = String(size || '').toLowerCase().replace(',', '.');
  if (unit === 'Stück') { var st = s.match(/(\d+)\s*st/); return st ? parseInt(st[1], 10) : 1; }
  var m = s.match(/([\d.]+)\s*(kg|g|ml|liter|l)\b/);
  if (!m) return 1;
  var v = parseFloat(m[1]), u = m[2];
  return (u === 'g' || u === 'ml') ? v / 1000 : v;
}
function lagerEinheit_(oil, title) { return oil ? 'kg' : (lagerIstAlkohol_(title) ? 'L' : 'Stück'); }

/* ---------------- Einstellungen & Bestand ---------------- */
var LAGER_EINST_ = null;
function lagerEinstellung_(name, def) {
  if (!LAGER_EINST_) {
    var sh = lagerSS_().getSheetByName('Einstellungen');
    LAGER_EINST_ = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  }
  for (var i = 0; i < LAGER_EINST_.length; i++) if (String(LAGER_EINST_[i][0]).trim() === name) return LAGER_EINST_[i][1] === '' ? def : LAGER_EINST_[i][1];
  return def;
}
function lagerMinFuer_(unit, tierName) {
  if (unit === 'kg') return Number(lagerEinstellung_('Mindestbestand Öl (kg) ' + (tierName || 'Standard'), 1)) || 0;
  if (unit === 'L') return Number(lagerEinstellung_('Mindestbestand Alkohol (L)', 10)) || 0;
  return Number(lagerEinstellung_('Mindestbestand Flakons/Zubehör (Stück)', 20)) || 0;
}
function lagerBestandMap_() {
  var sh = lagerSS_().getSheetByName('Bestand');
  var last = sh.getLastRow(), map = {}, rows = [];
  if (last >= 2) {
    rows = sh.getRange(2, 1, last - 1, 10).getValues();
    rows.forEach(function (r, i) { if (r[0]) map[String(r[0])] = { row: i + 2, data: r }; });
  }
  return { sheet: sh, map: map, rows: rows };
}
function lagerStatus_(bestand, min) { return bestand <= 0 ? 'LEER' : (bestand < min ? 'NIEDRIG' : 'OK'); }

/**
 * Zentrale Buchung. qty < 0 = Abgang, qty > 0 = Zugang.
 * item: { code, tier, oil, title, orig }
 */
function lagerBuche_(quelle, referenz, kunde, item, qty, notiz) {
  var key = lagerKey_(item.code, item.tier, item.oil);
  if (!key || !qty) return null;
  var lock = LockService.getScriptLock(); lock.waitLock(30000);
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
    lagerSS_().getSheetByName('Bewegungen').appendRow([new Date(), quelle, referenz || '', kunde || '', key, key.split('|')[0], tierName, qty, neu, notiz || '']);
    if (qty < 0 && bestand >= min && neu < min && String(lagerEinstellung_('Alarm bei Unterschreitung', 'JA')).toUpperCase() === 'JA')
      lagerAlarm_(key, item.title || (e && e.data[3]) || '', tierName, neu, min, unit);
    return neu;
  } finally { lock.releaseLock(); }
}

/* ---------------- Benachrichtigung (WhatsApp über CallMeBot wie bei den Etiketten) ---------------- */
function lagerWhatsApp_(text) {
  var nummer = String(lagerEinstellung_('WhatsApp-Nummer Alarm', '') || '').trim();
  var key = PropertiesService.getScriptProperties().getProperty('CALLMEBOT_APIKEY');
  if (!nummer || !key) { if (typeof etTelegram_ === 'function') etTelegram_(text, null); return; }
  try {
    var r = UrlFetchApp.fetch('https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(nummer) +
      '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(key), { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) Logger.log('WhatsApp-Fehler ' + r.getResponseCode());
  } catch (e) { Logger.log('WhatsApp nicht gesendet: ' + e.message); }
}
function lagerAlarm_(key, title, tier, neu, min, unit) {
  lagerWhatsApp_('⚠️ Lager niedrig\n' + (title || key) + (tier ? ' – ' + tier : '') + '\nCode: ' + key.split('|')[0] +
                 '\nBestand: ' + neu + ' ' + unit + ' (Minimum ' + min + ' ' + unit + ')');
}
function lagerWochenbericht() {
  var low = lagerNiedrig();
  if (!low.length) { lagerWhatsApp_('📦 Lager – Wochenbericht: alle Artikel über dem Mindestbestand ✅'); return; }
  lagerWhatsApp_('📦 Lager – Wochenbericht\nNiedrig/leer: ' + low.length + '\n\n' +
    low.slice(0, 50).map(function (x) { return (x.status === 'LEER' ? '🔴 ' : '🟠 ') + x.title + (x.tier ? ' (' + x.tier + ')' : '') + ': ' + x.bestand + ' ' + x.unit; }).join('\n') +
    (low.length > 50 ? '\n… +' + (low.length - 50) + ' weitere' : ''));
}

/* ---------------- Showroom ---------------- */
// items wie in Showroom-Daten: {q, t, a, oil, tier, code, size, sku, price}
function lagerShowroomMengen_(items) {
  var out = {};
  (items || []).forEach(function (it) {
    if (!it || !it.code) return;
    var oil = !!it.oil, unit = lagerEinheit_(oil, it.t);
    var key = lagerKey_(it.code, it.tier, oil);
    var menge = (Number(it.q) || 0) * lagerMenge_(it.size, unit);
    if (!out[key]) out[key] = { item: { code: it.code, tier: it.tier, oil: oil, title: it.t, orig: it.a || '' }, qty: 0 };
    out[key].qty += menge;
  });
  return out;
}
/** Bucht nur die Differenz zwischen alten und neuen Positionen eines Auftrags. */
// Inventur-Start: Aufträge, die VOR diesem Zeitpunkt angelegt wurden, buchen bei Änderung/Löschen nichts mehr
function lagerInvStart_() {
  var sh = lagerSS_().getSheetByName('Einstellungen'), v = sh.getRange(1, 1, sh.getLastRow(), 2).getValues();
  for (var i = 0; i < v.length; i++) if (v[i][0] === 'Inventur-Start (Showroom)') { var d = v[i][1]; return d instanceof Date ? d.getTime() : (Number(d) || 0); }
  return 0;
}
function lagerShowroomSync_(orderId, kunde, newItems, oldItems, at) {
  if (oldItems && at && Number(at) < lagerInvStart_()) return;
  var n = lagerShowroomMengen_(newItems), o = lagerShowroomMengen_(oldItems), keys = {};
  Object.keys(n).concat(Object.keys(o)).forEach(function (k) { keys[k] = 1; });
  Object.keys(keys).forEach(function (k) {
    var diff = (n[k] ? n[k].qty : 0) - (o[k] ? o[k].qty : 0);
    if (Math.abs(diff) < 0.0005) return;
    try { lagerBuche_('Showroom', orderId, kunde, (n[k] || o[k]).item, -diff, diff > 0 ? (oldItems ? 'Angebot geändert' : 'Angebot') : (newItems && newItems.length ? 'Position verringert' : 'Auftrag gelöscht')); }
    catch (e) { Logger.log('Lager Showroom ' + k + ': ' + e.message); }
  });
}

/* ---------------- Shopify ---------------- */
/** SKU → { item, menge }   CODE-SH-S-1KG | GL-…-0080 (Modell + Stück) | FH-AD96-SH ("5 Liter") */
function lagerParseSku_(sku, title, variantTitle) {
  sku = String(sku || '').trim().toUpperCase();
  if (!sku) return null;
  var m = sku.match(/^(.*-SH)-([SPE])-(\d+(?:[.,]\d+)?)(KG|G|ML|L)$/);
  if (m) return { item: { code: m[1], tier: m[2], oil: true, title: title }, menge: lagerMenge_(m[3] + ' ' + m[4].toLowerCase(), 'kg') };
  if (lagerIstAlkohol_(title)) return { item: { code: sku, tier: '', oil: false, title: title }, menge: lagerMenge_(variantTitle, 'L') };
  m = sku.match(/^(.*)-(\d{4})$/);
  if (m) return { item: { code: m[1], tier: '', oil: false, title: title }, menge: parseInt(m[2], 10) || 1 };
  return { item: { code: sku, tier: '', oil: false, title: title }, menge: lagerMenge_(variantTitle, 'Stück') };
}
function lagerOrderKunde_(o) {
  var a = o.billingAddress || o.shippingAddress || {};
  return (a.company || ((a.firstName || '') + ' ' + (a.lastName || '')).trim() || o.email || '').trim();
}
/** faktor -1 = Abgang (bezahlt), +1 = Rückbuchung (storniert/erstattet) */
function lagerShopifyBuchen_(o, faktor, notiz) {
  (o.lineItems.nodes || []).forEach(function (li) {
    var p = lagerParseSku_(li.sku, li.title, li.variantTitle);
    if (!p) return;
    var q = Number(li.quantity) || 0;
    if (q) lagerBuche_('Shopify', o.name, lagerOrderKunde_(o), p.item, faktor * q * p.menge, notiz);
  });
}
/** Alle 15 Minuten: bezahlte Bestellungen abziehen, Stornos/Erstattungen zurückbuchen. */
function lagerShopifyLauf() {
  var lock = LockService.getScriptLock(); if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var since = props.getProperty('LAGER_SHOPIFY_SINCE') || new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    var jetzt = new Date(Date.now() - 60 * 1000).toISOString();   // 1 Min. Überlappung
    var felder = 'id name email cancelledAt displayFinancialStatus billingAddress { firstName lastName company } ' +
                 'lineItems(first: 250) { nodes { sku title variantTitle quantity } }';
    var q = 'updated_at:>=' + JSON.stringify(since).replace(/"/g, '\'') + ' (financial_status:paid OR financial_status:partially_refunded OR financial_status:refunded OR status:cancelled)';
    var cursor = null, alle = [];
    do {
      var d = shopifyGraphQL('query($q: String!, $c: String) { orders(first: 100, after: $c, query: $q, sortKey: UPDATED_AT) { pageInfo { hasNextPage endCursor } nodes { ' + felder + ' } } }', { q: q, c: cursor });
      alle = alle.concat(d.orders.nodes); cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    } while (cursor);
    // Inventur-Start: Bestellungen bis zu dieser Nummer werden nie abgezogen (Einstellungen)
    var abNr = 0, esh = lagerSS_().getSheetByName('Einstellungen'), ev = esh.getRange(1, 1, esh.getLastRow(), 2).getValues();
    for (var j = 0; j < ev.length; j++) if (ev[j][0] === 'Abzug erst nach Bestellnr.') abNr = Number(ev[j][1]) || 0;
    alle.forEach(function (o) {
      var nr = parseInt(String(o.name || '').replace(/\D/g, ''), 10) || 0;
      if (abNr && nr && nr <= abNr) return;
      var id = String(o.id).split('/').pop(), kAb = 'LAGER_AB_' + id, kZu = 'LAGER_ZU_' + id;
      var gebucht = !!props.getProperty(kAb), zurueck = !!props.getProperty(kZu);
      var storno = !!o.cancelledAt || o.displayFinancialStatus === 'REFUNDED';
      var bezahlt = ['PAID', 'PARTIALLY_REFUNDED', 'REFUNDED'].indexOf(o.displayFinancialStatus) >= 0;
      if (!gebucht && bezahlt && !storno) { lagerShopifyBuchen_(o, -1, 'Bestellung bezahlt'); props.setProperty(kAb, '1'); }
      else if (gebucht && storno && !zurueck) { lagerShopifyBuchen_(o, +1, o.cancelledAt ? 'Storniert' : 'Erstattet'); props.setProperty(kZu, '1'); }
    });
    props.setProperty('LAGER_SHOPIFY_SINCE', jetzt);
    var sh = lagerSS_().getSheetByName('Einstellungen'), vals = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
    for (var i = 0; i < vals.length; i++) if (vals[i][0] === 'Letzter Shopify-Lauf') sh.getRange(i + 1, 2).setValue(new Date());
  } finally { lock.releaseLock(); }
}

/* ---------------- Wareneingang / Ausgang / Inventur / Abfragen (Web-App) ---------------- */
function lagerWareneingang(code, tier, oil, menge, title, notiz) {
  menge = Math.abs(Number(String(menge).replace(',', '.')) || 0);
  if (!menge) throw new Error('Menge fehlt');
  return lagerBuche_('Wareneingang', notiz || 'Aromabelle', '', { code: code, tier: tier, oil: !!oil, title: title }, menge, 'Wareneingang');
}
function lagerAusgang(code, tier, oil, menge, title, notiz) {
  menge = Math.abs(Number(String(menge).replace(',', '.')) || 0);
  if (!menge) throw new Error('Menge fehlt');
  return lagerBuche_('Ausgang', notiz || '', '', { code: code, tier: tier, oil: !!oil, title: title }, -menge, 'Ausgang ohne Auftrag');
}
function lagerInventur(code, tier, oil, ist, title) {
  ist = Number(String(ist).replace(',', '.'));
  if (isNaN(ist)) throw new Error('Menge fehlt');
  var key = lagerKey_(code, tier, !!oil), bm = lagerBestandMap_();
  var alt = bm.map[key] ? Number(bm.map[key].data[6]) || 0 : 0, diff = ist - alt;
  if (Math.abs(diff) < 0.0005) return alt;
  return lagerBuche_('Inventur', '', '', { code: code, tier: tier, oil: !!oil, title: title }, diff, 'Inventur (vorher ' + alt + ')');
}
function lagerBestandVon(code, tier, oil) {
  var e = lagerBestandMap_().map[lagerKey_(code, tier, !!oil)];
  return e ? { bestand: Number(e.data[6]) || 0, min: Number(e.data[8]) || 0, status: e.data[9], unit: e.data[5], title: e.data[3] } : { bestand: 0, min: 0, status: 'LEER', unit: lagerEinheit_(!!oil, ''), title: '' };
}
function lagerNiedrig() {
  return lagerBestandMap_().rows.filter(function (r) { return r[9] === 'NIEDRIG' || r[9] === 'LEER'; })
    .map(function (r) { return { code: r[1], tier: r[2], title: r[3], bestand: r[6], min: r[8], unit: r[5], status: r[9] }; });
}
function lagerBewegungen(code, tier, oil, n) {
  var key = lagerKey_(code, tier, !!oil), sh = lagerSS_().getSheetByName('Bewegungen'), last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, 10).getValues().filter(function (r) { return r[4] === key; });
  return rows.slice(-(n || 20)).reverse().map(function (r) { return { at: r[0] instanceof Date ? r[0].getTime() : r[0], quelle: r[1], ref: r[2], kunde: r[3], menge: r[7], danach: r[8], notiz: r[9] }; });
}
function lagerMinSetzen(code, tier, oil, min) {
  var key = lagerKey_(code, tier, !!oil), bm = lagerBestandMap_(), e = bm.map[key];
  if (!e) throw new Error('Artikel nicht im Bestand');
  min = Number(String(min).replace(',', '.')) || 0;
  bm.sheet.getRange(e.row, 9).setValue(min);
  bm.sheet.getRange(e.row, 10).setValue(lagerStatus_(Number(e.data[6]) || 0, min));
  return true;
}

/* ---------------- Erstbefüllung aus Inventur-Liste  (Zeilen: Code;Qualität;Menge) ---------------- */
function lagerImportInventur(text) {
  var n = 0;
  String(text || '').split(/\r?\n/).forEach(function (l) {
    var p = l.split(/[;,\t]/).map(function (s) { return s.trim(); });
    if (p.length < 3 || !p[0]) return;
    var menge = parseFloat(p[2].replace(',', '.')); if (isNaN(menge)) return;
    var oil = /-SH(-|$)/i.test(p[0]) && !/^FH-/i.test(p[0]);
    lagerInventur(p[0], p[1], oil, menge, ''); n++;
  });
  return n;
}

/* ---------------- Einrichtung ---------------- */
/** Baut die Bestandsliste sortiert aus dem Katalog auf: Öle nach Marke/Name/Qualität, danach Flakons & Zubehör (1 Zeile je Modell). Vorhandene Bestände/Mindestmengen bleiben erhalten. */
function lagerBestandAufbauen() {
  var items = JSON.parse(srCatalog_()).items, bm = lagerBestandMap_();
  var alt = {};                                   // Key -> {bestand, min}
  bm.rows.forEach(function (r) { if (!r[0]) return; var k = lagerKey_(r[1], r[2], !!r[2] || r[5] === 'kg'); if (!alt[k]) alt[k] = { bestand: 0, min: Number(r[8]) || 0 }; alt[k].bestand += Number(r[6]) || 0; });
  var oele = [], rest = [], seen = {};
  var tierOrd = { Standard: 0, Premium: 1, Exklusiv: 2 };
  items.forEach(function (p) {
    if (p.o === 1) {
      p.v.forEach(function (v) {
        var m = String(v[1] || '').toUpperCase().match(/^(.*-SH)-([SPE])-/); if (!m) return;
        var key = m[1] + '|' + m[2]; if (seen[key]) return; seen[key] = 1;
        var tn = lagerTierName_(key);
        oele.push({ sort: [String(p.a || p.t).toLowerCase(), String(p.t).toLowerCase(), tierOrd[tn] || 0], row: [key, m[1], tn, p.t, p.a || '', 'kg', 0, 0, lagerMinFuer_('kg', tn), 'LEER'] });
      });
    } else {
      p.v.forEach(function (v) {
        var key = lagerKey_(v[1], '', false); if (!key || seen[key]) return; seen[key] = 1;
        var unit = lagerEinheit_(false, p.t), farbe = String(v[0] || '').split(' / ').slice(1).join(' / ').trim();
        rest.push({ sort: [String(p.t).toLowerCase(), farbe.toLowerCase()], row: [key, key, '', p.t + (farbe ? ' – ' + farbe : ''), '', unit, 0, 0, lagerMinFuer_(unit, ''), 'LEER'] });
      });
    }
  });
  var cmp = function (a, b) { for (var i = 0; i < a.sort.length; i++) { if (a.sort[i] < b.sort[i]) return -1; if (a.sort[i] > b.sort[i]) return 1; } return 0; };
  oele.sort(cmp); rest.sort(cmp);
  var rows = oele.concat(rest).map(function (x) {
    var a = alt[x.row[0]]; if (a) { x.row[6] = Math.round(a.bestand * 1000) / 1000; x.row[8] = a.min; x.row[9] = lagerStatus_(x.row[6], a.min); }
    return x.row;
  });
  var sh = bm.sheet;
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 10).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, 10).setValues(rows);
  Logger.log('Bestandszeilen: ' + rows.length + ' (Öle ' + oele.length + ', Flakons/Zubehör ' + rest.length + ')');
  return rows.length;
}
function lagerEinrichten() {
  var n = lagerBestandAufbauen();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['lagerShopifyLauf', 'lagerWochenbericht'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lagerShopifyLauf').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('lagerWochenbericht').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).create();
  PropertiesService.getScriptProperties().setProperty('LAGER_SHOPIFY_SINCE', new Date().toISOString());
  Logger.log('Lager eingerichtet. Zeilen: ' + n + '. Tabelle: https://docs.google.com/spreadsheets/d/' + LAGER_SHEET_ID);
}
