/**
 * Proben-Gramm.gs – Proben pro Gramm (6–20 g)
 * Die Probe-Variante heißt im Shop "Probe pro Gramm (6–20 g) / Qualität"; die bestellte Menge = Gramm.
 * Diese Datei MUSS die letzte Datei im Projekt sein: die Funktionen hier ersetzen die gleichnamigen weiter oben.
 *  - Etiketten: 1 Proben-Etikett mit der bestellten Grammzahl (z.B. 10 g) statt 10 Etiketten
 *  - Probiersets: nehmen weiter die Probe als 6 g
 *  - Showroom: Probe erscheint weiter als "6 g" mit Preis = 6 × Grammpreis
 *  - Grundpreis: 1 g → € / 1 kg
 *  - Lager: läuft über die SKU-Endung -1G automatisch (0,001 kg je Gramm), keine Änderung nötig
 */

/* ---------- Etiketten-Absicherung (23.10.2026) ----------
 * 1. Duftöl laut Shopify-Produkttyp, das NICHT in der Code-Tabelle steht → bekommt trotzdem ein Etikett
 *    (Standard-Vorlage) + Warnung, statt still als „Zubehör" in der Packliste zu landen.
 * 2. Telegram mit Wiederholung (auch bei „zu viele Nachrichten"). Kommt ein Etiketten-PDF nicht an,
 *    wird die Bestellung NICHT als erledigt markiert → nächster Lauf sendet die fehlenden Teile erneut.
 * 3. etikettenPruefung(): prüft die letzten Bestellungen und listet Duftöle, die kein Etikett bekommen hätten.
 */

function etHoleBestellungen_(q, first) {
  var adr = 'billingAddress { firstName lastName company countryCodeV2 } ' +
            'shippingAddress { firstName lastName company countryCodeV2 } ';
  var adrKurz = 'billingAddress { firstName lastName company } ';
  var li = 'sku title variantTitle quantity currentQuantity';
  var typ = ' product { productType }';
  var qr = ' variant { legacyResourceId } product { handle productType }';
  var ca = ' customAttributes { key value }';
  var stufen = [[adr, li + qr + ca], [adr, li + typ + ca], [adrKurz, li + qr + ca], [adrKurz, li + typ + ca],
                [adr, li + qr], [adr, li + typ], [adrKurz, li + typ], [adrKurz, li]];
  var fehler = null;
  for (var i = 0; i < stufen.length; i++) {
    try {
      var orders = shopifyGraphQL('query($q: String!, $first: Int!) { orders(first: $first, query: $q, sortKey: CREATED_AT) { nodes { ' +
        'id name tags ' + stufen[i][0] + 'lineItems(first: 250) { nodes { ' + stufen[i][1] + ' } } } } }',
        { q: q, first: first }).orders.nodes;
      return orders.map(psErweitere_);
    } catch (e) {
      fehler = e;
      Logger.log('Abfrage-Stufe ' + (i + 1) + ' fehlgeschlagen: ' + e.message.slice(0, 200));
    }
  }
  throw fehler;
}

/** Ordnet eine Bestellposition ein: oel (mit Tabellen-Eintrag), set (Probierset ungelöst) oder zubehoer */
function etKlassifiziere_(li, map) {
  var sku = normalize(li.sku);
  var typ = String((li.product && li.product.productType) || '');
  var istOelTyp = /fragrance\s*oil|duft\s*öl|duftoel/i.test(typ);
  var text = li.title + ' ' + (li.variantTitle || '');
  var skuFix = String(li.sku || '').replace(/-SH-PQ(?=-|$)/i, '-PQ-SH');
  var entry = sku ? (lookupSku(normalize(skuFix), map) ||
                     lookupSku(normalize(skuFix.replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '')), map)) : null;
  if (entry) {
    if (!istOelTyp && ET_KEIN_OEL.test(text)) return { art: 'zubehoer' };
    return { art: 'oel', entry: entry };
  }
  if (/^Probierset/i.test(li.title)) return { art: 'set' };
  if (istOelTyp) {
    var stamm = String(li.sku || '').toUpperCase().replace(/^(.*?-SH)(-.*)?$/, '$1');
    return { art: 'oel', entry: { shop: stamm || String(li.sku || ''), factory: '' }, unbekannt: true };
  }
  return { art: 'zubehoer' };
}

function etVerarbeiteBestellung_(order, map) {
  var land = (order.shippingAddress && order.shippingAddress.countryCodeV2) ||
             (order.billingAddress && order.billingAddress.countryCodeV2) || '';
  var positionen = [], probenPos = [], fehlend = [], zubehoer = [], unbekannt = [];

  order.lineItems.nodes.forEach(function (li) {
    var titel = li.title + (li.variantTitle ? ' – ' + li.variantTitle : '');
    var menge = (li.currentQuantity !== null && li.currentQuantity !== undefined ? li.currentQuantity : li.quantity) || 0;
    if (!menge) return;
    var k = etKlassifiziere_(li, map);
    if (k.art === 'set') { fehlend.push(menge + ' × ' + li.title + ' – Düfte nicht erkannt, Etiketten bitte manuell'); return; }
    if (k.art === 'zubehoer') { zubehoer.push({ menge: menge, name: etKurzname_(li) }); return; }
    var entry = k.entry;
    if (k.unbekannt) unbekannt.push(etKurzname_(li) + ' [' + (li.sku || 'ohne SKU') + ']');
    var v = etVariante_(li.variantTitle);
    // Probe pro Gramm: Menge im Shop = Gramm → 1 Etikett mit dieser Grammzahl
    if (/pro\s*gramm/i.test(li.variantTitle || '')) { v.gewicht = menge + ' g'; v.probe = true; menge = 1; }
    if (!v.gewicht) { fehlend.push(menge + ' × ' + titel + ' – keine Gewichtsangabe, Etikett fehlt'); return; }
    if (v.probe) {
      probenPos.push({ fabrikCode: entry.factory || '', sku: entry.shop, qualitaet: v.qualitaet,
                       gewicht: v.gewicht || '6 g', menge: menge, produkt: li.title });
      return;
    }
    positionen.push({ qrUrl: etQrUrl_(li), fabrikCode: entry.factory || '', sku: entry.shop,
                      qualitaet: v.qualitaet, gewicht: v.gewicht, menge: menge, titel: titel, produkt: li.title });
  });

  if (!positionen.length && !probenPos.length && !fehlend.length) {
    Logger.log(order.name + ': keine Duftöle – nichts zu tun');
    return;
  }

  var res = positionen.length
    ? erstelleEtikettenPdf_({ name: order.name, laenderCode: land || 'DE', positionen: positionen })
    : { pdf: null, anzahl: 0, inhalt: [], fehlend: [], vorlagen: [], sprachen: etSprachen_(land || 'DE') };
  fehlend = fehlend.concat(res.fehlend);
  var probenPdf = probenPos.length ? erstelleProbenPdf_(order.name, probenPos) : null;

  var datei = (etNr_(order) + (etKunde_(order) ? ' - ' + etKunde_(order) : '')).replace(/[\\\/:*?"<>|]/g, '');
  if (res.pdf) res.pdf.setName(datei + ' - Duftöle.pdf');
  if (probenPdf && probenPdf.pdf) probenPdf.pdf.setName(datei + ' - Proben.pdf');

  var kopf = etKopf_(order);
  var props = PropertiesService.getScriptProperties();
  var oid = String(order.id || order.name).replace(/\D/g, '');
  var nichtGesendet = [];
  var sende = function (teil, text, pdf) {
    var key = 'etks_' + oid + '_' + teil;
    if (props.getProperty(key)) return;                 // schon in einem früheren Lauf angekommen
    if (etTelegramSicher_(text, pdf)) props.setProperty(key, '1');
    else nichtGesendet.push(teil);
  };

  if (res.pdf) {
    var m = etMengenZeilen_(positionen);
    sende('d', kopf + '\n🏷️ Duftöl-Etiketten\n' + m.zeilen.join('\n') + '\nGesamt: ' + m.gesamt + ' Etiketten' +
      (res.sprachen.join('') !== 'DE' ? '\n🌍 Sprache: ' + res.sprachen.join(' + ') : ''), res.pdf);
  }
  if (probenPdf && probenPdf.pdf) {
    var mp = etMengenZeilen_(probenPos);
    sende('p', kopf + '\n🧪 Proben\n' + mp.zeilen.join('\n') + '\nGesamt: ' + mp.gesamt + ' Etiketten', probenPdf.pdf);
  }
  if (zubehoer.length) {
    sende('z', kopf + '\n📋 Bitte mitpacken (ohne Etikett):\n' +
      zubehoer.map(function (z) { return '  ' + z.menge + ' × ' + z.name; }).join('\n'), null);
  }
  var warn = fehlend.slice();
  if (unbekannt.length) warn.push('Duftöl fehlt in der Code-Tabelle (Sheet1) – Etikett mit Standard-Vorlage gedruckt, bitte SKU + Fabrik-Code eintragen: ' + unbekannt.join(', '));
  else if (res.vorlagen.length) warn.push('Mit Standard-Vorlage (SDB fehlt): ' + res.vorlagen.join(', '));
  if (warn.length) sende('w', kopf + '\n⚠️ Bitte prüfen:\n- ' + warn.join('\n- '), null);

  if (nichtGesendet.length) {
    throw new Error('Telegram hat nicht alles angenommen (' + nichtGesendet.join(',') +
                    ') – die fehlenden Teile werden beim nächsten Lauf automatisch erneut gesendet.');
  }
  ['d', 'p', 'z', 'w'].forEach(function (t) { props.deleteProperty('etks_' + oid + '_' + t); });

  if (ETIKETT.emailSenden) {
    var anh = [res.pdf, probenPdf && probenPdf.pdf].filter(Boolean);
    GmailApp.sendEmail(ETIKETT.empfaenger, 'Etiketten ' + etNr_(order) + ' – ' + (etKunde_(order) || ''),
      kopf + (warn.length ? '\n⚠️ ' + warn.join('\n⚠️ ') : ''), { name: 'Fragrance Hub Etiketten', attachments: anh });
  }
  Logger.log(order.name + ': ' + (res.anzahl || 0) + ' Etiketten, ' + (probenPdf ? probenPdf.anzahl : 0) +
             ' Proben, ' + zubehoer.length + ' Zubehör-Positionen' + (unbekannt.length ? ', ' + unbekannt.length + ' Duftöl(e) ohne Tabellen-Eintrag' : ''));
}

/** Telegram mit bis zu 4 Versuchen; beachtet „retry_after" (zu viele Nachrichten). true = angekommen */
function etTelegramSicher_(text, pdf) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN'), chat = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) { Logger.log('Telegram nicht eingerichtet (TELEGRAM_TOKEN / TELEGRAM_CHAT_ID)'); return false; }
  var base = 'https://api.telegram.org/bot' + token + '/';
  for (var v = 1; v <= 4; v++) {
    var warte = 3 * v;
    try {
      var r = pdf
        ? UrlFetchApp.fetch(base + 'sendDocument', { method: 'post', muteHttpExceptions: true,
            payload: { chat_id: chat, caption: String(text).slice(0, 1000), document: pdf.copyBlob() } })
        : UrlFetchApp.fetch(base + 'sendMessage', { method: 'post', muteHttpExceptions: true,
            payload: { chat_id: chat, text: String(text).slice(0, 4000) } });
      if (r.getResponseCode() === 200) return true;
      Logger.log('Telegram-Fehler ' + r.getResponseCode() + ' (Versuch ' + v + '): ' + r.getContentText().slice(0, 200));
      try {
        var j = JSON.parse(r.getContentText());
        if (j.parameters && j.parameters.retry_after) warte = Math.min(Number(j.parameters.retry_after) + 1, 40);
      } catch (e) {}
    } catch (e) {
      Logger.log('Telegram nicht erreichbar (Versuch ' + v + '): ' + e.message);
    }
    if (v < 4) Utilities.sleep(warte * 1000);
  }
  return false;
}

/**
 * Kontrolle (sendet nichts): prüft die Bestellungen der letzten ETIKETT_PRUEF_TAGE Tage und schreibt ins Blatt
 * "Etiketten-Prüfung", welche Duftöl-Positionen mit der ALTEN Logik kein Etikett bekommen hätten.
 */
var ETIKETT_PRUEF_TAGE = 14;
function etikettenPruefung() {
  var start = Date.now();
  var ab = new Date(Date.now() - ETIKETT_PRUEF_TAGE * 864e5).toISOString().slice(0, 10);
  var map = loadCodeMap();
  var zeilen = [], cursor = null, anzahl = 0;
  do {
    var d = shopifyGraphQL('query($c: String, $q: String!) { orders(first: 15, after: $c, query: $q, sortKey: CREATED_AT, reverse: true) { ' +
      'pageInfo { hasNextPage endCursor } nodes { id name tags lineItems(first: 60) { nodes { ' +
      'sku title variantTitle quantity currentQuantity product { productType } customAttributes { key value } } } } } }',
      { c: cursor, q: 'created_at:>=' + ab + ' -status:cancelled' }).orders;
    d.nodes.forEach(function (o) {
      anzahl++;
      psErweitere_(o);
      o.lineItems.nodes.forEach(function (li) {
        var menge = (li.currentQuantity !== null && li.currentQuantity !== undefined ? li.currentQuantity : li.quantity) || 0;
        if (!menge) return;
        var k = etKlassifiziere_(li, map);
        var istOel = /fragrance\s*oil/i.test(String((li.product && li.product.productType) || ''));
        var grund = '';
        if (k.art === 'set') grund = 'Probierset-Duft nicht gefunden';
        else if (k.unbekannt) grund = 'Duftöl fehlt in Code-Tabelle (früher: kein Etikett, nur Packliste)';
        else if (istOel && k.art === 'zubehoer') grund = 'Duftöl als Zubehör erkannt';
        if (grund) zeilen.push([o.name, li.title, li.variantTitle || '', li.sku || '', menge, grund,
                                (o.tags || []).indexOf(ETIKETT.tag) > -1 ? 'ja' : 'nein']);
      });
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor && Date.now() - start < 4.5 * 60 * 1000);

  var ss = openCodesSpreadsheet();
  var sh = ss.getSheetByName('Etiketten-Prüfung') || ss.insertSheet('Etiketten-Prüfung');
  sh.clear();
  sh.getRange(1, 1, 1, 7).setValues([['Bestellung', 'Produkt', 'Variante', 'SKU', 'Menge', 'Problem', 'labels-sent']]).setFontWeight('bold');
  if (zeilen.length) sh.getRange(2, 1, zeilen.length, 7).setValues(zeilen);
  sh.setFrozenRows(1);
  Logger.log('Geprüft: ' + anzahl + ' Bestellungen seit ' + ab + (cursor ? ' (Zeit abgelaufen, nicht alle)' : '') +
             ' | Problem-Positionen: ' + zeilen.length + ' → Blatt "Etiketten-Prüfung"');
}

function psFindeProbe_(name) {
  var key = psNorm_(name);
  if (key in PS_CACHE) return PS_CACHE[key];
  var basis = 'https://' + CONFIG.SHOP, ergebnis = null;
  try {
    var r = UrlFetchApp.fetch(basis + '/search/suggest.json?q=' + encodeURIComponent(name) +
      '&resources[type]=product&resources[limit]=10', { muteHttpExceptions: true, followRedirects: true });
    var produkte = r.getResponseCode() === 200
      ? ((JSON.parse(r.getContentText()).resources || {}).results || {}).products || [] : [];
    var oele = produkte.filter(function (p) { return p.type === 'Fragrance Oil'; });
    var treffer = oele.filter(function (p) { return psNorm_(p.title) === key; });
    if (treffer.length === 1) {
      var pr = JSON.parse(UrlFetchApp.fetch(basis + '/products/' + treffer[0].handle + '.js',
        { muteHttpExceptions: true, followRedirects: true }).getContentText());
      var proben = (pr.variants || []).filter(function (v) { return (/6\s*g\b/i.test(v.title) || /pro\s*gramm/i.test(v.title)) && /probe|sample/i.test(v.title); });
      var v = proben.filter(function (x) { return /premium|exklusiv/i.test(x.title); })[0] || proben[0];
      if (v && v.sku) ergebnis = { sku: v.sku, title: pr.title, variantTitle: v.title.replace(/Probe\s*pro\s*Gramm\s*(\([^)]*\))?/i, 'Probe 6 g') };
    } else {
      Logger.log('Probierset: "' + name + '" – ' + treffer.length + ' exakte Treffer → manuell prüfen');
    }
  } catch (e) {
    Logger.log('Probierset: Suche nach "' + name + '" fehlgeschlagen: ' + e.message);
  }
  PS_CACHE[key] = ergebnis;
  return ergebnis;
}

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
              v: (p.variants || []).map(function (v) { if (/pro\s*gramm/i.test(v.title || '')) {   // Probe pro Gramm → im Showroom weiter als 6-g-Probe
                return [v.title.replace(/Probe\s*pro\s*Gramm\s*(\([^)]*\))?/i, 'Probe 6 g'), v.sku || '', (Number(v.price) * 6).toFixed(2)];
              }
              return [v.title === 'Default Title' ? '' : v.title, v.sku || '', v.price]; }) };
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

function grundpreisSetzen() {
  var start = Date.now(), cursor = null, proProdukt = {}, zeilen = [], schon = 0;
  do {
    var d = shopifyGraphQL('query($c: String) { productVariants(first: 250, after: $c) { pageInfo { hasNextPage endCursor } ' +
      'nodes { id title sku price showUnitPrice unitPriceMeasurement { quantityValue quantityUnit } product { id title } } } }',
      { c: cursor }).productVariants;
    d.nodes.forEach(function (v) {
      if (ET_KEIN_OEL.test(v.product.title + ' ' + v.title)) return;               // Zubehör
      var m = /pro\s*gramm/i.test(v.title) ? ['1 g', '1', 'g'] : String(v.title).match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
      if (!m) return;                                                              // kein Gewicht
      var menge = parseFloat(m[1].replace(',', '.')), einheit = /kg/i.test(m[2]) ? 'KG' : 'G';
      var gramm = einheit === 'KG' ? menge * 1000 : menge;
      var um = v.unitPriceMeasurement;
      if (v.showUnitPrice && um && Number(um.quantityValue) === menge && um.quantityUnit === einheit) { schon++; return; }
      var proKg = Number(v.price) / gramm * 1000;
      zeilen.push([v.product.title, v.title, v.sku, Number(v.price), proKg.toFixed(2).replace('.', ',') + ' € / 1 kg']);
      (proProdukt[v.product.id] = proProdukt[v.product.id] || []).push({ id: v.id, showUnitPrice: true,
        unitPriceMeasurement: { quantityValue: menge, quantityUnit: einheit, referenceValue: 1, referenceUnit: 'KG' } });
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor);

  var ss = openCodesSpreadsheet();
  var sh = ss.getSheetByName('Grundpreis') || ss.insertSheet('Grundpreis');
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['Produkt', 'Variante', 'SKU', 'Preis €', 'Grundpreis']]).setFontWeight('bold');
  if (zeilen.length) sh.getRange(2, 1, zeilen.length, 5).setValues(zeilen);
  sh.setFrozenRows(1);

  var fertig = 0, fehler = [], abgebrochen = false;
  if (GRUNDPREIS_AENDERN) {
    var ids = Object.keys(proProdukt);
    for (var i = 0; i < ids.length; i++) {
      if (Date.now() - start > 5 * 60 * 1000) { abgebrochen = true; break; }
      var r = shopifyGraphQL('mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { ' +
        'userErrors { field message } } }', { p: ids[i], v: proProdukt[ids[i]] }).productVariantsBulkUpdate;
      if (r.userErrors && r.userErrors.length) fehler.push(r.userErrors[0].message); else fertig += proProdukt[ids[i]].length;
    }
  }
  var text = GRUNDPREIS_AENDERN
    ? '⚖️ Grundpreis gesetzt: ' + fertig + ' Varianten' + (abgebrochen ? '\n⏳ Zeit abgelaufen – bitte grundpreisSetzen erneut ausführen' : '\n✅ fertig') +
      '\nBereits vorhanden: ' + schon + (fehler.length ? '\n❌ ' + fehler.slice(0, 3).join('\n❌ ') : '')
    : '👀 VORSCHAU Grundpreis – nichts geändert\nZu setzen: ' + zeilen.length + ' Varianten\nBereits vorhanden: ' + schon + '\nDetails: Blatt "Grundpreis"';
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}

/* ================= Einmalige Umstellung im Shop: Probe 6 g → Probe pro Gramm ================= */
// 1. PROBEN_GRAMM_AENDERN = false → nur Vorschau im Blatt "Proben-Gramm" + Telegram
// 2. true → im Shop umstellen. Bei "Zeit abgelaufen" einfach erneut ausführen (macht dort weiter, wo es aufgehört hat).
var PROBEN_GRAMM_AENDERN = false;
var PROBEN_GRAMM_NAME = 'Probe pro Gramm (6–20 g)';

function probenAufGrammUmstellen() {
  var start = Date.now(), cursor = null, zeilen = [], fertig = 0, fehler = [], abgebrochen = false;
  do {
    var d = shopifyGraphQL('query($c: String) { products(first: 50, after: $c, query: "variant_title:Probe*") { ' +
      'pageInfo { hasNextPage endCursor } nodes { id title options { id name optionValues { id name } } ' +
      'variants(first: 50) { nodes { id title price sku } } } } }', { c: cursor }).products;
    for (var i = 0; i < d.nodes.length; i++) {
      var p = d.nodes[i];
      var probe = [];
      p.options.forEach(function (o) {
        o.optionValues.forEach(function (ov) { if (/^Probe\s*6\s*g$/i.test(ov.name)) probe.push({ option: o.id, value: ov.id }); });
      });
      if (!probe.length) continue;
      var vs = p.variants.nodes.filter(function (v) { return /^Probe\s*6\s*g\b/i.test(v.title); }).map(function (v) {
        var preis = Math.round(Number(v.price) / 6 * 100) / 100;
        var sku = String(v.sku || '').replace(/-6G$/i, '-1G');
        zeilen.push([p.title, v.title, v.sku, Number(v.price), preis, sku]);
        return { id: v.id, price: preis.toFixed(2), showUnitPrice: true,
                 unitPriceMeasurement: { quantityValue: 1, quantityUnit: 'G', referenceValue: 1, referenceUnit: 'KG' },
                 inventoryItem: { sku: sku, measurement: { weight: { value: 1, unit: 'GRAMS' } } } };
      });
      if (!PROBEN_GRAMM_AENDERN) continue;
      if (Date.now() - start > 5 * 60 * 1000) { abgebrochen = true; break; }
      try {
        // erst Preise/SKU, dann Namen → bricht es dazwischen ab, findet der nächste Lauf das Produkt wieder
        var r1 = shopifyGraphQL('mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { userErrors { message } } }',
          { p: p.id, v: vs }).productVariantsBulkUpdate;
        if (r1.userErrors.length) throw new Error(r1.userErrors[0].message);
        var r2 = shopifyGraphQL('mutation($p: ID!, $o: OptionUpdateInput!, $u: [OptionValueUpdateInput!]) { productOptionUpdate(productId: $p, option: $o, optionValuesToUpdate: $u) { userErrors { message } } }',
          { p: p.id, o: { id: probe[0].option }, u: probe.map(function (x) { return { id: x.value, name: PROBEN_GRAMM_NAME }; }) }).productOptionUpdate;
        if (r2.userErrors.length) throw new Error(r2.userErrors[0].message);
        fertig++;
      } catch (e) { fehler.push(p.title + ': ' + e.message); }
    }
    cursor = (!abgebrochen && d.pageInfo.hasNextPage) ? d.pageInfo.endCursor : null;
  } while (cursor);

  if (!PROBEN_GRAMM_AENDERN) {
    var ss = openCodesSpreadsheet();
    var sh = ss.getSheetByName('Proben-Gramm') || ss.insertSheet('Proben-Gramm');
    sh.clear();
    sh.getRange(1, 1, 1, 6).setValues([['Produkt', 'Variante', 'SKU alt', 'Preis 6 g €', 'Preis pro g €', 'SKU neu']]).setFontWeight('bold');
    if (zeilen.length) sh.getRange(2, 1, zeilen.length, 6).setValues(zeilen);
    sh.setFrozenRows(1);
  }
  var text = PROBEN_GRAMM_AENDERN
    ? '⚖️ Proben pro Gramm: ' + fertig + ' Produkte umgestellt' +
      (abgebrochen ? '\n⏳ Zeit abgelaufen – bitte probenAufGrammUmstellen erneut ausführen' : '\n✅ fertig') +
      (fehler.length ? '\n❌ ' + fehler.slice(0, 5).join('\n❌ ') : '')
    : '👀 VORSCHAU Proben pro Gramm – nichts geändert\nZu ändern: ' + zeilen.length + ' Proben-Varianten\nDetails: Blatt "Proben-Gramm"';
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}