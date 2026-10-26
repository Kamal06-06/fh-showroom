/**
 * CLP-Daten.gs – liest Sicherheitsdatenblätter (SDB/SDS, auch gescannte PDFs) per OCR
 * und schreibt die Kennzeichnung ins Blatt "CLP-Daten".
 *
 *  alleEinlesen()        EINMAL starten → liest ALLE vorhandenen SDB nacheinander im Hintergrund ein
 *                        und meldet sich per E-Mail/Telegram, wenn alles fertig ist.
 *  alleEinlesenStoppen() bricht das vorzeitig ab.
 *  buildClpData()        neue Fabrik-Codes einlesen (ca. 4,5 Min. pro Lauf, danach erneut ausführen).
 *                        Vorhandene Zeilen werden NIE verändert – Geprüft (J), Enthält (Etikett) (L)
 *                        und die Zeile VORLAGE bleiben erhalten.
 *  clpNeuLesen()         die Codes in CLP_NEU_LESEN neu einlesen (überschreibt A–I und K, behält L).
 *  startClpAutoBuild()   liest im Hintergrund stündlich weiter (max. CLP_MAX_LAEUFE_PRO_TAG pro Tag)
 *                        und stoppt von selbst, wenn alles eingelesen ist.
 *  stopClpAutoBuild()    Hintergrund-Lauf beenden.
 *  clpOhneSdbLeeren()    Liste "CLP-ohne-SDB" leeren (nachdem das Werk neue SDB geschickt hat).
 *
 * Voraussetzung: Dienst "Drive" (Drive API) ist unter "Dienste" hinzugefügt.
 * Nutzt aus der Datei "الرمز": openCodesSpreadsheet(), loadCodeMap(), buildFileIndex(), findCertFiles().
 */

var CLP_SHEET = 'CLP-Daten';
var CLP_OHNE_SDB_SHEET = 'CLP-ohne-SDB';
var CLP_HEADER = ['Fabrik-Code', 'Produkt', 'Signalwort', 'Piktogramme', 'H-Sätze', 'P-Sätze', 'Enthält',
                  'Batch-Nr.', 'Quelle (Datei)', 'Geprüft', 'Hinweis', 'Enthält (Etikett)'];
var CLP_MAX_SEKUNDEN = 270;          // Sicherheitsabstand zur 6-Minuten-Grenze von Apps Script
var CLP_MAX_LAEUFE_PRO_TAG = 6;      // Hintergrund-Läufe pro Tag (schont das Tageskontingent)
var CLP_NEU_LESEN = [];              // z.B. ['1010019', '1010007'] für clpNeuLesen()

/* ===================== Hauptfunktionen ===================== */

function buildClpData() {
  var start = Date.now();
  var ss = openCodesSpreadsheet();
  var sh = clpBlatt_(ss);
  var ohne = clpOhneSdbBlatt_(ss);

  var vorhanden = clpCodesInSpalteA_(sh);
  var ohneSdb = clpCodesInSpalteA_(ohne);

  // alle Fabrik-Codes aus der Code-Tabelle (Sheet1)
  var map = loadCodeMap();
  var namen = {};
  Object.keys(map).forEach(function (k) {
    var e = map[k];
    if (e.factory && /^\d{7}$/.test(e.factory) && !namen[e.factory]) namen[e.factory] = e.name || '';
  });
  var offen = Object.keys(namen).filter(function (c) { return !vorhanden[c] && !ohneSdb[c]; });
  Logger.log('Fabrik-Codes gesamt: ' + Object.keys(namen).length + ' | schon eingelesen: ' +
             Object.keys(vorhanden).length + ' | ohne SDB: ' + Object.keys(ohneSdb).length + ' | offen: ' + offen.length);
  if (!offen.length) {
    Logger.log('Alle Codes mit SDB sind eingelesen ✅');
    stopClpAutoBuild();
    return 0;
  }

  var index = buildFileIndex();
  var neu = 0, keinSdb = 0, fehler = 0;
  for (var i = 0; i < offen.length; i++) {
    if ((Date.now() - start) / 1000 > CLP_MAX_SEKUNDEN) break;
    var code = offen[i];
    var datei = clpSdbDatei_(code, index);
    if (!datei) {
      ohne.appendRow([code, namen[code], Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy')]);
      keinSdb++;
      continue;
    }
    try {
      var d = clpLeseSdb_(datei.file, namen[code]);
      clpSchreibe_(sh, sh.getLastRow() + 1, code, d, datei.name);
      neu++;
      Logger.log('✔ ' + code + ' ' + d.produkt + ' | ' + d.signal + ' | ' + d.h.join(', ') + (d.hinweis.length ? ' | ' + d.hinweis.join('; ') : ''));
    } catch (e) {
      fehler++;
      Logger.log('✗ ' + code + ': ' + e.message);
    }
  }

  var rest = offen.length - neu - keinSdb - fehler;
  Logger.log('Neu eingelesen: ' + neu + ' | ohne SDB: ' + keinSdb + ' | Fehler: ' + fehler +
             ' | noch offen: ' + rest + (rest > 0 ? ' → buildClpData erneut ausführen' : ''));
  if (typeof fixSignalwoerter === 'function') fixSignalwoerter();   // Signalwort aus H-Sätzen ergänzen
  fixPiktogramme();                                                  // leere Piktogramm-Zellen ergänzen
  return rest;
}

/* ===================== Alles auf einmal (Kette im Hintergrund) ===================== */

function alleEinlesen() {
  PropertiesService.getScriptProperties().setProperty('CLP_KETTE', '1');
  Logger.log('Start: alle SDB werden nacheinander eingelesen. Die Seite darf danach geschlossen werden.');
  clpKettenLauf();
}

function alleEinlesenStoppen() {
  PropertiesService.getScriptProperties().deleteProperty('CLP_KETTE');
  clpKetteTriggerLoeschen_();
  Logger.log('Einlesen gestoppt.');
}

function clpKettenLauf() {
  clpKetteTriggerLoeschen_();
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('CLP_KETTE') !== '1') return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {                       // anderer Lauf aktiv → gleich nochmal versuchen
    ScriptApp.newTrigger('clpKettenLauf').timeBased().after(2 * 60 * 1000).create();
    return;
  }
  var rest;
  try {
    rest = buildClpData();
  } catch (e) {
    Logger.log('Fehler, nächster Versuch in 2 Min.: ' + e.message);
    rest = 1;
  } finally {
    lock.releaseLock();
  }
  if (rest > 0) {
    ScriptApp.newTrigger('clpKettenLauf').timeBased().after(60 * 1000).create();
  } else {
    props.deleteProperty('CLP_KETTE');
    clpFertigMelden_();
  }
}

function clpKetteTriggerLoeschen_() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'clpKettenLauf'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function clpFertigMelden_() {
  var ss = openCodesSpreadsheet();
  var mit = Math.max(clpBlatt_(ss).getLastRow() - 1, 0);
  var ohne = Math.max(clpOhneSdbBlatt_(ss).getLastRow() - 1, 0);
  var text = '✅ CLP-Daten fertig eingelesen\n' +
             'Produkte mit SDB (Blatt CLP-Daten): ' + mit + '\n' +
             'Ohne SDB (Blatt CLP-ohne-SDB – beim Werk anfordern): ' + ohne + '\n' +
             'Bitte Spalte K (Hinweis) prüfen und dann "Geprüft" ankreuzen.';
  Logger.log(text);
  try {
    if (typeof ETIKETT !== 'undefined' && ETIKETT.empfaenger && ETIKETT.emailSenden) {
      MailApp.sendEmail(ETIKETT.empfaenger, 'CLP-Daten fertig eingelesen', text);
    }
    if (typeof etTelegram_ === 'function') etTelegram_(text, null);
  } catch (e) {
    Logger.log('Meldung nicht gesendet: ' + e.message);
  }
}

/** Liest die Codes in CLP_NEU_LESEN erneut ein (z.B. nach neuem SDB). Behält Spalte L, setzt Geprüft zurück. */
function clpNeuLesen() {
  if (!CLP_NEU_LESEN.length) { Logger.log('Bitte Codes in CLP_NEU_LESEN eintragen.'); return; }
  var ss = openCodesSpreadsheet();
  var sh = clpBlatt_(ss);
  var index = buildFileIndex();
  var map = loadCodeMap();
  var werte = sh.getDataRange().getValues();
  CLP_NEU_LESEN.forEach(function (code) {
    code = String(code).trim();
    var name = '';
    Object.keys(map).some(function (k) { if (map[k].factory === code) { name = map[k].name || ''; return true; } return false; });
    var datei = clpSdbDatei_(code, index);
    if (!datei) { Logger.log('✗ ' + code + ': kein SDB gefunden'); return; }
    var zeile = 0;
    for (var r = 1; r < werte.length; r++) if (String(werte[r][0]).trim() === code) { zeile = r + 1; break; }
    try {
      clpSchreibe_(sh, zeile || sh.getLastRow() + 1, code, clpLeseSdb_(datei.file, name), datei.name);
      Logger.log('✔ ' + code + ' neu eingelesen');
    } catch (e) {
      Logger.log('✗ ' + code + ': ' + e.message);
    }
  });
  if (typeof fixSignalwoerter === 'function') fixSignalwoerter();
}

/* ===================== Hintergrund-Lauf ===================== */

function startClpAutoBuild() {
  stopClpAutoBuild();
  ScriptApp.newTrigger('clpAutoLauf').timeBased().everyHours(1).create();
  Logger.log('Hintergrund-Einlesen gestartet: stündlich, max. ' + CLP_MAX_LAEUFE_PRO_TAG + ' Läufe pro Tag.');
}

function stopClpAutoBuild() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'clpAutoLauf'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function clpAutoLauf() {
  var props = PropertiesService.getScriptProperties();
  var heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');
  var st = JSON.parse(props.getProperty('CLP_AUTO') || '{}');
  if (st.tag !== heute) st = { tag: heute, n: 0 };
  if (st.n >= CLP_MAX_LAEUFE_PRO_TAG) return;
  st.n++;
  props.setProperty('CLP_AUTO', JSON.stringify(st));
  buildClpData();
}

/** Nachdem das Werk neue SDB geschickt hat: Liste leeren, damit diese Codes erneut gesucht werden. */
function clpOhneSdbLeeren() {
  var sh = clpOhneSdbBlatt_(openCodesSpreadsheet());
  if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  Logger.log('Liste "' + CLP_OHNE_SDB_SHEET + '" geleert.');
}

/* ===================== SDB lesen ===================== */

/** Bestes SDB zum Fabrik-Code (englisch bevorzugt) aus Zertifikate-Sync bzw. Drive */
function clpSdbDatei_(code, index) {
  // Dateinamen enthalten oft kein "SDS" → alles außer IFRA zulassen, echte SDS-Dateien bevorzugen
  var liste = findCertFiles(code, index).filter(function (f) { return f.type !== 'IFRA'; });
  if (!liste.length) return null;
  var rang = function (f) { return (f.type === 'SDS' ? 0 : 2) + (f.lang === 'EN' ? 0 : 1); };
  liste.sort(function (a, b) { return rang(a) - rang(b); });
  return liste[0];
}

/** Wandelt das PDF per OCR in Text um (Drive API v3 oder v2) und löscht die Hilfsdatei wieder. */
function clpOcr_(file) {
  var blob = file.getBlob();
  var titel = 'OCR-temp ' + file.getName();
  var id;
  if (Drive.Files.create) {        // Drive API v3
    id = Drive.Files.create({ name: titel, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocrLanguage: 'en' }).id;
  } else {                         // Drive API v2
    id = Drive.Files.insert({ title: titel, mimeType: MimeType.GOOGLE_DOCS }, blob, { ocr: true, ocrLanguage: 'en' }).id;
  }
  try {
    return DocumentApp.openById(id).getBody().getText();
  } finally {
    DriveApp.getFileById(id).setTrashed(true);
  }
}

function clpLeseSdb_(file, tabellenName) {
  var flat = clpOcr_(file).replace(/\r/g, ' ').replace(/\s+/g, ' ');
  if (flat.length < 200) throw new Error('OCR hat kaum Text geliefert');
  var hinweis = [];

  // Abschnitt 2.2 (Kennzeichnungselemente) bis 2.3 (Sonstige Gefahren)
  var a = flat.search(/2\.2\.?\s*(Label elements|Kennzeichnungselemente)/i);
  var sek;
  if (a >= 0) {
    var b = flat.slice(a + 10).search(/2\.3\.?\s*(Other hazards|Sonstige Gefahren)|SECTION 3|ABSCHNITT 3/i);
    sek = flat.slice(a, b > 0 ? a + 10 + b : a + 5000);
  } else {
    sek = flat.slice(0, 8000);
    hinweis.push('Abschnitt 2.2 nicht gefunden');
  }

  // Piktogramme (OCR liest "0" manchmal als "O")
  var piktos = clpUniq_((sek.replace(/GHS\s*[O0]\s*([1-9])/gi, 'GHS0$1').match(/GHS0[1-9]/g) || [])).sort();
  if (!piktos.length) hinweis.push('Piktogramme nicht erkannt');

  // Signalwort
  var signal = '';
  var sm = sek.match(/(?:Signal\s*word|Signalwort)[^:]{0,15}:\s*(Danger|Warning|Gefahr|Achtung)/i) ||
           sek.match(/\b(Danger|Gefahr)\b/i) || sek.match(/\b(Warning|Achtung)\b/i);
  if (sm) signal = /danger|gefahr/i.test(sm[1]) ? 'Gefahr' : 'Achtung';

  // H- und P-Sätze (Reihenfolge wie im SDB)
  var h = clpUniq_((sek.match(/\b(?:EUH|H)\d{3}\b/g) || []));
  var p = clpUniq_((sek.match(/\bP\d{3}(?:\s*\+\s*P\d{3})*/g) || []).map(function (x) { return x.replace(/\s+/g, ''); }));
  if (!h.length) hinweis.push('Keine H-Sätze – bitte prüfen');
  if (!piktos.length && h.length) {                 // Bild nicht lesbar → aus den H-Sätzen ableiten
    piktos = clpGhsAusH_(h);
    hinweis = hinweis.filter(function (x) { return x !== 'Piktogramme nicht erkannt'; });
    if (piktos.length) hinweis.push('Piktogramme aus H-Sätzen abgeleitet');
  }
  if (!p.length) hinweis.push('Keine P-Sätze – bitte prüfen');

  // Enthält
  var enthaelt = '';
  var cm = sek.match(/(?:Contains|Enthält)\s*(?:\(CLP\))?\s*:?\s*(.*?)(?=\s*(?:Hazard statements|Gefahrenhinweise|Precautionary|Sicherheitshinweise|\bEUH\d{3}\b|\bH\d{3}\b))/i);
  if (cm) enthaelt = cm[1];
  if (enthaelt.indexOf(';') < 0) enthaelt = clpSemikolonListe_(sek) || enthaelt;
  enthaelt = enthaelt.replace(/^[\s:]+/, '').replace(/(\w)- (\w)/g, '$1-$2')
                     .replace(/\s*;\s*/g, '; ').replace(/[;\s]+$/, '').trim();

  // Batch aus dem Analysenzertifikat (hängt am SDB an)
  var coaPos = flat.search(/CERTIFICATE OF ANALYSIS|ANALYSENZERTIFIKAT/i);
  var coa = coaPos >= 0 ? flat.slice(coaPos) : flat;
  var bm = coa.match(/Batch\s*(?:N[or]\.?|number|Nummer)?\s*:?\s*([A-Z]{1,4}\s?-\s?\d{4,})/i) ||
           coa.match(/\b([A-Z]{2}-\d{6,8})\b/);
  var batch = bm ? bm[1].replace(/\s/g, '').toUpperCase() : '';
  if (!batch) hinweis.push('Batch nicht gefunden');

  // Produktname aus dem Dateinamen (z.B. "Avenuetus (Premium) (CR-AVE-…) 1010019 …"), sonst aus der Tabelle
  var basis = file.getName().replace(/\.[a-z0-9]+$/i, '');
  var nm = basis.match(/^(.*?)\s*[\(\[_]/);
  var produkt = (nm ? nm[1] : basis).replace(/_/g, ' ').trim();
  if (!produkt || /^\d+$/.test(produkt) || /\b(SDS|SDB|MSDS|IFRA)\b/i.test(produkt)) produkt = tabellenName || '';

  return { produkt: produkt, signal: signal, piktos: piktos, h: h, p: p,
           enthaelt: enthaelt, batch: batch, hinweis: hinweis };
}

/** Größte zusammenhängende, durch ";" getrennte Stoffliste im Text */
function clpSemikolonListe_(flat) {
  var pos = [];
  for (var i = 0; i < flat.length; i++) if (flat[i] === ';') pos.push(i);
  if (!pos.length) return '';
  var best = [pos[0], pos[0]], cur = [pos[0], pos[0]], bestN = 1, n = 1;
  for (var k = 1; k < pos.length; k++) {
    if (pos[k] - pos[k - 1] <= 160) { cur[1] = pos[k]; n++; }
    else { cur = [pos[k], pos[k]]; n = 1; }
    if (n > bestN) { bestN = n; best = cur.slice(); }
  }
  var davor = flat.slice(0, best[0]);
  var start = Math.max(davor.lastIndexOf(':') + 1, best[0] - 160);
  var rest = flat.slice(best[1] + 1);
  var ende = rest.search(/\s(?:Hazard|Gefahren|Precaution|Sicherheits|H\d{3}\b|P\d{3}\b)/);
  return flat.slice(start, best[1] + 1 + (ende >= 0 ? ende : Math.min(rest.length, 160)));
}

/* ===================== Piktogramme aus H-Sätzen (CLP Anhang I + Art. 26) ===================== */

var CLP_GHS_H = {
  GHS01: ['H200', 'H201', 'H202', 'H203', 'H204', 'H205', 'H240', 'H241'],
  GHS02: ['H220', 'H221', 'H222', 'H223', 'H224', 'H225', 'H226', 'H228', 'H229', 'H241', 'H242',
          'H250', 'H251', 'H252', 'H260', 'H261'],
  GHS03: ['H270', 'H271', 'H272'],
  GHS04: ['H280', 'H281'],
  GHS05: ['H290', 'H314', 'H318'],
  GHS06: ['H300', 'H301', 'H310', 'H311', 'H330', 'H331'],
  GHS07: ['H302', 'H312', 'H315', 'H317', 'H319', 'H332', 'H335', 'H336', 'H420'],
  GHS08: ['H304', 'H334', 'H340', 'H341', 'H350', 'H351', 'H360', 'H361', 'H362', 'H370', 'H371', 'H372', 'H373'],
  GHS09: ['H400', 'H410', 'H411']
};

function clpGhsAusH_(hListe) {
  var h = hListe.map(function (x) { return String(x).trim().toUpperCase().slice(0, 4); });
  var hat = function (g) { return CLP_GHS_H[g].some(function (c) { return h.indexOf(c) > -1; }); };
  var set = {};
  Object.keys(CLP_GHS_H).forEach(function (g) { if (hat(g)) set[g] = true; });
  // H362 allein löst kein Piktogramm aus
  if (set.GHS08 && h.filter(function (c) { return CLP_GHS_H.GHS08.indexOf(c) > -1 && c !== 'H362'; }).length === 0) delete set.GHS08;
  // Art. 26: GHS06 → kein GHS07; GHS05 → kein GHS07 nur für Haut-/Augenreizung;
  //          GHS08 wegen H334 → kein GHS07 nur für Hautsensibilisierung/Reizung
  var g7 = h.filter(function (c) { return CLP_GHS_H.GHS07.indexOf(c) > -1; });
  if (set.GHS06) delete set.GHS07;
  if (set.GHS07 && set.GHS05 && g7.every(function (c) { return c === 'H315' || c === 'H319'; })) delete set.GHS07;
  if (set.GHS07 && h.indexOf('H334') > -1 && g7.every(function (c) { return ['H315', 'H317', 'H319'].indexOf(c) > -1; })) delete set.GHS07;
  return Object.keys(set).sort();
}

/** Ergänzt leere Piktogramm-Zellen (Spalte D) in CLP-Daten aus den H-Sätzen (Spalte E). */
function fixPiktogramme() {
  var sh = clpBlatt_(openCodesSpreadsheet());
  var n = sh.getLastRow() - 1;
  if (n < 1) return;
  var werte = sh.getRange(2, 1, n, 11).getValues();
  var geaendert = 0;
  werte.forEach(function (r, i) {
    if (String(r[3]).trim() || !String(r[4]).trim()) return;
    var g = clpGhsAusH_(String(r[4]).split(','));
    if (!g.length) return;
    sh.getRange(i + 2, 4).setValue(g.join(', '));
    var hinw = String(r[10]).replace(/Piktogramme nicht erkannt;?\s*/g, '').trim();
    sh.getRange(i + 2, 11).setValue((hinw ? hinw + '; ' : '') + 'Piktogramme aus H-Sätzen abgeleitet');
    geaendert++;
  });
  if (geaendert) Logger.log('Piktogramme ergänzt: ' + geaendert);
}

/* ===================== Tabelle ===================== */

function clpSchreibe_(sh, zeile, code, d, quelle) {
  sh.getRange(zeile, 1, 1, 9).setValues([[code, d.produkt, d.signal, d.piktos.join(', '), d.h.join(', '),
                                           d.p.join(', '), d.enthaelt, d.batch, quelle]]);
  var j = sh.getRange(zeile, 10);
  j.insertCheckboxes();
  j.setValue(false);
  sh.getRange(zeile, 11).setValue(d.hinweis.join('; '));
}

function clpBlatt_(ss) {
  var sh = ss.getSheetByName(CLP_SHEET) || ss.insertSheet(CLP_SHEET);
  var kopf = sh.getRange(1, 1, 1, CLP_HEADER.length).getValues()[0];
  var geaendert = false;
  for (var i = 0; i < CLP_HEADER.length; i++) {
    if (!String(kopf[i]).trim()) { kopf[i] = CLP_HEADER[i]; geaendert = true; }
  }
  if (geaendert) {
    sh.getRange(1, 1, 1, CLP_HEADER.length).setValues([kopf]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function clpOhneSdbBlatt_(ss) {
  var sh = ss.getSheetByName(CLP_OHNE_SDB_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CLP_OHNE_SDB_SHEET);
    sh.getRange(1, 1, 1, 3).setValues([['Fabrik-Code', 'Produkt (Tabelle)', 'Geprüft am']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function clpCodesInSpalteA_(sh) {
  var set = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      var c = String(r[0]).trim();
      if (c) set[c] = true;
    });
  }
  return set;
}

function clpUniq_(a) {
  var seen = {};
  return a.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; });
}