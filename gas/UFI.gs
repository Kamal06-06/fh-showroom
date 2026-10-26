/**
 * UFI.gs – schreibt UFI-Nummern in CLP-Daten (Spalte N = UFI, O = Quelle):
 * 1) aus der Aromabelle-Liste (UFI_LISTE)   2) sonst per OCR aus dem SDB ("UFI: XXXX-XXXX-XXXX-XXXX")
 * Mehrmals ausführen, bis "offen: 0" (max. ca. 4,5 Min. pro Lauf).
 */
var UFI_LISTE = {
  '1010025':'UVT5-G7SU-J00S-56F9', '3010047':'G5DV-64RE-K00S-E0F1', '3010013':'7KGH-47J0-D002-763T', '3010102':'XK6N-J84A-200E-NPED',
  '1010044':'6X2J-F77X-W00Y-S7TM', '1010019':'K6X5-77QA-H002-YH5T', '2010040':'S18W-P7J5-J00U-7ASP', '1010023':'7V9F-M68E-F00C-8SVS',
  '3010035':'4QWY-14FY-E007-GM0C', '3010020':'DRCW-86HV-F00V-NYDA', '1010021':'8A1R-T8J1-3006-PJYA', '1010024':'7M6R-F46D-D00Y-7V3P',
  '3010029':'NG17-06EC-F009-VP7E', '2010043':'MRSH-E5AC-A002-88YD', '3010033':'8GHT-X6YS-M005-M1C0', '1010027':'MYYS-Y74X-200C-NHWR',
  '3010100':'8HUM-65AM-F00E-J59M', '2010003':'7JG3-F5JF-U004-FA9N', '3010093':'4VHP-0848-D00F-UVQE', '3010032':'GJTP-252V-7008-VVMG',
  '3010015':'4TPH-88MC-000E-J53N', '3010099':'NY2C-954Y-P003-8D4J', '1010045':'FCR0-J6J1-800E-9QPS', '1010007':'7KU8-D86Q-900E-J17V',
  '3010001':'FXSG-H4UG-3005-RPA3', '3010096':'AMAU-D44Y-H006-QMKK', '3010101':'5DVM-479Q-C00A-W0MK', '3010014':'7JRS-M8G5-0001-T78A',
  '3010010':'FNCE-Q78T-K00A-DS6Y', '3010016':'WDKH-Y57Y-N00F-90UM', '2010039':'7KEQ-M60C-G00C-RQEX', '3010018':'ERG9-F6AV-E00R-8TPQ',
  '3010030':'KT7N-F73H-3004-VE45', '1010022':'743S-35F6-0002-MGMH', '3010046':'X04N-G6C9-100N-20F4', '2010006':'7QYD-C7AN-000J-FA70',
  '2010041':'RXK4-M610-W00T-R8EN', '1010048':'M1SW-N67N-800N-7SQJ', '3010031':'FQEA-U589-D009-4TMA', '3010011':'KWA1-R8PW-8008-WW21',
  '3010097':'FHYG-G7FS-300H-HC4R', '3010005':'KCSQ-P5KM-H000-DATV', '3010008':'AY5G-R727-G00Y-AQG9', '2010098':'XGR0-R7M6-400N-NFA1',
  '3010095':'G3WE-28GD-N00K-FCJG', '3010037':'G3WE-28GD-N00K-FBJG', '3010009':'GX19-U892-Y001-G9CN', '2010002':'A76G-64CX-A009-J891',
  '1010017':'SWSP-V7MT-M008-9KF9', '3010036':'5W5Q-R78D-G00J-WD1A', '1010026':'N9JD-H5KK-D00D-HMTM', '3010094':'5KNV-P6FF-F006-YW1P',
  '1010092':'GX19-U892-Y001-T9CN', '3010103':'9FCG-24G5-000G-W2TY', '2010012':'2JTC-F8EV-A00E-0NAY', '3010034':'JX1V-17CP-8001-GV1T',
  '3010004':'TX7G-F23R-M007-1NF0', '3010038':'68YJ-A4YQ-7005-CA5P', '2010042':'5H0X-G5KT-N00G-REY1'
};

var UFI_SPALTE = 14;   // N
var UFI_OK = /^[0-9ACDEFGHJKMNPQRSTUVWXY]{4}(-[0-9ACDEFGHJKMNPQRSTUVWXY]{4}){3}$/;   // UFI-Alphabet ohne B, I, L, O, Z

function ufiErgaenzen() {
  var start = Date.now();
  var sh = openCodesSpreadsheet().getSheetByName(typeof CLP_SHEET !== 'undefined' ? CLP_SHEET : 'CLP-Daten');
  sh.getRange(1, UFI_SPALTE, 1, 2).setValues([['UFI', 'UFI-Quelle']]).setFontWeight('bold');
  var n = sh.getLastRow() - 1;
  var codes = sh.getRange(2, 1, n, 1).getValues();
  var ufi = sh.getRange(2, UFI_SPALTE, n, 2).getValues();
  var index = null;
  var liste = 0, sdb = 0, keins = 0, pruefen = [], offen = 0;

  for (var i = 0; i < n; i++) {
    var code = String(codes[i][0]).replace(/\.0$/, '').trim();
    if (!/^\d{7}$/.test(code) || ufi[i][0] || ufi[i][1]) continue;         // schon bearbeitet
    var z = i + 2;
    if (UFI_LISTE[code]) {
      if (UFI_OK.test(UFI_LISTE[code])) {
        sh.getRange(z, UFI_SPALTE, 1, 2).setValues([[UFI_LISTE[code], 'Aromabelle-Liste']]); liste++;
      } else {
        sh.getRange(z, UFI_SPALTE + 1).setValue('⚠️ Liste ungültig: ' + UFI_LISTE[code] + ' – beim Werk prüfen');
        pruefen.push(code + ' (Liste: ' + UFI_LISTE[code] + ')');
      }
      continue;
    }
    if (Date.now() - start > 4.5 * 60 * 1000) { offen++; continue; }
    try {
      if (!index) index = buildFileIndex();
      var datei = clpSdbDatei_(code, index);
      if (!datei) { sh.getRange(z, UFI_SPALTE + 1).setValue('kein SDB gefunden'); keins++; continue; }
      var text = clpOcr_(datei.file).replace(/\s+/g, ' ');
      var m = text.match(/UFI\s*(?:code|number|nummer|-?Nr\.?)?\s*[:：]?\s*([0-9A-Z]{4}\s*-\s*[0-9A-Z]{4}\s*-\s*[0-9A-Z]{4}\s*-\s*[0-9A-Z]{4})/i);
      if (m) {
        var u = m[1].toUpperCase().replace(/\s/g, '').replace(/O/g, '0').replace(/[IL]/g, '1').replace(/B/g, '8').replace(/Z/g, '2');
        if (UFI_OK.test(u)) { sh.getRange(z, UFI_SPALTE, 1, 2).setValues([[u, 'SDB (OCR) – prüfen']]); sdb++; }
        else { sh.getRange(z, UFI_SPALTE + 1).setValue('⚠️ im SDB unlesbar: ' + m[1]); pruefen.push(code + ' (SDB: ' + m[1] + ')'); }
      } else {
        sh.getRange(z, UFI_SPALTE + 1).setValue('kein UFI im SDB'); keins++;
      }
    } catch (e) {
      Logger.log(code + ': ' + e.message); offen++;
    }
  }

  var text = '🏷️ UFI ergänzt\n✅ aus Aromabelle-Liste: ' + liste + '\n🔎 aus SDB gelesen: ' + sdb +
    '\n➖ ohne UFI: ' + keins + '\n⚠️ prüfen: ' + pruefen.length + (pruefen.length ? '\n- ' + pruefen.join('\n- ') : '') +
    '\n⏳ noch offen: ' + offen + (offen ? ' → bitte ufiErgaenzen erneut ausführen' : '');
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}

/** Einmal starten → läuft alle 10 Minuten automatisch weiter, bis alles fertig ist, und stoppt dann selbst. */
function ufiAutoStarten() {
  ufiAutoStoppen();
  ScriptApp.newTrigger('ufiAutoLauf').timeBased().everyMinutes(10).create();
  Logger.log('UFI-Suche läuft jetzt automatisch alle 10 Minuten.');
}

function ufiAutoStoppen() {
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'ufiAutoLauf'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
}

function ufiAutoLauf() {
  var original = etTelegram_, bericht = '';
  etTelegram_ = function (t) { bericht = t; };          // Zwischenstände nicht in die Gruppe senden
  try { ufiErgaenzen(); } finally { etTelegram_ = original; }
  if (bericht.indexOf('noch offen: 0') > -1) {          // fertig → Trigger löschen + einmal melden
    ufiAutoStoppen();
    etTelegram_(bericht + '\n✅ UFI-Suche abgeschlossen', null);
  }
}