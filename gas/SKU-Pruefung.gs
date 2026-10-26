/**
 * SKU-Pruefung.gs – prüft ALLE Duftöl-Varianten im Shop:
 * Shopify-SKU → Sheet1 (D) → Fabrik-Code (E) → CLP-Daten (Etikett) + Zertifikat in Drive (Versand).
 * Ergebnis im Blatt "SKU-Prüfung" (Probleme oben) + Zusammenfassung per Telegram.
 */
function skuPruefung() {
  var start = Date.now();
  var ss = openCodesSpreadsheet();
  var map = loadCodeMap();
  var ohneSuffix = function (s) { return String(s).replace(/-(a[a-z]{2}|6g)$/i, ''); };

  // CLP-Daten: Fabrik-Codes mit H-Sätzen
  var clp = {};
  var shc = ss.getSheetByName(typeof CLP_SHEET !== 'undefined' ? CLP_SHEET : 'CLP-Daten');
  if (shc) shc.getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[0]).trim();
    if (c && String(r[4]).trim()) clp[c] = true;
  });

  // Zertifikate in Drive
  var index = null, cert = {};
  try { index = buildFileIndex(); } catch (e) { Logger.log('Zertifikats-Index nicht verfügbar: ' + e.message); }
  var hatZert = function (code) {
    if (!index) return null;
    if (!(code in cert)) { try { cert[code] = findCertFiles(code, index).length > 0; } catch (e) { cert[code] = null; } }
    return cert[code];
  };

  var zeilen = [], cursor = null, geprueft = 0, uebersprungen = 0;
  do {
    var d = shopifyGraphQL('query($c: String) { productVariants(first: 250, after: $c) { ' +
      'pageInfo { hasNextPage endCursor } nodes { sku title product { title status } } } }', { c: cursor }).productVariants;
    d.nodes.forEach(function (v) {
      var titel = v.product.title, variante = v.title || '';
      // nur Duftöle: kein Zubehör-Wort und Gewichtsangabe g/kg in der Variante
      if (ET_KEIN_OEL.test(titel + ' ' + variante) || !etVariante_(variante).gewicht) { uebersprungen++; return; }
      geprueft++;
      var roh = String(v.sku || '').trim(), code = '', probleme = [], loesung = '';
      if (!roh) {
        probleme.push('Keine SKU in Shopify'); loesung = 'SKU in Shopify eintragen';
      } else {
        var entry = lookupSku(normalize(roh), map) || lookupSku(normalize(ohneSuffix(roh)), map);
        if (!entry) {
          probleme.push('Nicht in Sheet1');
          loesung = 'Neue Zeile in Sheet1: C = Name, D = ' + ohneSuffix(roh) + ', E = Fabrik-Code';
        } else {
          code = String(entry.factory || '').trim();
          if (!/^\d{7}$/.test(code)) {
            probleme.push('Kein Fabrik-Code'); loesung = 'Fabrik-Code (7 Ziffern) in Sheet1 Spalte E eintragen';
          } else {
            if (!clp[code]) probleme.push('Nicht in CLP-Daten → Etikett nur mit VORLAGE');
            if (hatZert(code) === false) probleme.push('Kein Zertifikat in Drive → Kunde bekommt keins');
            if (probleme.length) loesung = 'SDB/Zertifikate für ' + code + ' beim Werk anfordern / Dateiname prüfen';
          }
        }
      }
      zeilen.push([probleme.length ? '❌' : '✅', titel, variante, roh, v.product.status, code, probleme.join('; '), loesung]);
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor && Date.now() - start < 5 * 60 * 1000);

  // Ergebnis-Blatt
  zeilen.sort(function (a, b) { return (a[0] === '✅') - (b[0] === '✅') || String(a[1]).localeCompare(String(b[1])); });
  var sh = ss.getSheetByName('SKU-Prüfung') || ss.insertSheet('SKU-Prüfung');
  sh.clear();
  if (sh.getFilter()) sh.getFilter().remove();
  var kopf = ['OK', 'Produkt', 'Variante', 'SKU (Shopify)', 'Status', 'Fabrik-Code', 'Problem', 'Lösung'];
  sh.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
  if (zeilen.length) sh.getRange(2, 1, zeilen.length, kopf.length).setValues(zeilen);
  sh.setFrozenRows(1);
  sh.getRange(1, 1, Math.max(zeilen.length, 1) + 1, kopf.length).createFilter();
  sh.autoResizeColumns(1, kopf.length);

  // Zusammenfassung
  var zaehle = function (t) { return zeilen.filter(function (z) { return z[6].indexOf(t) > -1; }).length; };
  var fehler = zeilen.filter(function (z) { return z[0] === '❌'; }).length;
  var text = '🔎 SKU-Prüfung' + (cursor ? ' (UNVOLLSTÄNDIG – Zeit abgelaufen, bitte erneut starten)' : '') + '\n' +
    'Duftöl-Varianten geprüft: ' + geprueft + ' (Zubehör übersprungen: ' + uebersprungen + ')\n' +
    '✅ in Ordnung: ' + (geprueft - fehler) + '\n❌ mit Problem: ' + fehler + '\n' +
    '- Nicht in Sheet1: ' + zaehle('Nicht in Sheet1') + '\n' +
    '- Kein Fabrik-Code: ' + zaehle('Kein Fabrik-Code') + '\n' +
    '- Nicht in CLP-Daten: ' + zaehle('Nicht in CLP-Daten') + '\n' +
    '- Kein Zertifikat: ' + zaehle('Kein Zertifikat') + '\n' +
    '- Keine SKU: ' + zaehle('Keine SKU') + '\n' +
    'Details: Blatt "SKU-Prüfung"';
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}

/** Trägt alle Produkte mit "Nicht in Sheet1" (aus Blatt SKU-Prüfung) einmal in Sheet1 ein: C = Name, D = SKU, E = leer (gelb). */
function fehlendeInSheet1Eintragen() {
  var ss = openCodesSpreadsheet();
  var s1 = ss.getSheetByName('Sheet1');
  var vorhanden = {};
  s1.getDataRange().getValues().slice(1).forEach(function (r) {
    var k = String(r[3] || '').trim().toUpperCase();
    if (k) vorhanden[k] = true;
  });
  var neu = [];
  ss.getSheetByName('SKU-Prüfung').getDataRange().getValues().slice(1).forEach(function (r) {
    if (String(r[6]).indexOf('Nicht in Sheet1') < 0) return;
    var sku = String(r[3]).trim().replace(/-SH-PQ(?=-|$)/i, '-PQ-SH').replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '');
    if (!sku || vorhanden[sku.toUpperCase()]) return;
    vorhanden[sku.toUpperCase()] = true;
    neu.push(['', '', r[1], sku, '']);
  });
  if (!neu.length) { Logger.log('Nichts einzutragen.'); return; }
  var start = s1.getLastRow() + 1;
  s1.getRange(start, 1, neu.length, 5).setValues(neu);
  s1.getRange(start, 5, neu.length, 1).setBackground('#FFF2CC');      // Fabrik-Code fehlt → gelb
  var text = '➕ ' + neu.length + ' Produkte in Sheet1 eingetragen (ab Zeile ' + start + ').\n' +
    'Fabrik-Code (Spalte E, gelb) fehlt noch – beim Werk erfragen:\n- ' +
    neu.map(function (z) { return z[2] + ' | ' + z[3]; }).join('\n- ');
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}