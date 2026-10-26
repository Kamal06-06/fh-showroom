/**
 * IFRA.gs – liest die IFRA-Höchstmengen aus den Zertifikaten (per OCR) → Blatt "IFRA-Daten"
 * Eine Zeile je Fabrik-Code: Kategorie 1 … 12 in %, Quelle, Status.
 *   ifraAutoStarten()  EINMAL ausführen → liest alle 10 Min. weiter, bis alles fertig ist, stoppt dann selbst
 *   ifraEinlesen()     ein Lauf von Hand (ca. 4,5 Min.)
 *   ifraAutoStoppen()  vorzeitig beenden
 */
var IFRA_BLATT = 'IFRA-Daten';
var IFRA_KAT = ['1', '2', '3', '4', '5A', '5B', '5C', '5D', '6', '7A', '7B', '8', '9', '10A', '10B', '11A', '11B', '12'];

function ifraEinlesen() {
  var start = Date.now();
  var ss = openCodesSpreadsheet();
  var sh = ss.getSheetByName(IFRA_BLATT) || ss.insertSheet(IFRA_BLATT);
  var kopf = ['Fabrik-Code', 'Quelle (Datei)'].concat(IFRA_KAT.map(function (k) { return 'Kat. ' + k; }), ['Status']);
  sh.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
  sh.setFrozenRows(1);

  var fertig = {};
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues()
    .forEach(function (r) { fertig[String(r[0]).replace(/\.0$/, '').trim()] = true; });

  var codes = [];
  ss.getSheetByName('Sheet1').getDataRange().getValues().slice(1).forEach(function (r) {
    var c = String(r[4] || '').replace(/\.0$/, '').trim();
    if (/^\d{7}$/.test(c) && !fertig[c] && codes.indexOf(c) === -1) codes.push(c);
  });

  var index = null, ok = 0, ohne = 0, pruefen = 0;
  for (var i = 0; i < codes.length; i++) {
    if (Date.now() - start > 3.5 * 60 * 1000) break;
    var code = codes[i], zeile;
    try {
      if (!index) index = buildFileIndex();
      var dateien = findCertFiles(code, index);
      // eigene IFRA-Datei bevorzugen, sonst im SDB suchen (Zertifikat hängt oft hinten an)
          var rang = function (d) { return (d.type === 'IFRA' ? 0 : 2) + (/de-DE|[-_ ]DE\b|deutsch|german/i.test(d.name) ? 1 : 0); };
    dateien.sort(function (a, b) { return rang(a) - rang(b); });
      var ergebnis = null, quelle = '';
      for (var j = 0; j < dateien.length && !ergebnis; j++) {
        var r = ifraParsePlus_(clpOcr_(dateien[j].file));
        if (r && Object.keys(r.werte).length >= 10) { ergebnis = r; quelle = dateien[j].name; }
      }
      if (!ergebnis) {
        zeile = [code, dateien.length ? dateien[0].name : '–'].concat(IFRA_KAT.map(function () { return ''; }),
                ['❌ kein IFRA-Zertifikat gefunden']);
        ohne++;
      } else {
        var status = ergebnis.fehlt.length ? '⚠️ fehlt: ' + ergebnis.fehlt.join(', ') :
                     (ergebnis.korr ? '⚠️ Komma ergänzt – prüfen' : '✅');
        if (status !== '✅') pruefen++; else ok++;
        zeile = [code, quelle].concat(IFRA_KAT.map(function (k) { return k in ergebnis.werte ? ergebnis.werte[k] : ''; }), [status]);
      }
    } catch (e) {
      Logger.log(code + ': ' + e.message);
      continue;                                    // beim nächsten Lauf erneut
    }
    sh.appendRow(zeile);
  }
  var offen = codes.length - (ok + ohne + pruefen);
  var text = '📋 IFRA eingelesen\n✅ ok: ' + ok + '\n⚠️ prüfen: ' + pruefen + '\n❌ ohne IFRA: ' + ohne +
             '\n⏳ noch offen: ' + offen + (offen ? ' → läuft weiter' : '');
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}

/** Erkennt beide Formate: "Category 5.A  36,43" und "IFRACAT05A … 20.5263" (OCR-Fehler O/0, I/1, S/5 werden korrigiert) */
function ifraParse_(text) {  text = ifraKlassenFormat_(text);
  var t = String(text || '').replace(/\s+/g, ' ');
  var a = t.search(/IFRA\s*(CLASSES|Categories|Kategorien)/i);
  if (a < 0) return null;
  var b = t.slice(a + 10).search(/The IFRA Standards|For categories|This certificate|Ce certificat/i);
  var seg = t.slice(a, b > 0 ? a + 10 + b : a + 4000);
  var zif = function (s) { return s.toUpperCase().replace(/O/g, '0').replace(/[IL|]/g, '1').replace(/S/g, '5').replace(/B/g, '8'); };
  var re = /(?:[IE1l]F?RA\s*CAT\s*([0-9OoIlSsB|]{1,2})\s*\.?\s*([A-D])?(?![a-z])|Categor(?:y|ie)\s*([0-9Il|]{1,2})\s*\.?\s*([A-D])?(?![a-z]))|(\d{1,6}(?:[.,]\d{1,4})?)/g;
  var m, tok = [];
  while ((m = re.exec(seg))) {
    if (m[1] || m[3]) {
      tok.push({ k: String(parseInt(zif(m[1] || m[3]), 10)) + (m[2] || m[4] || '').toUpperCase() });
    } else {
      var raw = m[5], v = parseFloat(raw.replace(',', '.')), korr = false;
      if (v > 100 && !/[.,]/.test(raw)) { v = raw.length >= 5 ? v / 10000 : v / 100; korr = true; }   // fehlendes Komma
      tok.push({ v: v, korr: korr });
    }
  }
  var labels = tok.filter(function (x) { return x.k; }).map(function (x) { return x.k; });
  var paare = [], abwechselnd = true;
  for (var i = 0; i < tok.length; i++) if (tok[i].k) {
    var n = tok[i + 1];
    if (n && n.v !== undefined) paare.push([tok[i].k, n]); else abwechselnd = false;
  }
  if (!abwechselnd) {                                // erst alle Kategorien, dann alle Werte
    var erste = 0; while (erste < tok.length && !tok[erste].k) erste++;
    var zahlen = tok.slice(erste).filter(function (x) { return x.v !== undefined; });
    paare = labels.map(function (l, i) { return [l, zahlen[i]]; });
  }
  var werte = {}, korrigiert = false;
  paare.forEach(function (p) {
    if (p[1] && IFRA_KAT.indexOf(p[0]) > -1 && !(p[0] in werte)) {
      werte[p[0]] = Math.round(p[1].v * 10000) / 10000;
      if (p[1].korr) korrigiert = true;
    }
  });
  return { werte: werte, fehlt: IFRA_KAT.filter(function (k) { return !(k in werte); }), korr: korrigiert };
}

/* ---------- automatisch weiterlaufen lassen ---------- */
function ifraAutoStarten() {
  ifraAutoStoppen();
  ScriptApp.newTrigger('ifraAutoLauf').timeBased().everyMinutes(10).create();
  Logger.log('IFRA-Einlesen läuft jetzt automatisch alle 10 Minuten.');
}

function ifraAutoStoppen() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'ifraAutoLauf'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function ifraAutoLauf() {
  var original = etTelegram_, bericht = '';
  etTelegram_ = function (t) { bericht = t; };      // Zwischenstände nicht in die Gruppe senden
  try { ifraEinlesen(); } finally { etTelegram_ = original; }
  if (bericht.indexOf('noch offen: 0') > -1) {
    ifraAutoStoppen();
    etTelegram_(bericht + '\n✅ IFRA-Einlesen abgeschlossen', null);
  }
}


/* ---------- TEST: nur ein paar Codes, schreibt NICHTS in die Tabelle ---------- */
var IFRA_TEST_CODES = ['1010019', '3050153', '3010221', '3010020', '1010017'];

function ifraTest() {
  var index = buildFileIndex(), zeilen = [];
  IFRA_TEST_CODES.forEach(function (code) {
    try {
      var dateien = findCertFiles(code, index);
      dateien.sort(function (a, b) { return (a.type === 'IFRA' ? 0 : 1) - (b.type === 'IFRA' ? 0 : 1); });
      if (!dateien.length) { zeilen.push(code + ': ❌ keine Datei in Drive'); return; }
      var r = null, quelle = '';
      for (var j = 0; j < dateien.length && !r; j++) {
        var x = ifraParse_(clpOcr_(dateien[j].file));
        if (x && Object.keys(x.werte).length >= 10) { r = x; quelle = dateien[j].name; }
      }
      if (!r) { zeilen.push(code + ': ❌ IFRA nicht gefunden (' + dateien.length + ' Datei(en) gelesen)'); return; }
      var w = r.werte;
      zeilen.push(code + (r.fehlt.length ? ' ⚠️ fehlt: ' + r.fehlt.join(',') : r.korr ? ' ⚠️ Komma ergänzt' : ' ✅') +
        '\n  Parfüm (4): ' + w['4'] + ' % | Kerzen (12): ' + w['12'] + ' % | Raumspray (10B): ' + w['10B'] +
        ' % | Lotion (5A): ' + w['5A'] + ' % | Seife (9): ' + w['9'] + ' %\n  Datei: ' + quelle);
    } catch (e) {
      zeilen.push(code + ': ❌ Fehler: ' + e.message);
    }
  });
  var text = '🧪 IFRA-Test\n' + zeilen.join('\n');
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}

/* ---------- TEST: IFRA-Werte der Test-Codes in den Shop schreiben (Metafeld custom.ifra je Variante) ---------- */
// Ans ENDE von IFRA.gs einfügen. Nutzt IFRA_TEST_CODES (oben) – nur diese Produkte werden geändert.

function ifraShopTest() {
  // 1) IFRA-Werte der Test-Codes lesen
  var index = buildFileIndex(), werte = {};
  IFRA_TEST_CODES.forEach(function (code) {
    var dateien = findCertFiles(code, index);
    dateien.sort(function (a, b) { return (a.type === 'IFRA' ? 0 : 1) - (b.type === 'IFRA' ? 0 : 1); });
    for (var j = 0; j < dateien.length && !werte[code]; j++) {
      var r = ifraParse_(clpOcr_(dateien[j].file));
      if (r && Object.keys(r.werte).length >= 10) werte[code] = r.werte;
    }
  });

  // 2) passende Varianten im Shop finden (SKU → Sheet1 → Fabrik-Code)
  var map = loadCodeMap(), setzen = [], seiten = {}, cursor = null;
  do {
    var d = shopifyGraphQL('query($c: String) { productVariants(first: 250, after: $c) { ' +
      'pageInfo { hasNextPage endCursor } nodes { id sku product { title handle } } } }', { c: cursor }).productVariants;
    d.nodes.forEach(function (v) {
      var s = String(v.sku || '').replace(/-SH-PQ(?=-|$)/i, '-PQ-SH');
      var e = s ? (lookupSku(normalize(s), map) || lookupSku(normalize(s.replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '')), map)) : null;
      var code = e ? String(e.factory || '').replace(/\.0$/, '') : '';
      if (!werte[code]) return;
      setzen.push({ ownerId: v.id, namespace: 'custom', key: 'ifra', type: 'json', value: JSON.stringify(werte[code]) });
      seiten[v.product.handle] = v.product.title;
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor);

  // 3) schreiben (max. 25 je Aufruf)
  var fehler = [];
  for (var i = 0; i < setzen.length; i += 25) {
    var r = shopifyGraphQL('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }',
                           { m: setzen.slice(i, i + 25) }).metafieldsSet;
    if (r.userErrors && r.userErrors.length) fehler = fehler.concat(r.userErrors.map(function (e) { return e.message; }));
  }

  var text = '🛒 IFRA im Shop (Test)\nVarianten aktualisiert: ' + setzen.length + '\nZum Anschauen:\n' +
    Object.keys(seiten).map(function (h) { return '- ' + seiten[h] + ': https://fragranceshub.de/products/' + h; }).join('\n') +
    (fehler.length ? '\n❌ Fehler: ' + fehler.join('; ') : '');
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}


/* ---------- ALLE Produkte: IFRA-Werte aus Blatt "IFRA-Daten" in den Shop schreiben ---------- */
// Ans ENDE von IFRA.gs einfügen. Nur Zeilen mit Status "✅" werden übertragen (⚠️ erst prüfen, dann Status auf ✅ setzen).
// Kann jederzeit erneut ausgeführt werden (z. B. wenn neue Zertifikate eingelesen wurden).

function ifraShopAlle() {
  var start = Date.now();
  var sh = openCodesSpreadsheet().getSheetByName(IFRA_BLATT);
  if (!sh || sh.getLastRow() < 2) throw new Error('Blatt "' + IFRA_BLATT + '" ist leer – zuerst ifraAutoStarten().');
  var kopf = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var statusSp = kopf.indexOf('Status');
  var werte = {};
  sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues().forEach(function (r) {
    if (String(r[statusSp]).trim() !== '✅') return;
    var w = {};
    IFRA_KAT.forEach(function (k, i) { if (r[2 + i] !== '' && r[2 + i] !== null) w[k] = Number(r[2 + i]); });
    werte[String(r[0]).replace(/\.0$/, '').trim()] = w;
  });

  var map = loadCodeMap(), setzen = [], produkte = {}, cursor = null;
  do {
    var d = shopifyGraphQL('query($c: String) { productVariants(first: 250, after: $c) { ' +
      'pageInfo { hasNextPage endCursor } nodes { id sku product { id } } } }', { c: cursor }).productVariants;
    d.nodes.forEach(function (v) {
      var s = String(v.sku || '').replace(/-SH-PQ(?=-|$)/i, '-PQ-SH');
      var e = s ? (lookupSku(normalize(s), map) || lookupSku(normalize(s.replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '')), map)) : null;
      var code = e ? String(e.factory || '').replace(/\.0$/, '') : '';
      if (!werte[code]) return;
      setzen.push({ ownerId: v.id, namespace: 'custom', key: 'ifra', type: 'json', value: JSON.stringify(werte[code]) });
      produkte[v.product.id] = true;
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor);

  var fehler = [], geschrieben = 0;
  for (var i = 0; i < setzen.length; i += 25) {
    if (Date.now() - start > 5 * 60 * 1000) { fehler.push('Zeit abgelaufen – bitte ifraShopAlle erneut ausführen'); break; }
    var r = shopifyGraphQL('mutation($m: [MetafieldsSetInput!]!) { metafieldsSet(metafields: $m) { userErrors { field message } } }',
                           { m: setzen.slice(i, i + 25) }).metafieldsSet;
    if (r.userErrors && r.userErrors.length) fehler = fehler.concat(r.userErrors.map(function (e) { return e.message; }));
    else geschrieben += Math.min(25, setzen.length - i);
  }

  var text = '🛒 IFRA im Shop\nCodes mit ✅-Daten: ' + Object.keys(werte).length + '\nVarianten aktualisiert: ' + geschrieben +
             ' (in ' + Object.keys(produkte).length + ' Produkten)' + (fehler.length ? '\n❌ ' + fehler.slice(0, 5).join('\n❌ ') : '');
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}
/** Format 3: "CLASS 5A - limited to : 26.5%" (IFRA Conformity Certificate) */
function ifraKlassenFormat_(text) {
  var t = String(text || '').replace(/\s+/g, ' ');
  if (/IFRA\s*(CLASSES|Categories|Kategorien)/i.test(t)) return text;
  if (!/CONFORMITY\s*CERTIFICATE/i.test(t)) return text;
  var re = /CLASS\s*([0-9OIl|]{1,2})\s*([A-D8])?\s*-\s*(?:limited\s*to\s*:?\s*)?(\d{1,3}(?:[.,]\d{1,4})?)\s*%/gi;
  var m, tok = [];
  while ((m = re.exec(t))) {
    var nr = m[1].toUpperCase().replace(/O/g, '0').replace(/[IL|]/g, '1');
    var bu = (m[2] || '').toUpperCase().replace('8', 'B'); // OCR: 10B → 108
    tok.push('Category ' + parseInt(nr, 10) + (bu ? '.' + bu : '') + ' ' + m[3]);
  }
  if (!tok.length) return text;
  return 'IFRA Categories ' + tok.join(' ') + ' This certificate';
}

/** Format 3: "CLASS 5A - limited to : 26.5%" (IFRA Conformity Certificate) */
function ifraKlassenFormat_(text) {
  var t = String(text || '').replace(/\s+/g, ' ');
  if (/IFRA\s*(CLASSES|Categories|Kategorien)/i.test(t)) return text;
  if (!/CONFORMITY\s*CERTIFICATE/i.test(t)) return text;
  var re = /CLASS\s*([0-9OIl|]{1,2})\s*([A-D8])?\s*-\s*(?:limited\s*to\s*:?\s*)?(\d{1,3}(?:[.,]\d{1,4})?)\s*%/gi;
  var m, tok = [];
  while ((m = re.exec(t))) {
    var nr = m[1].toUpperCase().replace(/O/g, '0').replace(/[IL|]/g, '1');
    var bu = (m[2] || '').toUpperCase().replace('8', 'B'); // OCR: 10B → 108
    tok.push('Category ' + parseInt(nr, 10) + (bu ? '.' + bu : '') + ' ' + m[3]);
  }
  if (!tok.length) return text;
  return 'IFRA Categories ' + tok.join(' ') + ' This certificate';
}

function ifraTest3020066() {
  var index = buildFileIndex();
  findCertFiles('3020066', index).forEach(function (d) {
    var txt = clpOcr_(d.file);
    var r = ifraParse_(txt);
    Logger.log(d.name + ' | CONFORMITY im Text: ' + /CONFORMITY/i.test(txt) +
      ' | Werte: ' + JSON.stringify(r ? r.werte : null));
  });
}

/** ifraParse_ + "Contact us"-Klassen gelten nicht als fehlend + Plausibilität 0–100 */
function ifraParsePlus_(text) {
  var r = ifraParse_(text);
  if (!r) return r;
  var t = String(text || '').replace(/\s+/g, ' ');
  var re = /(?:CLASS|Categor(?:y|ie))\s*([0-9OIl|]{1,2})\s*\.?\s*([A-D8])?\s*[-:]?\s*(?:limited\s*to\s*:?\s*)?Contact\s*us/gi;
  var m, anfrage = [];
  while ((m = re.exec(t))) {
    var nr = parseInt(m[1].toUpperCase().replace(/O/g, '0').replace(/[IL|]/g, '1'), 10);
    var k = String(nr) + (m[2] || '').toUpperCase().replace('8', 'B');
    if (anfrage.indexOf(k) === -1) anfrage.push(k);
  }
  r.fehlt = (r.fehlt || []).filter(function (k) { return anfrage.indexOf(k) === -1; });
  r.anfrage = anfrage;
  Object.keys(r.werte).forEach(function (k) {
    var v = Number(r.werte[k]);
    if (!(v >= 0 && v <= 100)) r.korr = true;
  });
  return r;
}
