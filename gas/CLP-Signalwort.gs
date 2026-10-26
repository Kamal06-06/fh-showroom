/**
 * CLP-Signalwort.gs
 * Leitet das Signalwort aus den H-Sätzen ab (CLP-Verordnung, Anhang I)
 * und ergänzt/prüft Spalte C der Tabelle "CLP-Daten".
 * Schreibt nur Spalte C (Signalwort) und K (Hinweis) – Geprüft bleibt unberührt.
 */

var CLP_H_GEFAHR = ['H220','H222','H224','H225','H230','H231','H240','H241','H250','H260',
  'H270','H271','H300','H301','H304','H310','H311','H314','H318','H330','H331',
  'H334','H340','H350','H360','H370','H372'];

var CLP_H_ACHTUNG = ['H223','H226','H229','H280','H281','H290','H302','H312','H315',
  'H317','H319','H332','H335','H336','H341','H351','H361','H371','H373',
  'H400','H410','H420'];

// H-Sätze ohne eigenes Signalwort
var CLP_H_OHNE = ['H362','H411','H412','H413'];

function signalwortAusHSaetzen_(hText) {
  // \b verhindert, dass EUH208 als H208 gelesen wird
  var codes = String(hText || '').toUpperCase().match(/\bH\d{3}/g) || [];
  var res = { wort: '', unbekannt: [], leer: codes.length === 0 };
  var achtung = false;
  codes.forEach(function (c) {
    if (CLP_H_GEFAHR.indexOf(c) > -1) res.wort = 'Gefahr';
    else if (CLP_H_ACHTUNG.indexOf(c) > -1) achtung = true;
    else if (CLP_H_OHNE.indexOf(c) === -1 && res.unbekannt.indexOf(c) === -1) res.unbekannt.push(c);
  });
  if (!res.wort && achtung) res.wort = 'Achtung';
  return res;
}

function fixSignalwoerter() {
  var sh = openCodesSpreadsheet().getSheetByName(CLP_SHEET);
  var n = sh.getLastRow() - 1;
  if (n < 1) return;

  var werte = sh.getRange(2, 1, n, 11).getValues();
  var spalteC = [], spalteK = [];
  var ergaenzt = 0, konflikte = 0;

  werte.forEach(function (r) {
    var ocr = String(r[2]).trim();
    var h = signalwortAusHSaetzen_(r[4]);

    // alte Signalwort-Hinweise entfernen, andere Hinweise behalten
    var hinweise = String(r[10]).split(';')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s && !/^(Signalwort|Unbekannte H|Keine H)/.test(s); });

    var wort = ocr;
    if (h.leer) {
      hinweise.push('Keine H-Sätze gefunden');
    } else if (!ocr && h.wort) {
      wort = h.wort;
      hinweise.push('Signalwort aus H-Sätzen abgeleitet');
      ergaenzt++;
    } else if (ocr && h.wort && ocr !== h.wort) {
      hinweise.push('Signalwort-Konflikt: SDS=' + ocr + ', H-Sätze=' + h.wort);
      konflikte++;
    } else if (!ocr && !h.wort) {
      hinweise.push('Signalwort: keins erforderlich');
    }
    if (h.unbekannt.length) hinweise.push('Unbekannte H-Sätze: ' + h.unbekannt.join(', '));

    spalteC.push([wort]);
    spalteK.push([hinweise.join('; ')]);
  });

  sh.getRange(2, 3, n, 1).setValues(spalteC);
  sh.getRange(2, 11, n, 1).setValues(spalteK);
  Logger.log('Ergänzt: ' + ergaenzt + ' | Konflikte: ' + konflikte);
}