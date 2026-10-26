/**
 * Code-Ergaenzung.gs – füllt leere Fabrik-Codes in Sheet1 (Spalte E) automatisch:
 * 1) aus Dateinamen der Zertifikate in Drive, z.B. "Castley ( PM-CAS-U-23-SH ) 1010007.pdf"
 * 2) aus der anderen Qualitätsstufe desselben Produkts (…-PQ-SH ↔ …-SH)
 * Nur eindeutige Treffer werden eingetragen (grün markiert). Bericht im Blatt "Code-Ergänzung".
 */
function fabrikCodesErgaenzen() {
  var start = Date.now();
  var ss = openCodesSpreadsheet();
  var sh = ss.getSheetByName('Sheet1');
  var werte = sh.getDataRange().getValues();
  var stamm = function (s) {
    s = String(s || '').trim().toUpperCase().replace(/-SH-PQ$/, '-PQ-SH');
    return s.replace(/-PQ-SH$/, '-SH');
  };
  var add = function (obj, key, code, info) { (obj[key] = obj[key] || {})[code] = info; };

  // 1) Zertifikats-Dateien in Drive durchsuchen
  var ausDrive = {}, dateien = 0;
  var it = DriveApp.searchFiles("mimeType = 'application/pdf' and trashed = false");
  while (it.hasNext() && Date.now() - start < 4 * 60 * 1000) {
    var name = it.next().getName();
    var codes = (name.match(/(^|\D)([123]0\d{5})(?=\D|$)/g) || []).map(function (x) { return x.replace(/\D/g, ''); });
    codes = codes.filter(function (c, i) { return codes.indexOf(c) === i; });
    var skus = name.toUpperCase().match(/[A-Z0-9]{1,6}(?:-[A-Z0-9]{1,6}){1,5}-SH\b/g) || [];
    if (codes.length !== 1 || !skus.length) continue;
    dateien++;
    skus.forEach(function (s) { add(ausDrive, stamm(s), codes[0], name); });
  }

  // 2) andere Qualitätsstufe in Sheet1
  var ausTabelle = {};
  for (var i = 1; i < werte.length; i++) {
    var c = String(werte[i][4]).replace(/\.0$/, '').trim();
    if (/^\d{7}$/.test(c)) add(ausTabelle, stamm(werte[i][3]), c, 'Sheet1 Zeile ' + (i + 1));
  }

  var bericht = [], gefuellt = 0, konflikt = 0, offen = 0;
  for (var z = 1; z < werte.length; z++) {
    var sku = String(werte[z][3] || '').trim();
    if (!sku || String(werte[z][4]).trim()) continue;          // leer oder schon Code → nichts tun
    var st = stamm(sku), kand = null, quelle = '';
    [[ausDrive[st], 'Zertifikat: '], [ausTabelle[st], 'Andere Qualität: ']].some(function (q) {
      if (!q[0]) return false;
      var k = Object.keys(q[0]);
      if (k.length === 1) { kand = k[0]; quelle = q[1] + q[0][k[0]]; return true; }
      konflikt++; bericht.push([z + 1, werte[z][2], sku, '', '⚠️ Mehrere Codes: ' + k.join(' / '), q[1]]);
      return true;
    });
    if (kand) {
      sh.getRange(z + 1, 5).setValue(Number(kand)).setBackground('#c6efce');
      bericht.push([z + 1, werte[z][2], sku, kand, '✅ eingetragen', quelle]);
      gefuellt++;
    } else if (!bericht.length || bericht[bericht.length - 1][0] !== z + 1) {
      bericht.push([z + 1, werte[z][2], sku, '', '❌ kein Code gefunden – beim Werk erfragen', '']);
      offen++;
    }
  }

  var rb = ss.getSheetByName('Code-Ergänzung') || ss.insertSheet('Code-Ergänzung');
  rb.clear();
  var kopf = ['Zeile (Sheet1)', 'Produkt', 'SKU', 'Fabrik-Code', 'Ergebnis', 'Quelle'];
  rb.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
  bericht.sort(function (a, b) { return String(a[4]).localeCompare(String(b[4])); });
  if (bericht.length) rb.getRange(2, 1, bericht.length, kopf.length).setValues(bericht);
  rb.setFrozenRows(1);
  rb.autoResizeColumns(1, kopf.length);

  var text = '🧩 Fabrik-Codes ergänzt\nZertifikat-Dateien gelesen: ' + dateien +
    (it.hasNext() ? ' (Zeit abgelaufen – bitte erneut starten)' : '') +
    '\n✅ eingetragen: ' + gefuellt + '\n⚠️ mehrdeutig: ' + konflikt + '\n❌ noch offen: ' + offen +
    '\nDetails: Blatt "Code-Ergänzung" (neue Codes in Sheet1 grün markiert)';
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}