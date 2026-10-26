/**
 * CLP-Etikett.gs – Phase 3
 * - setupPiktogramme():        lädt die 9 GHS-Piktogramme einmalig in den Drive-Ordner "CLP-Etiketten"
 * - testEtikett():             Test-PDF (102 x 51 mm) für einen Fabrik-Code
 * - testEtikettenBestellung(): Etiketten für eine echte Bestellung (ETIKETT.testBestellung) – nur E-Mail, kein Tag
 * - setupEtiketten():          einmal ausführen → prüft danach alle 5 Minuten neue Bestellungen (bezahlt oder nicht)
 * - vorlageAnlegen():          legt in CLP-Daten die Zeile "VORLAGE" an – für Duftöle ohne Zertifikatsdaten
 * - testWhatsApp():            prüft die WhatsApp-Benachrichtigung (CallMeBot)
 * - telegramVerbinden():       nach /start an den eigenen Bot → speichert die Chat-ID
 * - testTelegram():            schickt eine Testnachricht + Test-PDF an Telegram
 *
 * Nutzt aus den anderen Dateien: openCodesSpreadsheet(), CLP_SHEET, loadCodeMap(), lookupSku(),
 * normalize(), canonCode(), shopifyGraphQL(), addTag(), PRICE_LIST.
 * Der Zertifikatsversand (Datei "الرمز") wird NICHT verändert.
 */

var ETIKETT = {
  ordner: 'CLP-Etiketten',   driveSpeichern: false,                 // true = Kopie der PDFs im Drive-Ordner speichern
  emailSenden: false,                    // false = nur Telegram, true = zusätzlich E-Mail
  empfaenger: 'almasri2424@gmail.com',   // weitere Adressen mit Komma: 'a@x.de, b@y.de'
  tag: 'labels-sent',                    // Shopify-Tag nach erfolgreichem Etikettenversand
  testBestellung: '3686',                // für testEtikettenBestellung()
  maxBestellungenProLauf: 5,
  probeBreiteMm: 40,                     // Probe-Etikett 6 g
  probeHoeheMm: 30,
  probeLogoHoeheMm: 4,
  // Google Docs erlaubt keine so kleinen Seiten → das Proben-PDF wird automatisch vergrößert (gleiche Proportionen);
  // beim Drucken auf 40 × 30 "An Papiergröße anpassen" wählen
  intervallMinuten: 5,                   // wie oft Shopify geprüft wird (1, 5, 10, 15 oder 30)
  whatsappNummer: '+4915254162120',                    // z.B. '+491701234567' – leer = kein WhatsApp
  codesBlatt: 'Sheet1',       // Tabelle mit Shop-SKU (Spalte D) und Fabrik-Code (Spalte E)
  logoId: '1Jng8ig9htLWoYxWKY2nzU8HZyT9vhVj4',   // Drive-Datei-ID des Logos – leer = ohne Logo
  breiteMm: 102,
  hoeheMm: 51,
  randMm: 2,
  randUntenMm: 0.5,          // unterer Rand klein, damit keine leere Zusatzseite entsteht
  linksMm: 35,                // Breite der linken Spalte (Piktogramme, Signalwort, Logo, Menge)
  piktoMm: 16,                // Kantenlänge je Piktogramm
  logoHoeheMm: 6,
  schriftgroessen: [7, 6.5, 6, 5.5, 5],   // wird automatisch verkleinert, bis alles auf 1 Etikett passt
  ohneP: ['P321'],            // diese P-Sätze nie drucken
  adresse: 'Fragrance Hub Germany, Am Alten Kirchplatz 10, 45665 Recklinghausen, Tel. +49 2361 4878835'
};

// Spalte = Index in der Zeile des Blatts "Sätze" (0 = Code, 1 = DE … 7 = PL)
var ETIKETT_SPRACHEN = {
  DE: { spalte: 1, signal: { Gefahr: 'Gefahr', Achtung: 'Achtung' }, enthaelt: 'Enthält', menge: 'Nettofüllmenge', typ: 'Duftöl · Fragrance Oil' },
  EN: { spalte: 2, signal: { Gefahr: 'Danger', Achtung: 'Warning' }, enthaelt: 'Contains', menge: 'Net quantity', typ: 'Fragrance Oil' },
  NL: { spalte: 3, signal: { Gefahr: 'Gevaar', Achtung: 'Waarschuwing' }, enthaelt: 'Bevat', menge: 'Nettohoeveelheid', typ: 'Geurolie · Fragrance Oil' },
  FR: { spalte: 4, signal: { Gefahr: 'Danger', Achtung: 'Attention' }, enthaelt: 'Contient', menge: 'Quantité nette', typ: 'Huile parfumée · Fragrance Oil' },
  IT: { spalte: 5, signal: { Gefahr: 'Pericolo', Achtung: 'Attenzione' }, enthaelt: 'Contiene', menge: 'Quantità netta', typ: 'Olio profumato · Fragrance Oil' },
  ES: { spalte: 6, signal: { Gefahr: 'Peligro', Achtung: 'Atención' }, enthaelt: 'Contiene', menge: 'Cantidad neta', typ: 'Aceite aromático · Fragrance Oil' },
  PL: { spalte: 7, signal: { Gefahr: 'Niebezpieczeństwo', Achtung: 'Uwaga' }, enthaelt: 'Zawiera', menge: 'Ilość netto', typ: 'Olejek zapachowy · Fragrance Oil' }
};

var GHS_DATEIEN = {
  GHS01: 'GHS-pictogram-explos.svg',  GHS02: 'GHS-pictogram-flamme.svg',
  GHS03: 'GHS-pictogram-rondflam.svg', GHS04: 'GHS-pictogram-bottle.svg',
  GHS05: 'GHS-pictogram-acid.svg',    GHS06: 'GHS-pictogram-skull.svg',
  GHS07: 'GHS-pictogram-exclam.svg',  GHS08: 'GHS-pictogram-silhouette.svg',
  GHS09: 'GHS-pictogram-pollu.svg'
};

var ET_MM = 2.8346;
// Wörter, die auf Zubehör statt Duftöl hinweisen (Titel oder Variante)
var ET_KEIN_OEL = /(dispenser|zerstäuber|zerstaeuber|atomi[sz]er|flasche|flakon|bottle|glas\b|gläser|spray|sprüh|pumpe|pump\b|roll-?on|deckel|verschluss|kappe|pipette|trichter|spritze|etikett|karton|\bbox\b|beutel|tüte|alkohol|ethanol|\d+\s*ml\b)/i;

/** Name des Blatts mit den CLP-Daten – funktioniert auch ohne die Datei CLP-Daten.gs */
function etClpBlatt_() { return (typeof CLP_SHEET !== 'undefined') ? CLP_SHEET : 'CLP-Daten'; }
       // 1 mm in Punkt
var ET_BLOBS = {};

/* ================= Einrichtung ================= */

function setupPiktogramme() {
  var ordner = etOrdner_();
  var props = PropertiesService.getScriptProperties();
  Object.keys(GHS_DATEIEN).forEach(function (ghs) {
    var url = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + GHS_DATEIEN[ghs] + '?width=400';
    var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() !== 200) { Logger.log(ghs + ': Fehler ' + res.getResponseCode()); return; }
    var datei = ordner.createFile(res.getBlob().setName(ghs + '.png'));
    props.setProperty('PIKTO_' + ghs, datei.getId());
    Logger.log(ghs + ' gespeichert');
  });
}

/* ================= Test ================= */

function testEtikett() {
  var res = erstelleEtikettenPdf_({
    name: '#1001',
    laenderCode: 'DE',
    positionen: [{ fabrikCode: '1010019', sku: 'CR-AVE-H-04-PQ-SH', qualitaet: 'Exklusiv', gewicht: '250 g', menge: 1 }]
  });
  if (!res.pdf) { Logger.log('Kein Etikett erzeugt: ' + res.fehlend.join(' | ')); return; }
  var datei = etOrdner_().createFile(res.pdf);
  Logger.log('PDF: ' + datei.getUrl());
}

/* ================= Hauptfunktion ================= */

function erstelleEtikettenPdf_(auftrag) {
  var sprachen = etSprachen_(auftrag.laenderCode);
  var saetze = etLadeSaetze_();
  var charge = 'FH-' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyMMdd') +
               '-' + String(auftrag.name).replace(/\D/g, '');
  var liste = [], fehlend = [], inhalt = [], vorlagen = [];

  auftrag.positionen.forEach(function (pos) {
    var d = pos.fabrikCode ? etLadeClp_(pos.fabrikCode) : null;
    var istVorlage = false;
    if (!d) {
      d = etVorlage_(pos);
      if (!d) {
        fehlend.push((pos.titel || pos.sku || '') + ' [' + (pos.fabrikCode || 'ohne Fabrik-Code') +
                     '] – keine CLP-Daten und keine VORLAGE-Zeile');
        return;
      }
      istVorlage = true;
      vorlagen.push((pos.titel || pos.sku || '') + ' [' + (pos.fabrikCode || pos.sku || '') + ']');
    }
    sprachen.forEach(function (sp) {
          var e = { qrUrl: pos.qrUrl, daten: d, sprache: sp, gewicht: pos.gewicht, charge: charge, saetze: saetze,
                sku: pos.sku || etSkuFuer_(pos.fabrikCode) };
      e.qualitaet = pos.qualitaet || etQualitaetFuer_(e.sku);
      var s = etPassendeSchrift_(e);
      Logger.log(d.code + ' ' + sp + ': Schriftgröße ' + s + ' pt');
      for (var i = 0; i < pos.menge; i++) liste.push({ e: e, schrift: s });
      inhalt.push(pos.menge + ' × ' + d.produkt + (e.qualitaet ? ' · ' + e.qualitaet : '') +
                  ' · ' + pos.gewicht + ' · ' + sp + (istVorlage ? '  ← VORLAGE' : ''));
    });
  });

  var pdf = null;
  if (liste.length) {
    var datei = DriveApp.getFileById(etBaueDoc_(liste));
    pdf = datei.getAs('application/pdf').setName('Etiketten-' + charge + '.pdf');
    datei.setTrashed(true);
  }
  return { pdf: pdf, anzahl: liste.length, inhalt: inhalt, fehlend: fehlend, vorlagen: vorlagen,
           charge: charge, sprachen: sprachen };
}

/* ================= Daten ================= */

function etSprachen_(cc) {
  cc = String(cc || '').toUpperCase();
  if (['DE', 'AT', 'CH'].indexOf(cc) > -1) return ['DE'];
  if (cc === 'BE') return ['NL', 'FR'];
  if (['NL', 'FR', 'IT', 'ES', 'PL'].indexOf(cc) > -1) return [cc];
  return ['EN'];
}

function etListe_(text) {
  return String(text || '').split(',')
    .map(function (s) { return s.replace(/\s*\+\s*/g, '+').trim().toUpperCase(); })
    .filter(String);
}

function etLadeClp_(fabrikCode) {
  var werte = openCodesSpreadsheet().getSheetByName(etClpBlatt_()).getDataRange().getValues();
  for (var i = 1; i < werte.length; i++) {
    var r = werte[i];
    if (String(r[0]).trim() === String(fabrikCode).trim()) {
      // Spalte L "Enthält (Etikett)" hat Vorrang vor Spalte G (vollständige Liste aus dem SDB)
      if (!etListe_(r[4]).length) return null;          // ohne H-Sätze → lieber VORLAGE + Warnung
      var enthaelt = String(r[11] || r[6] || '').trim();
      var anzahl = enthaelt ? enthaelt.split(';').filter(function (x) { return x.trim(); }).length : 0;
      if (anzahl > 4) Logger.log('HINWEIS: ' + r[0] + ' – "Enthält" hat ' + anzahl +
                                 ' Stoffe. Kurzfassung in Spalte L (Enthält (Etikett)) eintragen.');
      return {
        code: String(r[0]).trim(), produkt: String(r[1]).trim(), signal: String(r[2]).trim(),
        piktogramme: etListe_(r[3]), h: etListe_(r[4]), p: etListe_(r[5]),
        enthaelt: enthaelt, batch: String(r[7]).trim()
      };
    }
  }
  return null;
}

/** Standard-Vorlage (Zeile "VORLAGE" in CLP-Daten) für Duftöle ohne Zertifikatsdaten */
function etVorlage_(pos) {
  var v = etLadeClp_('VORLAGE');
  if (!v) return null;
  v.code = pos.fabrikCode || '';
  v.produkt = pos.produkt || pos.titel || pos.sku || '';
  v.batch = '';
  return v;
}

/**
 * Legt die Zeile "VORLAGE" in CLP-Daten an (einmal ausführen). Werte danach im Blatt anpassen.
 * Vorschlag = vorsichtigste Kombination aus den bisher geprüften Duftölen (inkl. Aspirationsgefahr H304).
 */
function vorlageAnlegen() {
  var sh = openCodesSpreadsheet().getSheetByName(etClpBlatt_());
  var codes = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().map(function (r) { return String(r[0]).trim(); });
  if (codes.indexOf('VORLAGE') > -1) { Logger.log('VORLAGE existiert schon – bitte direkt im Blatt ändern.'); return; }
  sh.appendRow(['VORLAGE', '(Name kommt aus der Bestellung)', 'Gefahr', 'GHS07, GHS08, GHS09',
    'H304, H315, H317, H319, H411', 'P261, P264, P280, P301+P310+P331, P333+P313, P391',
    '', '', 'Vorlage – nicht aus Zertifikat', false, 'Für Duftöle ohne SDB. Werte bei Bedarf anpassen.']);
  Logger.log('Zeile VORLAGE angelegt (letzte Zeile in CLP-Daten).');
}

// Shop-SKU zum Fabrik-Code aus Sheet1 (nur Ersatz – bei echten Bestellungen kommt die SKU aus Shopify)
function etSkuFuer_(fabrikCode) {
  var sh = openCodesSpreadsheet().getSheetByName(ETIKETT.codesBlatt);
  if (!sh) return '';
  var werte = sh.getRange(1, 4, sh.getLastRow(), 2).getValues();   // D = SKU, E = Fabrik-Code
  for (var i = 0; i < werte.length; i++) {
    if (String(werte[i][1]).trim() === String(fabrikCode).trim()) return String(werte[i][0]).trim();
  }
  return '';
}

// Qualität (Standard / Premium / Exklusiv) aus dem Produktnamen in Sheet1, Spalte C – nur Ersatz,
// bei echten Bestellungen kommt sie aus der Shopify-Variante
function etQualitaetFuer_(sku) {
  if (!sku) return '';
  if (typeof PRICE_LIST !== 'undefined' && typeof canonCode === 'function') {
    var c = canonCode(sku);
    for (var k = 0; k < PRICE_LIST.length; k++) {
      var q = PRICE_LIST[k][1];
      if (c && canonCode(PRICE_LIST[k][0]) === c && /^(Standard|Premium|Exklusiv)$/.test(q)) return q;
    }
  }
  var sh = openCodesSpreadsheet().getSheetByName(ETIKETT.codesBlatt);
  if (!sh) return '';
  var werte = sh.getRange(1, 3, sh.getLastRow(), 2).getValues();   // C = Name, D = SKU
  for (var i = 0; i < werte.length; i++) {
    if (String(werte[i][1]).trim() === String(sku).trim()) {
      var m = String(werte[i][0]).match(/Standard|Premium|Exklusiv/i);
      return m ? m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase() : '';
    }
  }
  return '';
}

function etLadeSaetze_() {
  var werte = openCodesSpreadsheet().getSheetByName('Sätze').getDataRange().getValues();
  var map = {};
  for (var i = 1; i < werte.length; i++) {
    var code = String(werte[i][0]).replace(/\s+/g, '').toUpperCase();
    if (code) map[code] = werte[i];
  }
  return map;
}

function etSatz_(map, code, spalte) {
  var row = map[code];
  var t = row ? String(row[spalte]).trim() : '';
  return t || '[' + code + ']';   // fehlende Übersetzung sichtbar machen
}

/* ================= Dokument / PDF ================= */

function etPassendeSchrift_(e) {
  var g = ETIKETT.schriftgroessen;
  for (var i = 0; i < g.length; i++) {
    var datei = DriveApp.getFileById(etBaueDoc_([{ e: e, schrift: g[i] }]));
    var seiten = etSeiten_(datei.getAs('application/pdf'));
    datei.setTrashed(true);
    if (seiten <= 1) return g[i];
  }
  Logger.log('WARNUNG: ' + e.daten.code + ' (' + e.sprache + ') passt auch mit ' +
             g[g.length - 1] + ' pt nicht auf ein Etikett.');
  return g[g.length - 1];
}

function etSeiten_(pdf) {
  var m = pdf.getDataAsString('ISO-8859-1').match(/\/Type\s*\/Page(?!s)/g);
  return m ? m.length : 0;
}

function etBaueDoc_(liste) {
  var doc = DocumentApp.create('Etikett-temp');
  var body = doc.getBody();
  var r = ETIKETT.randMm * ET_MM;
  // Reihenfolge wichtig: zuerst Seitengröße, dann Ränder (funktioniert zuverlässig)
  body.setPageWidth(ETIKETT.breiteMm * ET_MM).setPageHeight(ETIKETT.hoeheMm * ET_MM)
      .setMarginTop(r).setMarginBottom(ETIKETT.randUntenMm * ET_MM).setMarginLeft(r).setMarginRight(r);
  etKlein_(body.getChild(0).asParagraph());
  liste.forEach(function (x, i) {
    if (i > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
    etZeichne_(body, x.e, x.schrift);
  });
  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  return doc.getId();
}

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm;
  var rechtsMm = innen - ETIKETT.linksMm;

  var tab = body.appendTable([['', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM);
  tab.setColumnWidth(1, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var rechts = etZelle_(tab.getCell(0, 1));

  // ---- links: 2 Piktogramme oben, 1 unten
  var pk = d.piktogramme.slice(0, 3);
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.logoId) {                       // Logo ganz oben, über den Piktogrammen
    etLogo_(erste);
    erste.setSpacingAfter(3);
    z1 = etStil_(links.appendParagraph(''), s).setAlignment(C);
  }
  pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);

  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 2, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 1, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  // Charge und Batch links unter der Menge (dort ist noch Platz)
  etText_(links, 'Charge: ' + e.charge, s, false, C);
  etText_(links, 'Batch: ' + (d.batch || '–'), s, false, C);

  // ---- rechts: Name, Typ + Code, Enthält
  var r0 = rechts.getChild(0).asParagraph();
  r0.setText(d.produkt + (e.qualitaet ? ' · ' + e.qualitaet : ''));
  etStil_(r0, s + 3);
  r0.editAsText().setBold(true);
  etText_(rechts, [L.typ + (d.code ? ' ' + d.code : ''), e.sku].filter(String).join(' · '), s, false);
  if (d.enthaelt) {
    var pe = etText_(rechts, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }

  // ---- H- und P-Sätze in zwei Spalten
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = d.p.filter(function (c) { return ETIKETT.ohneP.indexOf(c) === -1; })
                  .map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = (rechtsMm * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  // ---- Adresse
  etText_(rechts, ETIKETT.adresse, s, false);
}

/* ================= Probe-Etikett 40 × 30 mm ================= */

/** proben: [{ fabrikCode, sku, qualitaet, gewicht, menge, produkt }] → { pdf, anzahl } */
function erstelleProbenPdf_(orderName, proben) {
  var charge = 'FH-' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyMMdd') +
               '-' + String(orderName).replace(/\D/g, '');
  // Google Docs lehnt kleine Seitengrößen ab → größten nötigen Faktor automatisch finden
  var doc = null, body = null, f = 0;
  [2, 3, 4, 5].some(function (faktor) {
    var d = DocumentApp.create('Proben-temp');
    try {
      var b = d.getBody();
      var r = 1.5 * faktor * ET_MM;
      // zuerst Seitengröße (muss größer als die Standardränder von 2 × 2,54 cm sein), dann Ränder
      b.setPageWidth(ETIKETT.probeBreiteMm * faktor * ET_MM);
      b.setPageHeight(ETIKETT.probeHoeheMm * faktor * ET_MM);
      b.setMarginTop(r).setMarginBottom(0.5 * faktor * ET_MM).setMarginLeft(r).setMarginRight(r);
      doc = d; body = b; f = faktor;
      return true;
    } catch (e) {
      Logger.log('Faktor ' + faktor + ' abgelehnt: ' + e.message);
      DriveApp.getFileById(d.getId()).setTrashed(true);
      return false;
    }
  });
  if (!doc) throw new Error('Google Docs akzeptiert die Probe-Etikettengröße nicht.');
  Logger.log('Probe-Etikett: Faktor ' + f + ' (' + ETIKETT.probeBreiteMm * f + ' × ' + ETIKETT.probeHoeheMm * f + ' mm)');
  etKlein_(body.getChild(0).asParagraph());
  var anzahl = 0;
  proben.forEach(function (p) {
    var d = p.fabrikCode ? etLadeClp_(p.fabrikCode) : null;
    var info = { name: (d && d.produkt) || p.produkt || p.sku, qualitaet: p.qualitaet || etQualitaetFuer_(p.sku),
                 sku: p.sku, gewicht: p.gewicht, charge: charge, batch: (d && d.batch) || '–', f: f };
    for (var i = 0; i < p.menge; i++) {
      if (anzahl > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
      etZeichneProbe_(body, info);
      anzahl++;
    }
  });
  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  var datei = DriveApp.getFileById(doc.getId());
  var pdf = datei.getAs('application/pdf').setName('Proben-' + charge + '.pdf');
  datei.setTrashed(true);
  return { pdf: anzahl ? pdf : null, anzahl: anzahl };
}

function etZeichneProbe_(body, x) {
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var f = x.f || 1;
  if (ETIKETT.logoId) etLogo_(etStil_(body.appendParagraph(''), 6 * f).setAlignment(C).setLineSpacing(1),
                              ETIKETT.probeLogoHoeheMm * f, (ETIKETT.probeBreiteMm - 4) * f);
  var n = etStil_(body.appendParagraph(x.name + (x.qualitaet ? ' · ' + x.qualitaet : '')), 7 * f).setAlignment(C);
  n.editAsText().setBold(true);
  etStil_(body.appendParagraph(x.sku + ' · ' + x.gewicht), 6 * f).setAlignment(C);
  etStil_(body.appendParagraph('Charge: ' + x.charge), 5.5 * f).setAlignment(C);
  etStil_(body.appendParagraph('Batch: ' + x.batch), 5.5 * f).setAlignment(C);
  var pr = etStil_(body.appendParagraph('Probe / Sample'), 6.5 * f).setAlignment(C);
  pr.editAsText().setBold(true);
}

/** Test: Probe-Etiketten für 2 Beispiele */
function testProbenEtikett() {
  var res = erstelleProbenPdf_('#1001', [
    { fabrikCode: '1010019', sku: 'CR-AVE-H-04-PQ-SH', qualitaet: 'Exklusiv', gewicht: '6 g', menge: 1, produkt: 'Aventus' },
    { fabrikCode: '', sku: 'DI-HOM-H-04-PQ-SH', qualitaet: 'Premium', gewicht: '6 g', menge: 1, produkt: 'D Homme' }
  ]);
  var datei = etOrdner_().createFile(res.pdf);
  Logger.log('Proben-PDF (' + res.anzahl + ' Etiketten): ' + datei.getUrl());
}

/* ================= Shopify: Bestellungen → Etiketten per E-Mail ================= */

function setupEtiketten() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('ETK_START_DATE')) props.setProperty('ETK_START_DATE', new Date().toISOString());
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'processEtiketten'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('processEtiketten').timeBased().everyMinutes(ETIKETT.intervallMinuten).create();
  Logger.log('Etiketten eingerichtet. Bestellungen ab ' + props.getProperty('ETK_START_DATE') + ' werden verarbeitet.');
}

function processEtiketten() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;            // Zertifikatsversand läuft gerade → nächster Durchlauf
  var start = Date.now();
  try {
    var props = PropertiesService.getScriptProperties();
    var ab = props.getProperty('ETK_START_DATE');
    if (!ab) throw new Error('Bitte zuerst setupEtiketten() ausführen.');
    var orders = etHoleBestellungen_("created_at:>='" + ab + "' -status:cancelled -tag:" + ETIKETT.tag,
                                     ETIKETT.maxBestellungenProLauf);
    if (!orders.length) return;
    var map = loadCodeMap();
    orders.forEach(function (order) {
      if (Date.now() - start > 4 * 60 * 1000) return;          // Rest im nächsten Lauf
      if ((order.tags || []).indexOf(ETIKETT.tag) > -1) return;
      if (props.getProperty('etk_' + order.id)) return;
      try {
        etVerarbeiteBestellung_(order, map);
        addTag(order.id, ETIKETT.tag);
        props.setProperty('etk_' + order.id, '1');
      } catch (e) {
        if (!props.getProperty('etkerr_' + order.id)) {
          props.setProperty('etkerr_' + order.id, '1');
          var fehlerText = 'Die Etiketten für ' + order.name + ' konnten nicht erstellt werden:\n\n' + e.message;
          if (ETIKETT.emailSenden) MailApp.sendEmail(ETIKETT.empfaenger, 'Fehler bei Etiketten ' + order.name, fehlerText);
          else etTelegram_('❌ ' + fehlerText, null);
        }
        Logger.log(order.name + ': ' + e.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/** Test: Etiketten für ETIKETT.testBestellung erzeugen und per E-Mail senden – ohne Shopify-Tag. */
function testEtikettenBestellung() {
  var nr = String(ETIKETT.testBestellung).replace('#', '').trim();
  var versuche = /^\d+$/.test(nr) ? ['B-Nr:' + nr, '#' + nr, nr] : [nr];
  var order = null;
  for (var i = 0; i < versuche.length && !order; i++) {
    var f = etHoleBestellungen_('name:"' + versuche[i] + '"', 1);
    if (f.length) order = f[0];
  }
  if (!order) throw new Error('Bestellung nicht gefunden: ' + nr);
  Logger.log('Teste Bestellung ' + order.name);
  etVerarbeiteBestellung_(order, loadCodeMap());
}

function etVerarbeiteBestellung_(order, map) {
  var land = (order.shippingAddress && order.shippingAddress.countryCodeV2) ||
             (order.billingAddress && order.billingAddress.countryCodeV2) || '';
  var positionen = [], proben = [], probenPos = [], fehlend = [], ignoriert = [];

  order.lineItems.nodes.forEach(function (li) {
    var sku = normalize(li.sku);
    var titel = li.title + (li.variantTitle ? ' – ' + li.variantTitle : '');
    var menge = (li.currentQuantity != null ? li.currentQuantity : li.quantity) || 0;
    // NUR Produkte aus der Code-Tabelle (Sheet1) sind Duftöle – wie beim Zertifikatsversand.
    // Flaschen, Glas, Zubehör usw. bekommen nie ein Etikett.
       var skuFix = String(li.sku || '').replace(/-SH-PQ(?=-|$)/i, '-PQ-SH'); var entry = sku ? (lookupSku(normalize(skuFix), map) || lookupSku(normalize(skuFix.replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '')), map)) : null;
    if (!entry) { ignoriert.push(menge + ' × ' + titel + ' [' + (li.sku || 'ohne SKU') + ']'); return; }
    if (!menge) { ignoriert.push(titel + ' [' + entry.shop + '] – Menge 0 (entfernt/erstattet)'); return; }
    var v = etVariante_(li.variantTitle);
    // Zusätzliche Sicherung: Zubehör-Wörter im Namen oder keine Gewichtsangabe (g/kg) → kein Duftöl
    if (ET_KEIN_OEL.test(li.title + ' ' + (li.variantTitle || ''))) {
      ignoriert.push(menge + ' × ' + titel + ' [' + entry.shop + '] – Zubehör (steht aber in Sheet1 → dort löschen)');
      return;
    }
    if (!v.gewicht) {
      ignoriert.push(menge + ' × ' + titel + ' [' + entry.shop + '] – keine Gewichtsangabe g/kg');
      return;
    }
    if (v.probe) {
      proben.push(menge + ' × ' + titel + ' [' + entry.shop + ']');
      probenPos.push({ fabrikCode: entry.factory || '', sku: entry.shop, qualitaet: v.qualitaet,
                       gewicht: v.gewicht || '6 g', menge: menge, produkt: li.title });
      return;
    }
         positionen.push({ qrUrl: etQrUrl_(li), fabrikCode: entry.factory || '', sku: entry.shop,
                      qualitaet: v.qualitaet, gewicht: v.gewicht || '?', menge: menge,
                      titel: titel, produkt: li.title });
  });

  Logger.log(order.name + ' – ignoriert (kein Duftöl laut Code-Tabelle): ' + (ignoriert.join(' | ') || '–'));
  if (!positionen.length && !proben.length && !fehlend.length) {
    Logger.log(order.name + ': keine Duftöle – nichts zu tun');
    return;
  }

  var res = positionen.length
    ? erstelleEtikettenPdf_({ name: order.name, laenderCode: land || 'DE', positionen: positionen })
    : { pdf: null, anzahl: 0, inhalt: [], fehlend: [], vorlagen: [], sprachen: etSprachen_(land || 'DE') };
  fehlend = fehlend.concat(res.fehlend);

  var body = 'Bestellung: ' + order.name + '\n' +
    'Lieferland: ' + (land || 'unbekannt – Deutsch verwendet') + ' → Sprache: ' + res.sprachen.join(' + ') + '\n' +
    (order.billingAddress && order.billingAddress.company ? 'Firma: ' + order.billingAddress.company + '\n' : 'Privatkunde (keine Firma angegeben)\n') +
    '\nEtiketten 102 × 51 mm (' + res.anzahl + ' Stück):\n' + (res.inhalt.length ? '- ' + res.inhalt.join('\n- ') : '- keine') + '\n';
  var probenPdf = probenPos.length ? erstelleProbenPdf_(order.name, probenPos) : null;
  if (proben.length) body += '\nProben-Etiketten 40 × 30 mm (' + (probenPdf ? probenPdf.anzahl : 0) + ' Stück, eigenes PDF):\n- ' +
                             proben.join('\n- ') + '\n';
  if (res.vorlagen.length) body += '\n⚠️ MIT STANDARD-VORLAGE gedruckt (kein Zertifikat in CLP-Daten) – SDB beim Werk anfordern:\n- ' +
                                   res.vorlagen.join('\n- ') + '\n';
  if (fehlend.length) body += '\n⚠️ OHNE ETIKETT – bitte manuell prüfen:\n- ' + fehlend.join('\n- ') + '\n';
  if (ignoriert.length) body += '\nℹ️ Kein Etikett (nicht in der Code-Tabelle = kein Duftöl, z.B. Flaschen/Zubehör).' +
                               '\n   Falls doch ein Duftöl dabei ist: in Sheet1 (C/D/E) eintragen.\n- ' + ignoriert.join('\n- ') + '\n';
  body += '\nDruck: PDF öffnen, Epson ColorWorks C6000Ae, Größe 100 % / tatsächliche Größe.' +
          '\nEtiketten-PDF → Rolle 102 × 51 mm, Größe 100 %.' +
          '\nProben-PDF → Rolle 40 × 30 mm, "An Papiergröße anpassen" (PDF ist vergrößert angelegt).';

  // Dateiname: Bestellnummer + Kunde, z.B. "Etiketten 3796 - Max Mustermann.pdf"
  // Bestellnummer genau wie im Shop (z.B. "B-Nr:3796"). Im Dateinamen wird ":" durch das gleich aussehende
  // "：" ersetzt, weil Windows ":" in Dateinamen nicht erlaubt.
  var basis = String(order.name) + (etKunde_(order) ? ' - ' + etKunde_(order) : '');
  var dateiBasis = basis.replace(/:/g, '：');
  var mengenGross = etMengen_(positionen), mengenProben = etMengen_(probenPos);   // z.B. "100g×5, 250g×2"
  if (res.pdf) res.pdf.setName(dateiBasis + (mengenGross ? ' - ' + mengenGross : '') + '.pdf');
  if (probenPdf && probenPdf.pdf) probenPdf.pdf.setName(dateiBasis + ' - Proben ' + mengenProben + '.pdf');

  var opts = { name: 'Fragrance Hub Etiketten', attachments: [] };
  var links = [];
  [res.pdf, probenPdf && probenPdf.pdf].forEach(function (b) {
    if (!b) return;
      if (ETIKETT.driveSpeichern) links.push(etOrdner_().createFile(b.copyBlob()).getUrl());      // Kopie im Ordner CLP-Etiketten
    opts.attachments.push(b);
  });
  var warn = (res.vorlagen.length ? ' ⚠️ Vorlage' : '') + (fehlend.length ? ' ⚠️ unvollständig' : '');
  var betreff = 'Etiketten ' + order.name + ' – ' + res.anzahl + ' Stück' + (proben.length ? ' + Proben' : '') + warn;
  if (ETIKETT.emailSenden) GmailApp.sendEmail(ETIKETT.empfaenger, betreff, body, opts);
  var kurz = '🏷️ ' + betreff + (proben.length ? '\nProben: ' + proben.length + ' Position(en)' : '');
  etWhatsApp_(kurz + (links.length ? '\nPDF: ' + links.join('\n') : ''));
  // Telegram: nur die Dateien, Beschriftung = Bestellnummer + Kunde
  if (res.pdf) etTelegram_('🏷️ ' + basis + '\n' + mengenGross, res.pdf);
  if (probenPdf && probenPdf.pdf) etTelegram_('🧪 ' + basis + '\nProben ' + mengenProben, probenPdf.pdf);
  Logger.log(betreff);
     if (ignoriert.length || fehlend.length) etTelegram_('⚠️ ' + basis + '\nOHNE Etikett:\n- ' + fehlend.concat(ignoriert).join('\n- '), null);
}

/**
 * WhatsApp-Nachricht an ETIKETT.whatsappNummer über CallMeBot (nur Text + Link).
 * API-Schlüssel in Projekteinstellungen → Skripteigenschaften: CALLMEBOT_APIKEY
 */
function etWhatsApp_(text) {
  var key = PropertiesService.getScriptProperties().getProperty('CALLMEBOT_APIKEY');
  if (!ETIKETT.whatsappNummer || !key) return;
  try {
    var url = 'https://api.callmebot.com/whatsapp.php?phone=' + encodeURIComponent(ETIKETT.whatsappNummer) +
              '&text=' + encodeURIComponent(text) + '&apikey=' + encodeURIComponent(key);
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) Logger.log('WhatsApp-Fehler ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  } catch (e) {
    Logger.log('WhatsApp nicht gesendet: ' + e.message);   // E-Mail wurde trotzdem verschickt
  }
}

/**
 * Telegram über den eigenen Bot (offizielle Telegram-API) – schickt das PDF direkt.
 * Skripteigenschaften: TELEGRAM_TOKEN (von @BotFather), TELEGRAM_CHAT_ID (setzt telegramVerbinden)
 */
function etTelegram_(text, pdf) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN'), chat = props.getProperty('TELEGRAM_CHAT_ID');
  if (!token || !chat) return;
  try {
    var base = 'https://api.telegram.org/bot' + token + '/';
    var r = pdf
      ? UrlFetchApp.fetch(base + 'sendDocument', { method: 'post', muteHttpExceptions: true,
          payload: { chat_id: chat, caption: String(text).slice(0, 1000), document: pdf.copyBlob() } })
      : UrlFetchApp.fetch(base + 'sendMessage', { method: 'post', muteHttpExceptions: true,
          payload: { chat_id: chat, text: String(text).slice(0, 4000) } });
    if (r.getResponseCode() !== 200) Logger.log('Telegram-Fehler ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
  } catch (e) {
    Logger.log('Telegram nicht gesendet: ' + e.message);   // E-Mail wurde trotzdem verschickt
  }
}

/** Zuerst in Telegram dem eigenen Bot /start schicken, dann diese Funktion ausführen. */
function telegramVerbinden() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('Skripteigenschaft TELEGRAM_TOKEN fehlt.');
  var res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/getUpdates',
                                         { muteHttpExceptions: true }).getContentText());
  if (!res.ok) throw new Error('Token ungültig: ' + JSON.stringify(res).slice(0, 200));
  var msgs = (res.result || []).filter(function (u) { return u.message && u.message.chat; });
  if (!msgs.length) throw new Error('Keine Nachricht gefunden – bitte dem Bot in Telegram /start schicken und erneut ausführen.');
  var chat = msgs[msgs.length - 1].message.chat;
  props.setProperty('TELEGRAM_CHAT_ID', String(chat.id));
  etTelegram_('✅ Fragrance Hub Etiketten sind mit Telegram verbunden.', null);
  Logger.log('Verbunden mit Chat ' + chat.id + ' (' + (chat.first_name || chat.title || '') + ')');
}

function testTelegram() {
  var pdf = Utilities.newBlob('Test', 'text/plain', 'test.txt').getAs('application/pdf').setName('Test-Etikett.pdf');
  etTelegram_('🏷️ Test: Etiketten-PDF per Telegram', pdf);
  Logger.log('Gesendet (falls TELEGRAM_TOKEN und TELEGRAM_CHAT_ID gesetzt sind).');
}

function testWhatsApp() {
  etWhatsApp_('✅ Test: Fragrance Hub Etiketten-Benachrichtigung funktioniert.');
  Logger.log('Gesendet (falls Nummer und CALLMEBOT_APIKEY eingetragen sind).');
}

/** Positionen → "6g×10, 100g×5, 250g×2" (Summe je Gewicht, aufsteigend) */
function etMengen_(liste) {
  var summe = {};
  (liste || []).forEach(function (p) {
    var g = String(p.gewicht || '?').replace(/\s+/g, '');
    summe[g] = (summe[g] || 0) + (p.menge || 0);
  });
  var gramm = function (g) {
    var m = g.match(/([\d.,]+)(kg|g)/i);
    return m ? parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'kg' ? 1000 : 1) : 1e9;
  };
  return Object.keys(summe).sort(function (a, b) { return gramm(a) - gramm(b); })
    .map(function (g) { return g + '×' + summe[g]; }).join(', ');
}

/** Kundenname für den Dateinamen: Firma, sonst Vor- und Nachname (Rechnung, sonst Lieferung) */
function etKunde_(order) {
  var adr = [order.billingAddress, order.shippingAddress].filter(Boolean);
  for (var i = 0; i < adr.length; i++) {
    var a = adr[i];
    var n = String(a.company || '').trim() || [a.firstName, a.lastName].filter(Boolean).join(' ').trim();
    if (n) return n.replace(/[\\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').slice(0, 60);
  }
  return '';
}

/** "probe 6 g / Premium & Exklusiv" → { gewicht: '6 g', probe: true, qualitaet: 'Premium & Exklusiv' } */
function etVariante_(text) {
  var t = String(text || '');
  var m = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
  var gewicht = m ? m[1].replace('.', ',') + ' ' + m[2].toLowerCase() : '';
  var gramm = m ? parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'kg' ? 1000 : 1) : 0;
  var probe = /probe|sample/i.test(t) || (gramm > 0 && gramm <= 10);
  var teil = t.split('/').map(function (x) { return x.trim(); })
              .filter(function (x) { return /standard|premium|exklusiv/i.test(x); })[0] || '';
  var qualitaet = teil.replace(/exklusive/ig, 'Exklusiv').replace(/exklusiv/ig, 'Exklusiv')
                      .replace(/premium/ig, 'Premium').replace(/standard/ig, 'Standard');
  return { gewicht: gewicht, probe: probe, qualitaet: qualitaet };
}

function etHoleBestellungen_(q, first) {
  var felder = function (mitAdresse) {
    return 'id name tags ' +
      (mitAdresse ? 'billingAddress { firstName lastName company countryCodeV2 } ' +
                    'shippingAddress { firstName lastName company countryCodeV2 } '
                  : 'billingAddress { firstName lastName company } ') +
      'lineItems(first: 250) { nodes { sku title variantTitle quantity currentQuantity } }';
  };
  var abfrage = function (mitAdresse) {
    return shopifyGraphQL('query($q: String!, $first: Int!) { orders(first: $first, query: $q, sortKey: CREATED_AT) { nodes { ' +
                          felder(mitAdresse) + ' } } }', { q: q, first: first }).orders.nodes;
  };
  try {
    return abfrage(true);
  } catch (e) {
    // falls die App keine Adressdaten lesen darf: ohne Lieferland weitermachen (→ Deutsch)
    Logger.log('Lieferland nicht lesbar, verwende Deutsch: ' + e.message.slice(0, 200));
    return abfrage(false);
  }
}

/* ================= Hilfsfunktionen ================= */

function etStil_(p, size) {
  p.setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1.2);
  var a = {};
  a[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  a[DocumentApp.Attribute.FONT_SIZE] = size;
  a[DocumentApp.Attribute.BOLD] = false;
  p.setAttributes(a);
  if (p.getText().length) p.editAsText().setFontFamily('Arial').setFontSize(size).setBold(false);
  return p;
}

function etText_(cell, txt, size, bold, align) {
  var p = etStil_(cell.appendParagraph(txt), size);
  if (bold) p.editAsText().setBold(true);
  if (align) p.setAlignment(align);
  return p;
}

function etFuelle_(cell, liste, s) {
  etZelle_(cell);
  var p0 = cell.getChild(0).asParagraph();
  p0.setText(liste[0] || '');
  etStil_(p0, s);
  for (var i = 1; i < liste.length; i++) etText_(cell, liste[i], s, false);
}

function etZelle_(c) {
  c.setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(2).setPaddingRight(2);
  c.setVerticalAlignment(DocumentApp.VerticalAlignment.TOP);
  return c;
}

function etKlein_(p) {
  p.setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1);
  var a = {};
  a[DocumentApp.Attribute.FONT_SIZE] = 1;
  p.setAttributes(a);
  return p;
}

function etBlob_(id) {
  if (!ET_BLOBS[id]) ET_BLOBS[id] = DriveApp.getFileById(id).getBlob();
  return ET_BLOBS[id].copyBlob();
}

function etBild_(p, key, mm) {
  var id = PropertiesService.getScriptProperties().getProperty(key);
  if (!id) { p.appendText('[' + key.replace('PIKTO_', '') + '] '); return; }
  p.setLineSpacing(1);
  p.appendInlineImage(etBlob_(id)).setWidth(mm * ET_MM).setHeight(mm * ET_MM);
}

function etLogo_(p, hoeheMm, maxBreiteMm) {
  var img = p.appendInlineImage(etBlob_(ETIKETT.logoId));
  var h = (hoeheMm || ETIKETT.logoHoeheMm) * ET_MM;
  var w = img.getWidth() * h / img.getHeight();
  var max = (maxBreiteMm || ETIKETT.linksMm - 2) * ET_MM;
  if (w > max) { h = h * max / w; w = max; }
  img.setWidth(w).setHeight(h);
}

function etOrdner_() {
  var it = DriveApp.getFoldersByName(ETIKETT.ordner);
  return it.hasNext() ? it.next() : DriveApp.createFolder(ETIKETT.ordner);
}

/** Verbindet die Etiketten mit einer Telegram-GRUPPE (statt Privat-Chat). */
function telegramGruppeVerbinden() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('TELEGRAM_TOKEN fehlt.');
  var api = 'https://api.telegram.org/bot' + token + '/';
  var bot = JSON.parse(UrlFetchApp.fetch(api + 'getMe').getContentText()).result.username;
  var res = JSON.parse(UrlFetchApp.fetch(api + 'getUpdates', { muteHttpExceptions: true }).getContentText());
  var gruppen = {};
  (res.result || []).forEach(function (u) {
    var m = u.message || u.my_chat_member || u.channel_post;
    if (m && m.chat && m.chat.id < 0) gruppen[m.chat.id] = m.chat.title || '';
  });
  var ids = Object.keys(gruppen);
  if (!ids.length) {
    Logger.log('❗ Keine Gruppe gefunden. In der Gruppe diese Nachricht senden:  /start@' + bot);
    Logger.log('Danach diese Funktion erneut ausführen.');
    return;
  }
  var id = ids[ids.length - 1];
  props.setProperty('TELEGRAM_CHAT_ID', String(id));
  etTelegram_('✅ Etiketten werden ab jetzt in diese Gruppe gesendet.', null);
  Logger.log('✅ Verbunden mit Gruppe: ' + gruppen[id] + ' (' + id + ')');
}

/* ================= Telegram-Befehle: /neu 3796 ================= */

/** Einmal ausführen → prüft jede Minute, ob in der Gruppe ein Befehl geschrieben wurde. */
function setupTelegramBefehle() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('TELEGRAM_TOKEN');
  if (!token || !props.getProperty('TELEGRAM_CHAT_ID')) throw new Error('Zuerst telegramGruppeVerbinden() ausführen.');
  var api = 'https://api.telegram.org/bot' + token + '/';
  // Befehle im Telegram-Menü anzeigen ("/" tippen)
  UrlFetchApp.fetch(api + 'setMyCommands', { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ commands: [
      { command: 'neu', description: 'Etiketten neu senden, z.B. /neu 3796' },
      { command: 'hilfe', description: 'Hilfe anzeigen' }] }) });
  // alte Nachrichten überspringen
  var alt = JSON.parse(UrlFetchApp.fetch(api + 'getUpdates?offset=-1', { muteHttpExceptions: true }).getContentText());
  var last = (alt.result || []).length ? alt.result[alt.result.length - 1].update_id + 1 : 0;
  props.setProperty('TG_OFFSET', String(last));
  ScriptApp.getProjectTriggers()
    .filter(function (t) { return t.getHandlerFunction() === 'etTelegramBefehle'; })
    .forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('etTelegramBefehle').timeBased().everyMinutes(1).create();
  etTelegram_('🤖 Befehle aktiv. Beispiel:\n/neu 3796  → Etiketten für Bestellung 3796 neu senden', null);
  Logger.log('Telegram-Befehle eingerichtet.');
}

function etTelegramBefehle() {
  try { fsShopCheck_(); } catch (e) { Logger.log('Shop-Check: ' + e.message); }   // Echtzeit.gs: neue Shopify-Bestellungen sofort melden
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;                 // Etiketten laufen gerade → nächste Minute
  try {
    var props = PropertiesService.getScriptProperties();
    var token = props.getProperty('TELEGRAM_TOKEN'), chat = props.getProperty('TELEGRAM_CHAT_ID');
    if (!token || !chat) return;
    var offset = Number(props.getProperty('TG_OFFSET') || 0);
    var res = JSON.parse(UrlFetchApp.fetch('https://api.telegram.org/bot' + token +
              '/getUpdates?timeout=0&offset=' + offset, { muteHttpExceptions: true }).getContentText());
    var updates = res.result || [];
    if (!updates.length) return;

    var nummern = [];
    updates.forEach(function (u) {
      offset = Math.max(offset, u.update_id + 1);
      var m = u.message;
      if (!m || !m.text || String(m.chat.id) !== String(chat)) return;     // nur aus der eigenen Gruppe
      var b = m.text.trim().match(/^\/(neu|hilfe|help)(?:@\w+)?\s*(.*)$/i);
      if (!b) return;
      if (/hilfe|help/i.test(b[1])) {
        etTelegram_('ℹ️ Befehle:\n/neu 3796  → Etiketten neu senden\n/neu 3796 3801  → mehrere Bestellungen', null);
        return;
      }
      var n = b[2].match(/\d+/g);
      if (!n) { etTelegram_('❗ Bitte Bestellnummer angeben, z.B.  /neu 3796', null); return; }
      n.forEach(function (x) { if (nummern.indexOf(x) === -1) nummern.push(x); });
    });
    props.setProperty('TG_OFFSET', String(offset));   // Befehle nur einmal ausführen

    if (!nummern.length) return;
    var map = loadCodeMap(), start = Date.now();
    nummern.forEach(function (nr) {
      if (Date.now() - start > 4 * 60 * 1000) { etTelegram_('⏸️ ' + nr + ' nicht mehr geschafft – bitte erneut senden.', null); return; }
      try {
        var order = etFindeBestellung_(nr);
        if (!order) { etTelegram_('❓ Bestellung ' + nr + ' nicht gefunden.', null); return; }
        etTelegram_('⏳ Erstelle Etiketten für ' + order.name + ' …', null);
        etVerarbeiteBestellung_(order, map);
      } catch (e) {
        etTelegram_('❌ ' + nr + ': ' + e.message, null);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

function etFindeBestellung_(nr) {
  var versuche = ['B-Nr:' + nr, '#' + nr, nr];
  for (var i = 0; i < versuche.length; i++) {
    var f = etHoleBestellungen_('name:"' + versuche[i] + '"', 1);
    if (f.length) return f[0];
  }
  return null;
}

/* ================= Schnell: Schriftgröße merken ================= */
// Ersetzt die Version weiter oben (in Apps Script gilt die letzte Funktion mit gleichem Namen).

function etPassendeSchrift_(e) {
  var d = e.daten;
  var sig = [d.code, d.produkt, d.signal, d.piktogramme.join(','), d.h.join(','), d.p.join(','),
             d.enthaelt, d.batch, e.sprache, e.gewicht, e.sku, e.qualitaet, String(e.charge).length,
             ETIKETT.schriftgroessen.join(','), ETIKETT.linksMm, ETIKETT.piktoMm, ETIKETT.adresse + ((ETIKETT.adresseOben && ETIKETT.logoId) ? '#L16' + ETIKETT.logoId : '')].join('|');
  var key = 'ETS_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig, Utilities.Charset.UTF_8)).slice(0, 22);
  var props = PropertiesService.getScriptProperties();
  var gemerkt = props.getProperty(key);
  if (gemerkt) return Number(gemerkt);                       // schon bekannt → sofort

  var g = ETIKETT.schriftgroessen, passend = g[g.length - 1];
  for (var i = 0; i < g.length; i++) {
    var datei = DriveApp.getFileById(etBaueDoc_([{ e: e, schrift: g[i] }]));
    var seiten = etSeiten_(datei.getAs('application/pdf'));
    datei.setTrashed(true);
    if (seiten <= 1) { passend = g[i]; break; }
    if (i === g.length - 1) Logger.log('WARNUNG: ' + d.code + ' (' + e.sprache + ') passt nicht auf ein Etikett.');
  }
  props.setProperty(key, String(passend));
  return passend;
}

/** Falls Übersetzungen im Blatt "Sätze" geändert wurden: gemerkte Schriftgrößen löschen. */
function etSchriftCacheLeeren() {
  var props = PropertiesService.getScriptProperties();
  var n = 0;
  props.getKeys().forEach(function (k) { if (k.indexOf('ETS_') === 0) { props.deleteProperty(k); n++; } });
  Logger.log(n + ' gemerkte Schriftgrößen gelöscht.');
}

/* ================= Ohne Tageslimit "docs create": Dokumente über Drive API anlegen ================= */
// Ersetzt etBaueDoc_ und erstelleProbenPdf_ weiter oben (letzte Funktion mit gleichem Namen gilt).

function etNeuesDoc_(titel) {
  var id = Drive.Files.create
    ? Drive.Files.create({ name: titel, mimeType: MimeType.GOOGLE_DOCS }).id      // Drive API v3
    : Drive.Files.insert({ title: titel, mimeType: MimeType.GOOGLE_DOCS }).id;    // Drive API v2
  return DocumentApp.openById(id);
}

function etBaueDoc_(liste) {
  var doc = etNeuesDoc_('Etikett-temp');
  var body = doc.getBody();
  var r = ETIKETT.randMm * ET_MM;
  body.setPageWidth(ETIKETT.breiteMm * ET_MM).setPageHeight(ETIKETT.hoeheMm * ET_MM)
      .setMarginTop(r).setMarginBottom(ETIKETT.randUntenMm * ET_MM).setMarginLeft(r).setMarginRight(r);
  etKlein_(body.getChild(0).asParagraph());
  liste.forEach(function (x, i) {
    if (i > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
    etZeichne_(body, x.e, x.schrift);
  });
  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  return doc.getId();
}

function erstelleProbenPdf_(orderName, proben) {
  var charge = 'FH-' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyMMdd') +
               '-' + String(orderName).replace(/\D/g, '');
  var doc = null, body = null, f = 0;
  [2, 3, 4, 5].some(function (faktor) {
    var d = etNeuesDoc_('Proben-temp');
    try {
      var b = d.getBody();
      var r = 1.5 * faktor * ET_MM;
      b.setPageWidth(ETIKETT.probeBreiteMm * faktor * ET_MM);
      b.setPageHeight(ETIKETT.probeHoeheMm * faktor * ET_MM);
      b.setMarginTop(r).setMarginBottom(0.5 * faktor * ET_MM).setMarginLeft(r).setMarginRight(r);
      doc = d; body = b; f = faktor;
      return true;
    } catch (e) {
      Logger.log('Faktor ' + faktor + ' abgelehnt: ' + e.message);
      DriveApp.getFileById(d.getId()).setTrashed(true);
      return false;
    }
  });
  if (!doc) throw new Error('Google Docs akzeptiert die Probe-Etikettengröße nicht.');
  etKlein_(body.getChild(0).asParagraph());
  var anzahl = 0;
  proben.forEach(function (p) {
    var d = p.fabrikCode ? etLadeClp_(p.fabrikCode) : null;
    var info = { name: (d && d.produkt) || p.produkt || p.sku, qualitaet: p.qualitaet || etQualitaetFuer_(p.sku),
                 sku: p.sku, gewicht: p.gewicht, charge: charge, batch: (d && d.batch) || '–', f: f };
    for (var i = 0; i < p.menge; i++) {
      if (anzahl > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
      etZeichneProbe_(body, info);
      anzahl++;
    }
  });
  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  var datei = DriveApp.getFileById(doc.getId());
  var pdf = datei.getAs('application/pdf').setName('Proben-' + charge + '.pdf');
  datei.setTrashed(true);
  return { pdf: anzahl ? pdf : null, anzahl: anzahl };
}

/* ================= Etikett-Layout v2 (Muster A / B) ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen. Ersetzt etLadeClp_, etVorlage_ und etZeichne_ weiter oben.

var ET_GOLD = '#8C6D3F', ET_GRAU = '#555555';
var ET_IMMER_P = ['P102'];                       // "Darf nicht in die Hände von Kindern gelangen" – immer drucken
var ET_TAGLINE = {
  DE: 'Hochkonzentriertes Premium-Duftöl · Qualitätsgeprüft & chargenrückverfolgbar. Nicht unverdünnt auf die Haut auftragen. Sicherheitsdatenblatt auf Anfrage.',
  EN: 'Highly concentrated premium fragrance oil · Quality-tested & batch-traceable. Do not apply undiluted to the skin. Safety data sheet available on request.',
  NL: 'Hooggeconcentreerde premium geurolie · Kwaliteitsgecontroleerd & traceerbaar per charge. Niet onverdund op de huid aanbrengen. Veiligheidsinformatieblad op aanvraag.',
  FR: 'Huile parfumée premium hautement concentrée · Qualité contrôlée & lot traçable. Ne pas appliquer pure sur la peau. Fiche de données de sécurité sur demande.',
  IT: 'Olio profumato premium altamente concentrato · Qualità controllata & lotto tracciabile. Non applicare puro sulla pelle. Scheda di dati di sicurezza su richiesta.',
  ES: 'Aceite aromático premium altamente concentrado · Calidad controlada y lote trazable. No aplicar sin diluir sobre la piel. Ficha de datos de seguridad bajo pedido.',
  PL: 'Wysoko skoncentrowany olejek zapachowy premium · Kontrola jakości i identyfikowalność partii. Nie stosować bezpośrednio na skórę. Karta charakterystyki na życzenie.'
};

function etLadeClp_(fabrikCode) {
  var werte = openCodesSpreadsheet().getSheetByName(etClpBlatt_()).getDataRange().getValues();
  for (var i = 1; i < werte.length; i++) {
    var r = werte[i];
    if (String(r[0]).replace(/\.0$/, '').trim() !== String(fabrikCode).trim()) continue;
    if (!etListe_(r[4]).length) return null;                         // ohne H-Sätze → Muster B
    var ufi = String(r[13] || '').trim().toUpperCase();
    return {
      code: String(r[0]).replace(/\.0$/, '').trim(), produkt: String(r[1]).trim(), signal: String(r[2]).trim(),
      piktogramme: etListe_(r[3]), h: etListe_(r[4]), p: etListe_(r[5]),
      enthaelt: String(r[11] || r[6] || '').trim(), batch: String(r[7] || '').trim(),
      ufi: /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(ufi) ? ufi : '', vorlage: false
    };
  }
  return null;
}

/** Muster B: ohne Zertifikat → kein Fabrik-Code, kein Batch, kein UFI, kein "Enthält", dafür Tagline */
function etVorlage_(pos) {
  var v = etLadeClp_('VORLAGE');
  if (!v) return null;
  v.code = ''; v.batch = ''; v.ufi = ''; v.enthaelt = ''; v.vorlage = true;
  v.produkt = pos.produkt || pos.titel || pos.sku || '';
  return v;
}

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm, strichMm = 0.4, abstandMm = 1.8;
  var rechtsMm = innen - ETIKETT.linksMm - strichMm;

  var tab = body.appendTable([['', '', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM).setColumnWidth(1, strichMm * ET_MM).setColumnWidth(2, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var strich = tab.getCell(0, 1).setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0)
                 .setBackgroundColor(ET_GOLD);                      // goldene Trennlinie
  etKlein_(strich.getChild(0).asParagraph());
  var rechts = etZelle_(tab.getCell(0, 2));
  rechts.setPaddingLeft(abstandMm * ET_MM);

  // ---- links: Logo, Piktogramme, Signalwort, Menge, Charge, Batch
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.logoId) { etLogo_(erste); erste.setSpacingAfter(3); z1 = etStil_(links.appendParagraph(''), s).setAlignment(C); }
  var pk = d.piktogramme.slice(0, 3);
  pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);
  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 3, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 0.5, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  etText_(links, 'Charge: ' + e.charge, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (d.batch) etText_(links, 'Batch: ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);

  // ---- rechts: Name · Qualität
  var name = d.produkt, q = e.qualitaet ? '  ·  ' + e.qualitaet : '';
  var r0 = rechts.getChild(0).asParagraph();
  r0.setText(name + q);
  etStil_(r0, s + 3);
  var t0 = r0.editAsText();
  if (name.length) t0.setBold(0, name.length - 1, true);
  if (q) t0.setFontSize(name.length, name.length + q.length - 1, s + 1).setForegroundColor(name.length, name.length + q.length - 1, ET_GOLD);
  etText_(rechts, [L.typ, e.sku].filter(String).join('  ·  '), s - 0.5, false).editAsText().setForegroundColor(ET_GRAU);

  // ---- Enthält (A) oder Tagline (B)
  if (d.vorlage) {
    var tg = etText_(rechts, ET_TAGLINE[e.sprache] || ET_TAGLINE.EN, s, false);
    tg.editAsText().setItalic(true).setForegroundColor(ET_GOLD);
  } else if (d.enthaelt) {
    var pe = etText_(rechts, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }

  // ---- H- und P-Sätze in zwei Spalten (P102 immer, P321 nie)
  var pCodes = ET_IMMER_P.concat(d.p.filter(function (c) { return ET_IMMER_P.indexOf(c) === -1 && ETIKETT.ohneP.indexOf(c) === -1; }));
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = pCodes.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = ((rechtsMm - abstandMm) * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  // ---- UFI + Anschrift
  if (d.ufi) etText_(rechts, 'UFI: ' + d.ufi, s + 0.5, true);
  etText_(rechts, ETIKETT.adresse, s - 0.8, false).editAsText().setForegroundColor(ET_GRAU);
}

/* ================= Etikett-Layout v2.1 – Korrektur ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen (unter v2). Danach etSchriftCacheLeeren() einmal ausführen.
// 1) Text wird nach der Tagline nicht mehr kursiv/gold  2) breiter goldener Balken entfernt

function etStil_(p, size) {
  p.setSpacingBefore(0).setSpacingAfter(0).setLineSpacing(1.2);
  var a = {};
  a[DocumentApp.Attribute.FONT_FAMILY] = 'Arial';
  a[DocumentApp.Attribute.FONT_SIZE] = size;
  a[DocumentApp.Attribute.BOLD] = false;
  a[DocumentApp.Attribute.ITALIC] = false;
  a[DocumentApp.Attribute.FOREGROUND_COLOR] = '#000000';
  p.setAttributes(a);
  if (p.getText().length) {
    p.editAsText().setFontFamily('Arial').setFontSize(size).setBold(false).setItalic(false).setForegroundColor('#000000');
  }
  return p;
}

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm, abstandMm = 1.5;
  var rechtsMm = innen - ETIKETT.linksMm;

  var tab = body.appendTable([['', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM).setColumnWidth(1, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var rechts = etZelle_(tab.getCell(0, 1));
  rechts.setPaddingLeft(abstandMm * ET_MM);

  // ---- links: Logo, Piktogramme, Signalwort, Menge, Charge, Batch
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.logoId) { etLogo_(erste); erste.setSpacingAfter(3); z1 = etStil_(links.appendParagraph(''), s).setAlignment(C); }
  var pk = d.piktogramme.slice(0, 3);
  pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);
  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 3, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 0.5, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  etText_(links, 'Charge: ' + e.charge, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (d.batch) etText_(links, 'Batch: ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);

  // ---- rechts: Name · Qualität, Typ · SKU
  var name = d.produkt, q = e.qualitaet ? '  ·  ' + e.qualitaet : '';
  var r0 = rechts.getChild(0).asParagraph();
  r0.setText(name + q);
  etStil_(r0, s + 3);
  var t0 = r0.editAsText();
  if (name.length) t0.setBold(0, name.length - 1, true);
  if (q) t0.setFontSize(name.length, name.length + q.length - 1, s + 1).setForegroundColor(name.length, name.length + q.length - 1, ET_GOLD);
  etText_(rechts, [L.typ, e.sku].filter(String).join('  ·  '), s - 0.5, false).editAsText().setForegroundColor(ET_GRAU);

  // ---- Enthält (mit Zertifikat) oder Tagline (ohne Zertifikat)
  if (d.vorlage) {
    etText_(rechts, ET_TAGLINE[e.sprache] || ET_TAGLINE.EN, s, false).editAsText().setItalic(true).setForegroundColor(ET_GOLD);
  } else if (d.enthaelt) {
    var pe = etText_(rechts, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }

  // ---- H- und P-Sätze in zwei Spalten (P102 immer, P321 nie)
  var pCodes = ET_IMMER_P.concat(d.p.filter(function (c) { return ET_IMMER_P.indexOf(c) === -1 && ETIKETT.ohneP.indexOf(c) === -1; }));
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = pCodes.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = ((rechtsMm - abstandMm) * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  // ---- UFI + Anschrift
  if (d.ufi) etText_(rechts, 'UFI: ' + d.ufi, s + 0.5, true);
  etText_(rechts, ETIKETT.adresse, s - 0.8, false).editAsText().setForegroundColor(ET_GRAU);
}

/* ================= Etikett-Layout v3 – Adresse links, immer 1 Seite ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen (unter v2 und v2.1). Kein Cache-Löschen mehr nötig.

var ET_LAYOUT = 'v3';            // bei jeder Layout-Änderung erhöhen → Schriftgrößen werden automatisch neu berechnet
var ET_KLEIN = [4.5, 4, 3.5];
ETIKETT.piktoMm = 14;            // Piktogramme etwas kleiner → Platz für die Adresse links

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm, abstandMm = 1.5;
  var rechtsMm = innen - ETIKETT.linksMm;

  var tab = body.appendTable([['', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM).setColumnWidth(1, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var rechts = etZelle_(tab.getCell(0, 1));
  rechts.setPaddingLeft(abstandMm * ET_MM);

  // ---- links: Logo, Piktogramme, Signalwort, Menge, Charge, Batch, Adresse
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.logoId) { etLogo_(erste); erste.setSpacingAfter(2); z1 = etStil_(links.appendParagraph(''), s).setAlignment(C); }
  var pk = d.piktogramme.slice(0, 3);
  pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);
  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 3, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 0.5, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  etText_(links, 'Charge: ' + e.charge, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (d.batch) etText_(links, 'Batch: ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  ETIKETT.adresse.split(/,\s*/).forEach(function (zeile, i) {
    var a = etText_(links, zeile, s - 1, false, C);
    a.editAsText().setForegroundColor(ET_GRAU);
    if (i === 0) a.setSpacingBefore(2);
  });

  // ---- rechts: Name · Qualität, Typ · SKU
  var name = d.produkt, q = e.qualitaet ? '  ·  ' + e.qualitaet : '';
  var r0 = rechts.getChild(0).asParagraph();
  r0.setText(name + q);
  etStil_(r0, s + 3);
  var t0 = r0.editAsText();
  if (name.length) t0.setBold(0, name.length - 1, true);
  if (q) t0.setFontSize(name.length, name.length + q.length - 1, s + 1).setForegroundColor(name.length, name.length + q.length - 1, ET_GOLD);
  etText_(rechts, [L.typ, e.sku].filter(String).join('  ·  '), s - 0.5, false).editAsText().setForegroundColor(ET_GRAU);

  // ---- Enthält (mit Zertifikat) oder Tagline (ohne Zertifikat)
  if (d.vorlage) {
    etText_(rechts, ET_TAGLINE[e.sprache] || ET_TAGLINE.EN, s, false).editAsText().setItalic(true).setForegroundColor(ET_GOLD);
  } else if (d.enthaelt) {
    var pe = etText_(rechts, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }

  // ---- H- und P-Sätze in zwei Spalten (P102 immer, P321 nie)
  var pCodes = ET_IMMER_P.concat(d.p.filter(function (c) { return ET_IMMER_P.indexOf(c) === -1 && ETIKETT.ohneP.indexOf(c) === -1; }));
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = pCodes.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = ((rechtsMm - abstandMm) * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  // ---- UFI
  if (d.ufi) etText_(rechts, 'UFI: ' + d.ufi, s + 0.5, true);
}

/** Findet die größte Schrift, bei der das Etikett auf 1 Seite passt – gemerkt je Produkt + Layout-Version. */
function etPassendeSchrift_(e) {
  var d = e.daten;
  var sig = [ET_LAYOUT, d.code, d.produkt, d.signal, d.piktogramme.join(','), d.h.join(','), d.p.join(','),
             d.enthaelt, d.batch, d.ufi || '', d.vorlage ? 'B' : 'A', e.sprache, e.gewicht, e.sku, e.qualitaet,
             String(e.charge).length, ETIKETT.linksMm, ETIKETT.piktoMm, ETIKETT.adresse + ((ETIKETT.adresseOben && ETIKETT.logoId) ? '#L16' + ETIKETT.logoId : '')].join('|');
  var key = 'ETS3_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig, Utilities.Charset.UTF_8)).slice(0, 22);
  var props = PropertiesService.getScriptProperties();
  var gemerkt = props.getProperty(key);
  if (gemerkt) return Number(gemerkt);

  var liste = ETIKETT.schriftgroessen.concat(ET_KLEIN, [3.2, 3]);
  var passend = liste[liste.length - 1];
  for (var i = 0; i < liste.length; i++) {
    var datei = DriveApp.getFileById(etBaueDoc_([{ e: e, schrift: liste[i] }]));
    var seiten = etSeiten_(datei.getAs('application/pdf'));
    datei.setTrashed(true);
    if (seiten <= 1) { passend = liste[i]; break; }
    if (i === liste.length - 1) Logger.log('WARNUNG: ' + d.produkt + ' (' + e.sprache + ') passt nicht auf 1 Etikett.');
  }
  props.setProperty(key, String(passend));
  return passend;
}

/** Alte gemerkte Schriftgrößen löschen (alle Versionen). */
function etSchriftCacheLeeren() {
  var props = PropertiesService.getScriptProperties(), n = 0;
  props.getKeys().forEach(function (k) {
    if (/^ET(S|S3|X)_/.test(k)) { props.deleteProperty(k); n++; }
  });
  Logger.log(n + ' gemerkte Schriftgrößen gelöscht.');
}
/* ================= Etikett-Layout v4 – QR-Code "Nachbestellen" ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen (unter v3).
// Nur auf Duftöl-Etiketten 102 × 51 mm. Pflichtangaben bleiben unverändert.
// QR öffnet: fragranceshub.de/products/<handle>?variant=<id>&utm_source=etikett
// (falls Shopify keine Variante liefert: Shop-Suche nach der SKU)

var ET_LAYOUT = 'v4';            // neue Version → Schriftgrößen werden automatisch neu berechnet

var ETIKETT_QR = {
  aktiv: true,                   // false = Etiketten wieder ohne QR
  shop: 'https://fragranceshub.de',
  groesseMm: 15,
  text: { DE: 'Nachbestellen', EN: 'Reorder', NL: 'Nabestellen', FR: 'Recommander',
          IT: 'Riordina', ES: 'Volver a pedir', PL: 'Zamów ponownie' }
};

/** Link zur genauen Variante (Qualität + Größe) aus der Bestellposition */
function etQrUrl_(li) {
  var vid = li && li.variant && li.variant.legacyResourceId;
  var handle = li && li.product && li.product.handle;
  if (!vid || !handle) return '';
  return ETIKETT_QR.shop + '/products/' + handle + '?variant=' + vid + '&utm_source=etikett';
}

/** Ersatz, wenn keine Variante bekannt ist (z.B. testEtikett) */
function etQrSuche_(sku) {
  return sku ? ETIKETT_QR.shop + '/search?q=' + encodeURIComponent(sku) + '&utm_source=etikett' : '';
}

/** QR als PNG – zwei Dienste zur Sicherheit; bei Fehler wird das Etikett einfach ohne QR gedruckt */
function etQrBlob_(url) {
  var key = 'QR|' + url;
  if (ET_BLOBS[key]) return ET_BLOBS[key].copyBlob();
  var t = encodeURIComponent(url);
  var quellen = [
    'https://quickchart.io/qr?size=400&margin=1&ecLevel=M&format=png&text=' + t,
    'https://api.qrserver.com/v1/create-qr-code/?size=400x400&margin=4&ecc=M&format=png&data=' + t
  ];
  for (var i = 0; i < quellen.length; i++) {
    try {
      var r = UrlFetchApp.fetch(quellen[i], { muteHttpExceptions: true });
      var b = r.getBlob();
      if (r.getResponseCode() === 200 && /^image\//.test(b.getContentType())) {
        ET_BLOBS[key] = b.setName('qr.png');
        return ET_BLOBS[key].copyBlob();
      }
      Logger.log('QR-Dienst ' + (i + 1) + ': Fehler ' + r.getResponseCode());
    } catch (e) {
      Logger.log('QR-Dienst ' + (i + 1) + ': ' + e.message);
    }
  }
  Logger.log('WARNUNG: kein QR für ' + url + ' – Etikett ohne QR.');
  return null;
}

/** Bestellungen inkl. Variante + Handle; falls Rechte fehlen, schrittweise ohne */
function etHoleBestellungen_(q, first) {
  var adr = 'billingAddress { firstName lastName company countryCodeV2 } ' +
            'shippingAddress { firstName lastName company countryCodeV2 } ';
  var adrKurz = 'billingAddress { firstName lastName company } ';
  var li = 'sku title variantTitle quantity currentQuantity';
  var qr = ' variant { legacyResourceId } product { handle }';
  var stufen = [[adr, li + qr], [adr, li], [adrKurz, li + qr], [adrKurz, li]];
  var fehler = null;
  for (var i = 0; i < stufen.length; i++) {
    try {
      return shopifyGraphQL('query($q: String!, $first: Int!) { orders(first: $first, query: $q, sortKey: CREATED_AT) { nodes { ' +
        'id name tags ' + stufen[i][0] + 'lineItems(first: 250) { nodes { ' + stufen[i][1] + ' } } } } }',
        { q: q, first: first }).orders.nodes;
    } catch (e) {
      fehler = e;
      Logger.log('Abfrage-Stufe ' + (i + 1) + ' fehlgeschlagen: ' + e.message.slice(0, 200));
    }
  }
  throw fehler;
}

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm, abstandMm = 1.5;
  var rechtsMm = innen - ETIKETT.linksMm;

  var tab = body.appendTable([['', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM).setColumnWidth(1, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var rechts = etZelle_(tab.getCell(0, 1));
  rechts.setPaddingLeft(abstandMm * ET_MM);

  // ---- links: unverändert wie v3
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.logoId) { etLogo_(erste); erste.setSpacingAfter(2); z1 = etStil_(links.appendParagraph(''), s).setAlignment(C); }
  var pk = d.piktogramme.slice(0, 3);
  pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);
  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 3, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 0.5, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  etText_(links, 'Charge: ' + e.charge, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (d.batch) etText_(links, 'Batch: ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  ETIKETT.adresse.split(/,\s*/).forEach(function (zeile, i) {
    var a = etText_(links, zeile, s - 1, false, C);
    a.editAsText().setForegroundColor(ET_GRAU);
    if (i === 0) a.setSpacingBefore(2);
  });

  // ---- rechts oben: Kopf (Name, Typ, Enthält/Tagline) + QR daneben
  var url = ETIKETT_QR.aktiv ? (e.qrUrl || etQrSuche_(e.sku)) : '';
  var kopfZelle = rechts;
  if (url) {
    etKlein_(rechts.getChild(0).asParagraph());
    var kopf = rechts.appendTable([['', '']]);
    kopf.setBorderWidth(0);
    var gesamt = (rechtsMm - abstandMm) * ET_MM - 2;
    var qrBreite = (ETIKETT_QR.groesseMm + 1) * ET_MM;
    kopf.setColumnWidth(0, gesamt - qrBreite).setColumnWidth(1, qrBreite);
    kopfZelle = etZelle_(kopf.getCell(0, 0)).setPaddingLeft(0);
    var qrZelle = etZelle_(kopf.getCell(0, 1)).setPaddingLeft(0).setPaddingRight(0);
    var qp = etStil_(qrZelle.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
    var blob = etQrBlob_(url);
    if (blob) {
      var mm = ETIKETT_QR.groesseMm * ET_MM;
      qp.appendInlineImage(blob).setWidth(mm).setHeight(mm);
      etText_(qrZelle, ETIKETT_QR.text[e.sprache] || ETIKETT_QR.text.EN, Math.max(s - 0.5, 3), true, C)
        .editAsText().setForegroundColor(ET_GOLD);
    }
  }

  var name = d.produkt, q = e.qualitaet ? '  ·  ' + e.qualitaet : '';
  var r0 = kopfZelle.getChild(0).asParagraph();
  r0.setText(name + q);
  etStil_(r0, s + 3);
  var t0 = r0.editAsText();
  if (name.length) t0.setBold(0, name.length - 1, true);
  if (q) t0.setFontSize(name.length, name.length + q.length - 1, s + 1).setForegroundColor(name.length, name.length + q.length - 1, ET_GOLD);
  etText_(kopfZelle, [L.typ, e.sku].filter(String).join('  ·  '), s - 0.5, false).editAsText().setForegroundColor(ET_GRAU);
  if (d.vorlage) {
    etText_(kopfZelle, ET_TAGLINE[e.sprache] || ET_TAGLINE.EN, s, false).editAsText().setItalic(true).setForegroundColor(ET_GOLD);
  } else if (d.enthaelt) {
    var pe = etText_(kopfZelle, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }
  if (url) etKlein_(rechts.appendParagraph(''));

  // ---- H- und P-Sätze (volle Breite, unverändert)
  var pCodes = ET_IMMER_P.concat(d.p.filter(function (c) { return ET_IMMER_P.indexOf(c) === -1 && ETIKETT.ohneP.indexOf(c) === -1; }));
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = pCodes.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = ((rechtsMm - abstandMm) * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  if (d.ufi) etText_(rechts, 'UFI: ' + d.ufi, s + 0.5, true);
}

/** Test: zeigt die QR-Links einer Bestellung im Protokoll (ohne Etiketten zu senden) */
function testQrLinks() {
  var nr = String(ETIKETT.testBestellung).replace('#', '').trim();
  var order = etFindeBestellung_(nr);
  if (!order) throw new Error('Bestellung nicht gefunden: ' + nr);
  order.lineItems.nodes.forEach(function (li) {
    Logger.log(li.title + ' – ' + (li.variantTitle || '') + '\n   → ' + (etQrUrl_(li) || '(keine Variante → Shop-Suche)'));
  });
}

/* ================= Etikett-Layout v5 – Qualität farbig (Bronze / Silber / Gold) ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen (unter v4). Ersetzt etZeichne_ und etZeichneProbe_ weiter oben.
// Pflichtangaben (Piktogramme, H-/P-Sätze, UFI, Anschrift) bleiben unverändert.
// Bewusst KEINE Raute ◆ und KEIN Rot – damit nichts mit GHS-Gefahrenpiktogrammen verwechselt wird.

var ET_LAYOUT = 'v5';            // neue Version → Schriftgrößen werden automatisch neu berechnet

var ET_QUALITAET = {
  Standard: { symbol: '●',  farbe: '#9A5F28' },   // Bronze
  Premium:  { symbol: '★',  farbe: '#6E747D' },   // Silber (dunkel genug für den Druck)
  Exklusiv: { symbol: '★★', farbe: '#B08A2E' }    // Gold
};

/** "🥇 Exklusiv", "Premium & Exklusiv", "Exklusive" … → { name, symbol, farbe } oder null */
function etQualitaet_(q) {
  var s = String(q || '').toLowerCase();
  var name = /premium/.test(s) ? 'Premium' : /exklusiv/.test(s) ? 'Exklusiv' : /standard/.test(s) ? 'Standard' : '';
  if (!name) return null;
  return { name: name, symbol: ET_QUALITAET[name].symbol, farbe: ET_QUALITAET[name].farbe };
}

/** Schreibt "Produktname   ★★ Exklusiv" in einen Absatz – Name fett, Qualität farbig */
function etNameMitQualitaet_(p, name, qualitaet, groesseName, groesseQual) {
  var Q = etQualitaet_(qualitaet);
  var teil = Q ? '   ' + Q.symbol + ' ' + Q.name : '';
  p.setText(name + teil);
  etStil_(p, groesseName);
  var t = p.editAsText();
  if (name.length) t.setBold(0, name.length - 1, true);
  if (Q) {
    var a = name.length, b = name.length + teil.length - 1;
    t.setFontSize(a, b, groesseQual).setForegroundColor(a, b, Q.farbe).setBold(a, b, true);
  }
  return p;
}

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm, abstandMm = 1.5;
  var rechtsMm = innen - ETIKETT.linksMm;

  var tab = body.appendTable([['', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM).setColumnWidth(1, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var rechts = etZelle_(tab.getCell(0, 1));
  rechts.setPaddingLeft(abstandMm * ET_MM);

  // ---- links: unverändert wie v4
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.logoId) { etLogo_(erste); erste.setSpacingAfter(2); z1 = etStil_(links.appendParagraph(''), s).setAlignment(C); }
  var pk = d.piktogramme.slice(0, 3);
  pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);
  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 3, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 0.5, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  etText_(links, 'Charge: ' + e.charge, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (d.batch) etText_(links, 'Batch: ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  ETIKETT.adresse.split(/,\s*/).forEach(function (zeile, i) {
    var a = etText_(links, zeile, s - 1, false, C);
    a.editAsText().setForegroundColor(ET_GRAU);
    if (i === 0) a.setSpacingBefore(2);
  });

  // ---- rechts oben: Kopf + QR (wie v4)
  var url = ETIKETT_QR.aktiv ? (e.qrUrl || etQrSuche_(e.sku)) : '';
  var kopfZelle = rechts;
  if (url) {
    etKlein_(rechts.getChild(0).asParagraph());
    var kopf = rechts.appendTable([['', '']]);
    kopf.setBorderWidth(0);
    var gesamt = (rechtsMm - abstandMm) * ET_MM - 2;
    var qrBreite = (ETIKETT_QR.groesseMm + 1) * ET_MM;
    kopf.setColumnWidth(0, gesamt - qrBreite).setColumnWidth(1, qrBreite);
    kopfZelle = etZelle_(kopf.getCell(0, 0)).setPaddingLeft(0);
    var qrZelle = etZelle_(kopf.getCell(0, 1)).setPaddingLeft(0).setPaddingRight(0);
    var qp = etStil_(qrZelle.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
    var blob = etQrBlob_(url);
    if (blob) {
      var mm = ETIKETT_QR.groesseMm * ET_MM;
      qp.appendInlineImage(blob).setWidth(mm).setHeight(mm);
      etText_(qrZelle, ETIKETT_QR.text[e.sprache] || ETIKETT_QR.text.EN, Math.max(s - 0.5, 3), true, C)
        .editAsText().setForegroundColor(ET_GOLD);
    }
  }

  // ---- NEU: Name + farbige Qualität
  etNameMitQualitaet_(kopfZelle.getChild(0).asParagraph(), d.produkt, e.qualitaet, s + 3, s + 1.5);
  etText_(kopfZelle, [L.typ, e.sku].filter(String).join('  ·  '), s - 0.5, false).editAsText().setForegroundColor(ET_GRAU);
  if (d.vorlage) {
    etText_(kopfZelle, ET_TAGLINE[e.sprache] || ET_TAGLINE.EN, s, false).editAsText().setItalic(true).setForegroundColor(ET_GOLD);
  } else if (d.enthaelt) {
    var pe = etText_(kopfZelle, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }
  if (url) etKlein_(rechts.appendParagraph(''));

  // ---- H- und P-Sätze (unverändert)
  var pCodes = ET_IMMER_P.concat(d.p.filter(function (c) { return ET_IMMER_P.indexOf(c) === -1 && ETIKETT.ohneP.indexOf(c) === -1; }));
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = pCodes.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = ((rechtsMm - abstandMm) * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  if (d.ufi) etText_(rechts, 'UFI: ' + d.ufi, s + 0.5, true);
}

/** Probe-Etikett 40 × 30 mm – Qualität als eigene farbige Zeile */
function etZeichneProbe_(body, x) {
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var f = x.f || 1;
  if (ETIKETT.logoId) etLogo_(etStil_(body.appendParagraph(''), 6 * f).setAlignment(C).setLineSpacing(1),
                              ETIKETT.probeLogoHoeheMm * f, (ETIKETT.probeBreiteMm - 4) * f);
  var n = etStil_(body.appendParagraph(x.name), 7 * f).setAlignment(C);
  n.editAsText().setBold(true);
  var Q = etQualitaet_(x.qualitaet);
  if (Q) {
    var q = etStil_(body.appendParagraph(Q.symbol + ' ' + Q.name), 6.5 * f).setAlignment(C);
    q.editAsText().setBold(true).setForegroundColor(Q.farbe);
  }
  etStil_(body.appendParagraph(x.sku + ' · ' + x.gewicht), 6 * f).setAlignment(C);
  etStil_(body.appendParagraph('Charge: ' + x.charge), 5.5 * f).setAlignment(C);
  etStil_(body.appendParagraph('Batch: ' + x.batch), 5.5 * f).setAlignment(C);
  var pr = etStil_(body.appendParagraph('Probe / Sample'), 6.5 * f).setAlignment(C);
  pr.editAsText().setBold(true);
}

/** Test: je 1 Etikett + 1 Probe-Etikett für Standard, Premium und Exklusiv → Links im Protokoll */
function testQualitaetsFarben() {
  var pos = ['Standard', 'Premium', 'Exklusiv'].map(function (q) {
    return { fabrikCode: '1010019', sku: 'CR-AVE-H-04-PQ-SH', qualitaet: q, gewicht: '250 g', menge: 1, titel: 'Avenuetus' };
  });
  var res = erstelleEtikettenPdf_({ name: '#TEST', laenderCode: 'DE', positionen: pos });
  if (res.pdf) Logger.log('Etiketten 102 × 51: ' + etOrdner_().createFile(res.pdf).getUrl());
  else Logger.log('Kein Etikett: ' + res.fehlend.join(' | '));
  var proben = erstelleProbenPdf_('#TEST', pos.map(function (p) {
    return { fabrikCode: p.fabrikCode, sku: p.sku, qualitaet: p.qualitaet, gewicht: '6 g', menge: 1, produkt: 'Avenuetus' };
  }));
  if (proben.pdf) Logger.log('Proben 40 × 30: ' + etOrdner_().createFile(proben.pdf).getUrl());
}

/* ================= Etikett-Layout v5 – Qualität farbig (Bronze / Silber / Gold) ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen (unter v4). Ersetzt etZeichne_ und etZeichneProbe_ weiter oben.
// Pflichtangaben (Piktogramme, H-/P-Sätze, UFI, Anschrift) bleiben unverändert.
// Bewusst KEINE Raute ◆ und KEIN Rot – damit nichts mit GHS-Gefahrenpiktogrammen verwechselt wird.

var ET_LAYOUT = 'v5';            // neue Version → Schriftgrößen werden automatisch neu berechnet

var ET_QUALITAET = {
  Standard: { symbol: '●',  farbe: '#9A5F28' },   // Bronze
  Premium:  { symbol: '★',  farbe: '#6E747D' },   // Silber (dunkel genug für den Druck)
  Exklusiv: { symbol: '★★', farbe: '#B08A2E' }    // Gold
};

/** "🥇 Exklusiv", "Premium & Exklusiv", "Exklusive" … → { name, symbol, farbe } oder null */
function etQualitaet_(q) {
  var s = String(q || '').toLowerCase();
  var name = /premium/.test(s) ? 'Premium' : /exklusiv/.test(s) ? 'Exklusiv' : /standard/.test(s) ? 'Standard' : '';
  if (!name) return null;
  return { name: name, symbol: ET_QUALITAET[name].symbol, farbe: ET_QUALITAET[name].farbe };
}

/** Schreibt "Produktname   ★★ Exklusiv" in einen Absatz – Name fett, Qualität farbig */
function etNameMitQualitaet_(p, name, qualitaet, groesseName, groesseQual) {
  var Q = etQualitaet_(qualitaet);
  var teil = Q ? '   ' + Q.symbol + ' ' + Q.name : '';
  p.setText(name + teil);
  etStil_(p, groesseName);
  var t = p.editAsText();
  if (name.length) t.setBold(0, name.length - 1, true);
  if (Q) {
    var a = name.length, b = name.length + teil.length - 1;
    t.setFontSize(a, b, groesseQual).setForegroundColor(a, b, Q.farbe).setBold(a, b, true);
  }
  return p;
}

function etZeichne_(body, e, s) {
  var L = ETIKETT_SPRACHEN[e.sprache], d = e.daten;
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var innen = ETIKETT.breiteMm - 2 * ETIKETT.randMm, abstandMm = 1.5;
  var rechtsMm = innen - ETIKETT.linksMm;

  var tab = body.appendTable([['', '']]);
  tab.setBorderWidth(0);
  tab.setColumnWidth(0, ETIKETT.linksMm * ET_MM).setColumnWidth(1, rechtsMm * ET_MM);
  var links = etZelle_(tab.getCell(0, 0));
  var rechts = etZelle_(tab.getCell(0, 1));
  rechts.setPaddingLeft(abstandMm * ET_MM);

  // ---- links: unverändert wie v4
  var erste = etStil_(links.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
  var z1 = erste;
  if (ETIKETT.adresseOben && ETIKETT.adresse) {   // Showroom: Kundenadresse oben links, über den GHS-Piktogrammen
    var adrZeilen = String(ETIKETT.adresse).split(/\s*[,;|\n]\s*/).filter(String);
    if (ETIKETT.logoId) {   // Kundenlogo über der Kundenadresse
      try { etLogo_(erste, ETIKETT.kundenLogoHoeheMm || 16, ETIKETT.linksMm - 2); erste.setSpacingAfter(1); erste = links.appendParagraph(''); }
      catch (eLogo) { Logger.log('Kundenlogo nicht ladbar: ' + eLogo); }
    }
    erste.setText(adrZeilen[0] || '');
    etStil_(erste, s - 0.5).setAlignment(C).setLineSpacing(1);
    erste.editAsText().setBold(true);
    adrZeilen.slice(1).forEach(function (zeile) { etStil_(links.appendParagraph(zeile), s - 1).setAlignment(C).setLineSpacing(1); });
    links.getChild(links.getNumChildren() - 1).asParagraph().setSpacingAfter(2);
    z1 = etStil_(links.appendParagraph(''), s).setAlignment(C);
  } else if (ETIKETT.logoId) { etLogo_(erste); erste.setSpacingAfter(2); z1 = etStil_(links.appendParagraph(''), s).setAlignment(C); }
  var pk = d.piktogramme.slice(0, 3);
  // mit Kundenlogo: 3 Piktogramme in EINER Reihe (10 mm), damit das Logo groß genug Platz hat
  var kLogo3 = !!(ETIKETT.adresseOben && ETIKETT.adresse && ETIKETT.logoId) && pk.length > 2;
  if (kLogo3) pk.forEach(function (g) { etBild_(z1, 'PIKTO_' + g, 10); });
  else pk.slice(0, 2).forEach(function (g) { etBild_(z1, 'PIKTO_' + g, ETIKETT.piktoMm); });
  if (!kLogo3 && pk.length > 2) etBild_(etStil_(links.appendParagraph(''), s).setAlignment(C), 'PIKTO_' + pk[2], ETIKETT.piktoMm);
  var sig = L.signal[d.signal] || '';
  if (sig) etText_(links, sig, s + 3, true, C);
  var pm = etText_(links, L.menge + ': ' + e.gewicht, s + 0.5, false, C);
  pm.editAsText().setBold(L.menge.length + 2, pm.getText().length - 1, true);
  etText_(links, 'Charge: ' + e.charge, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (d.batch) etText_(links, 'Batch: ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (!ETIKETT.adresseOben) ETIKETT.adresse.split(/,\s*/).forEach(function (zeile, i) {
    var a = etText_(links, zeile, s - 1, false, C);
    a.editAsText().setForegroundColor(ET_GRAU);
    if (i === 0) a.setSpacingBefore(2);
  });

  // ---- rechts oben: Kopf + QR (wie v4)
  var url = ETIKETT_QR.aktiv ? (e.qrUrl || etQrSuche_(e.sku)) : '';
  var kopfZelle = rechts;
  if (url) {
    etKlein_(rechts.getChild(0).asParagraph());
    var kopf = rechts.appendTable([['', '']]);
    kopf.setBorderWidth(0);
    var gesamt = (rechtsMm - abstandMm) * ET_MM - 2;
    var qrBreite = (ETIKETT_QR.groesseMm + 1) * ET_MM;
    kopf.setColumnWidth(0, gesamt - qrBreite).setColumnWidth(1, qrBreite);
    kopfZelle = etZelle_(kopf.getCell(0, 0)).setPaddingLeft(0);
    var qrZelle = etZelle_(kopf.getCell(0, 1)).setPaddingLeft(0).setPaddingRight(0);
    var qp = etStil_(qrZelle.getChild(0).asParagraph(), s).setAlignment(C).setLineSpacing(1);
    var blob = etQrBlob_(url);
    if (blob) {
      var mm = ETIKETT_QR.groesseMm * ET_MM;
      qp.appendInlineImage(blob).setWidth(mm).setHeight(mm);
      etText_(qrZelle, ETIKETT_QR.text[e.sprache] || ETIKETT_QR.text.EN, Math.max(s - 0.5, 3), true, C)
        .editAsText().setForegroundColor(ET_GOLD);
    }
  }

  // ---- NEU: Name (fett) und darunter die farbige Qualität in eigener Zeile
  var r0 = kopfZelle.getChild(0).asParagraph();
  r0.setText(d.produkt);
  etStil_(r0, s + 3);
  if (d.produkt.length) r0.editAsText().setBold(true);
  var Q = etQualitaet_(e.qualitaet);
  if (Q) etText_(kopfZelle, Q.symbol + ' ' + Q.name, s + 1.5, true).editAsText().setForegroundColor(Q.farbe);
  etText_(kopfZelle, [L.typ, e.sku].filter(String).join('  ·  '), s - 0.5, false).editAsText().setForegroundColor(ET_GRAU);
  if (d.vorlage) {
    etText_(kopfZelle, ET_TAGLINE[e.sprache] || ET_TAGLINE.EN, s, false).editAsText().setItalic(true).setForegroundColor(ET_GOLD);
  } else if (d.enthaelt) {
    var pe = etText_(kopfZelle, L.enthaelt + ': ' + d.enthaelt, s, false);
    pe.editAsText().setBold(0, L.enthaelt.length, true);
  }
  if (url) etKlein_(rechts.appendParagraph(''));

  // ---- H- und P-Sätze (unverändert)
  var pCodes = ET_IMMER_P.concat(d.p.filter(function (c) { return ET_IMMER_P.indexOf(c) === -1 && ETIKETT.ohneP.indexOf(c) === -1; }));
  var hTexte = d.h.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var pTexte = pCodes.map(function (c) { return etSatz_(e.saetze, c, L.spalte); });
  var hp = rechts.appendTable([['', '']]);
  hp.setBorderWidth(0);
  var spalte = ((rechtsMm - abstandMm) * ET_MM - 4) / 2;
  hp.setColumnWidth(0, spalte).setColumnWidth(1, spalte);
  etFuelle_(hp.getCell(0, 0), hTexte, s);
  etFuelle_(hp.getCell(0, 1), pTexte, s);

  if (d.ufi) etText_(rechts, 'UFI: ' + d.ufi, s + 0.5, true);
}

/** Probe-Etikett 40 × 30 mm – Qualität als eigene farbige Zeile */
function etZeichneProbe_(body, x) {
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var f = x.f || 1;
  if (ETIKETT.logoId) etLogo_(etStil_(body.appendParagraph(''), 6 * f).setAlignment(C).setLineSpacing(1),
                              ETIKETT.probeLogoHoeheMm * f, (ETIKETT.probeBreiteMm - 4) * f);
  var n = etStil_(body.appendParagraph(x.name), 7 * f).setAlignment(C);
  n.editAsText().setBold(true);
  var Q = etQualitaet_(x.qualitaet);
  if (Q) {
    var q = etStil_(body.appendParagraph(Q.symbol + ' ' + Q.name), 6.5 * f).setAlignment(C);
    q.editAsText().setBold(true).setForegroundColor(Q.farbe);
  }
  etStil_(body.appendParagraph(x.sku + ' · ' + x.gewicht), 6 * f).setAlignment(C);
  etStil_(body.appendParagraph('Charge: ' + x.charge), 5.5 * f).setAlignment(C);
  etStil_(body.appendParagraph('Batch: ' + x.batch), 5.5 * f).setAlignment(C);
  var pr = etStil_(body.appendParagraph('Probe / Sample'), 6.5 * f).setAlignment(C);
  pr.editAsText().setBold(true);
}

/** Test: je 1 Etikett + 1 Probe-Etikett für Standard, Premium und Exklusiv → Links im Protokoll */
function testQualitaetsFarben() {
  var pos = ['Standard', 'Premium', 'Exklusiv'].map(function (q) {
    return { fabrikCode: '1010019', sku: 'CR-AVE-H-04-PQ-SH', qualitaet: q, gewicht: '250 g', menge: 1, titel: 'Avenuetus' };
  });
  var res = erstelleEtikettenPdf_({ name: '#TEST', laenderCode: 'DE', positionen: pos });
  if (res.pdf) Logger.log('Etiketten 102 × 51: ' + etOrdner_().createFile(res.pdf).getUrl());
  else Logger.log('Kein Etikett: ' + res.fehlend.join(' | '));
  var proben = erstelleProbenPdf_('#TEST', pos.map(function (p) {
    return { fabrikCode: p.fabrikCode, sku: p.sku, qualitaet: p.qualitaet, gewicht: '6 g', menge: 1, produkt: 'Avenuetus' };
  }));
  if (proben.pdf) Logger.log('Proben 40 × 30: ' + etOrdner_().createFile(proben.pdf).getUrl());
}

/* ================= Probiersets (PS-…) → einzelne Proben-Etiketten ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen. Ersetzt etHoleBestellungen_ (v4) weiter oben.
// Feste Sets: Düfte aus PROBIERSETS (Reihenfolge = 5 / 10 / 20).
// Set nach Wahl: Düfte aus den Bestell-Eigenschaften "Duft 1", "Duft 2" …
// Jeder Duft bekommt ein normales Proben-Etikett 40 × 30 mm (6 g, Premium/Exklusiv).

var PROBIERSETS = {
  BEST: ['FHG Naxos', 'Avenuetus', 'Pure Vision', 'Pura Mirage', 'Urban Savage',
         'Rouge 440', 'Desert Shadow', 'Blue de Blue', 'Blue Talisman', 'FHG Vibranto Musk',
         'Maracuja Oud', 'Angola Share', 'Cherry Love', 'Oriental Tonka', 'FHG Altairis',
         'FHG Tobacco Vanilla', 'Laiton', 'Exotic Kirke', 'FHG London', 'Ocean Breeze'],
  HER:  ['Avenuetus', 'Urban Savage', 'Pure Vision', 'Blue de Blue', 'FHG Naxos',
         'Strong for You', 'Desert Shadow', 'Blue Talisman', 'Rouge 440', 'FHG Vibranto Musk',
         'Laiton', 'FHG Altairis', 'Ammbass Men', 'Aqua Maris Signature', 'FHG Tobacco Vanilla',
         'Oriental Tonka', 'Maracuja Oud', 'FHG London', 'Angola Share', 'Ocean Breeze'],
  DAM:  ['Rose Voyage', 'Silent Hours', 'Heroine 212', 'Vanilla Candy Rock Sugar', 'Liebe le Parfum',
         'Portit of a Lady', 'Pura Mirage', 'Rouge 440', 'Blue Talisman', 'FHG Vibranto Musk',
         'Cherry Love', 'Exotic Kirke', 'White Musk', 'Ocean Breeze', 'Oriental Tonka',
         'FHG Tobacco Vanilla', 'Angola Share', 'Maracuja Oud', 'FHG London', 'FHG Naxos']
};

var PS_CACHE = {};

function psNorm_(t) {
  return String(t || '').toLowerCase().replace(/^fhg\s+/, '').replace(/\|.*$/, '').replace(/[^a-z0-9]/g, '');
}

/** Duftname → { sku, title, variantTitle } der 6-g-Probe (Premium/Exklusiv bevorzugt) – über den öffentlichen Shop */
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
    var treffer = oele.filter(function (p) { return psNorm_(p.title) === key; })[0] ||
                  oele.filter(function (p) { return psNorm_(p.title).indexOf(key) === 0; })[0] || oele[0];
    if (treffer) {
      var pr = JSON.parse(UrlFetchApp.fetch(basis + '/products/' + treffer.handle + '.js',
        { muteHttpExceptions: true, followRedirects: true }).getContentText());
      var proben = (pr.variants || []).filter(function (v) { return /6\s*g\b/i.test(v.title) && /probe|sample/i.test(v.title); });
      var v = proben.filter(function (x) { return /premium|exklusiv/i.test(x.title); })[0] || proben[0];
      if (v && v.sku) ergebnis = { sku: v.sku, title: pr.title, variantTitle: v.title };
    }
  } catch (e) {
    Logger.log('Probierset: Suche nach "' + name + '" fehlgeschlagen: ' + e.message);
  }
  PS_CACHE[key] = ergebnis;
  return ergebnis;
}

/** Ersetzt jede Probierset-Position durch ihre einzelnen 6-g-Proben */
function psErweitere_(order) {
  var neu = [];
  order.lineItems.nodes.forEach(function (li) {
    var m = String(li.sku || '').toUpperCase().match(/^PS-([A-Z]+)-(\d+)/);
    if (!m) { neu.push(li); return; }
    var menge = (li.currentQuantity != null ? li.currentQuantity : li.quantity) || 0;
    var anzahl = Number(m[2]), namen = [];
    if (m[1] === 'WAHL') {
      namen = (li.customAttributes || [])
        .filter(function (a) { return /^Duft\s*\d+$/i.test(a.key) && String(a.value || '').trim(); })
        .sort(function (a, b) { return Number(a.key.replace(/\D/g, '')) - Number(b.key.replace(/\D/g, '')); })
        .map(function (a) { return String(a.value).trim(); });
    } else {
      namen = (PROBIERSETS[m[1]] || []).slice(0, anzahl);
    }
    if (!namen.length) {
      neu.push({ sku: '', title: 'Probierset ' + li.title + ' – Düfte unbekannt, bitte manuell',
                 variantTitle: li.variantTitle, quantity: menge, currentQuantity: menge });
      return;
    }
    namen.forEach(function (n) {
      var p = psFindeProbe_(n);
      neu.push(p ? { sku: p.sku, title: p.title, variantTitle: p.variantTitle, quantity: menge, currentQuantity: menge }
                 : { sku: '', title: 'Probierset: "' + n + '" nicht gefunden – bitte manuell',
                     variantTitle: '', quantity: menge, currentQuantity: menge });
    });
    Logger.log(order.name + ': ' + li.title + ' (' + li.variantTitle + ') → ' + namen.length + ' Proben');
  });
  order.lineItems.nodes = neu;
  return order;
}

/** Wie v4, zusätzlich mit Bestell-Eigenschaften (Duft 1 …) und Probierset-Erweiterung */
function etHoleBestellungen_(q, first) {
  var adr = 'billingAddress { firstName lastName company countryCodeV2 } ' +
            'shippingAddress { firstName lastName company countryCodeV2 } ';
  var adrKurz = 'billingAddress { firstName lastName company } ';
  var li = 'sku title variantTitle quantity currentQuantity';
  var qr = ' variant { legacyResourceId } product { handle }';
  var ca = ' customAttributes { key value }';
  var stufen = [[adr, li + qr + ca], [adr, li + ca], [adrKurz, li + qr + ca], [adrKurz, li + ca],
                [adr, li + qr], [adr, li], [adrKurz, li]];
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

/* ================= Etikett-Layout v6 – Inhalt vertikal zentriert ================= */
// Ganz ans ENDE von CLP-Etikett.gs einfügen. Ersetzt etBaueDoc_ weiter oben.
// Gleicher Abstand oben und unten → nichts wird oben abgeschnitten.

var ET_LAYOUT = 'v6b';            // neue Version → Schriftgrößen werden automatisch neu berechnet
ETIKETT.randObenMm = 2.5;          // Abstand oben
ETIKETT.randUntenMm = 2,5;         // Abstand unten (gleich wie oben)

function etBaueDoc_(liste) {
  var doc = etNeuesDoc_('Etikett-temp');
  var body = doc.getBody();
  var r = ETIKETT.randMm * ET_MM;
  body.setPageWidth(ETIKETT.breiteMm * ET_MM).setPageHeight(ETIKETT.hoeheMm * ET_MM)
      .setMarginTop(ETIKETT.randObenMm * ET_MM).setMarginBottom(ETIKETT.randUntenMm * ET_MM)
      .setMarginLeft(r).setMarginRight(r);
  etKlein_(body.getChild(0).asParagraph());
  var hoehe = (ETIKETT.hoeheMm - ETIKETT.randObenMm - ETIKETT.randUntenMm) * 0.8 * ET_MM;

  liste.forEach(function (x, i) {
    if (i > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
    // Rahmen über die ganze Etikettenhöhe – Inhalt darin senkrecht zentriert
    var rahmen = body.appendTable([['']]);
    rahmen.setBorderWidth(0);
    rahmen.setColumnWidth(0, (ETIKETT.breiteMm - 2 * ETIKETT.randMm) * ET_MM);
    rahmen.getRow(0).setMinimumHeight(hoehe);
    var zelle = rahmen.getCell(0, 0)
      .setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0)
      .setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
    etKlein_(zelle.getChild(0).asParagraph());
    etZeichne_(zelle, x.e, x.schrift);
    var letzte = zelle.getChild(zelle.getNumChildren() - 1);
    if (letzte.getType() === DocumentApp.ElementType.PARAGRAPH) etKlein_(letzte.asParagraph());
    else etKlein_(zelle.appendParagraph(''));
  });

  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  return doc.getId();
}

/* ================================================================
 * ERWEITERUNGEN Okt. 2026 – ganz ans ENDE von CLP-Etikett.gs
 * 1) Probiersets (PS-…) → einzelne Proben-Etiketten
 * 2) Etiketten 102 × 51 mm senkrecht zentriert (oben = unten)
 * 3) Telegram & Dateinamen klar: Bestellnummer, Kunde, Mengen je Größe
 * 4) Zubehör als Packliste (Erinnerung, keine Warnung)
 * ================================================================ */

/* ---------- 1) Probiersets ---------- */

var PROBIERSETS = {
  BEST: ['FHG Naxos', 'Avenuetus', 'Pure Vision', 'Pura Mirage', 'Urban Savage',
         'Rouge 440', 'Desert Shadow', 'Blue de Blue', 'Blue Talisman', 'FHG Vibranto Musk',
         'Maracuja Oud', 'Angola Share', 'Cherry Love', 'Oriental Tonka', 'FHG Altairis',
         'FHG Tobacco Vanilla', 'Laiton', 'Exotic Kirke', 'FHG London', 'Ocean Breeze'],
  HER:  ['Avenuetus', 'Urban Savage', 'Pure Vision', 'Blue de Blue', 'FHG Naxos',
         'Strong for You', 'Desert Shadow', 'Blue Talisman', 'Rouge 440', 'FHG Vibranto Musk',
         'Laiton', 'FHG Altairis', 'Ammbass Men', 'Aqua Maris Signature', 'FHG Tobacco Vanilla',
         'Oriental Tonka', 'Maracuja Oud', 'FHG London', 'Angola Share', 'Ocean Breeze'],
  DAM:  ['Rose Voyage', 'Silent Hours', 'Heroine 212', 'Vanilla Candy Rock Sugar', 'Liebe le Parfum',
         'Portit of a Lady', 'Pura Mirage', 'Rouge 440', 'Blue Talisman', 'FHG Vibranto Musk',
         'Cherry Love', 'Exotic Kirke', 'White Musk', 'Ocean Breeze', 'Oriental Tonka',
         'FHG Tobacco Vanilla', 'Angola Share', 'Maracuja Oud', 'FHG London', 'FHG Naxos']
};

var PS_CACHE = {};

function psNorm_(t) {
  return String(t || '').toLowerCase().replace(/^fhg\s+/, '').replace(/\|.*$/, '').replace(/[^a-z0-9]/g, '');
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
    var treffer = oele.filter(function (p) { return psNorm_(p.title) === key; })[0] ||
                  oele.filter(function (p) { return psNorm_(p.title).indexOf(key) === 0; })[0] || oele[0];
    if (treffer) {
      var pr = JSON.parse(UrlFetchApp.fetch(basis + '/products/' + treffer.handle + '.js',
        { muteHttpExceptions: true, followRedirects: true }).getContentText());
      var proben = (pr.variants || []).filter(function (v) { return /6\s*g\b/i.test(v.title) && /probe|sample/i.test(v.title); });
      var v = proben.filter(function (x) { return /premium|exklusiv/i.test(x.title); })[0] || proben[0];
      if (v && v.sku) ergebnis = { sku: v.sku, title: pr.title, variantTitle: v.title };
    }
  } catch (e) {
    Logger.log('Probierset: Suche nach "' + name + '" fehlgeschlagen: ' + e.message);
  }
  PS_CACHE[key] = ergebnis;
  return ergebnis;
}

function psErweitere_(order) {
  var neu = [];
  order.lineItems.nodes.forEach(function (li) {
    var m = String(li.sku || '').toUpperCase().match(/^PS-([A-Z]+)-(\d+)/);
    if (!m) { neu.push(li); return; }
    var menge = (li.currentQuantity != null ? li.currentQuantity : li.quantity) || 0;
    var anzahl = Number(m[2]), namen = [];
    if (m[1] === 'WAHL') {
      namen = (li.customAttributes || [])
        .filter(function (a) { return /^Duft\s*\d+$/i.test(a.key) && String(a.value || '').trim(); })
        .sort(function (a, b) { return Number(a.key.replace(/\D/g, '')) - Number(b.key.replace(/\D/g, '')); })
        .map(function (a) { return String(a.value).trim(); });
    } else {
      namen = (PROBIERSETS[m[1]] || []).slice(0, anzahl);
    }
    if (!namen.length) {
      neu.push({ sku: '', title: 'Probierset ' + li.title + ' – Düfte unbekannt, bitte manuell',
                 variantTitle: li.variantTitle, quantity: menge, currentQuantity: menge });
      return;
    }
    namen.forEach(function (n) {
      var p = psFindeProbe_(n);
      neu.push(p ? { sku: p.sku, title: p.title, variantTitle: p.variantTitle, quantity: menge, currentQuantity: menge }
                 : { sku: '', title: 'Probierset: "' + n + '" nicht gefunden – bitte manuell',
                     variantTitle: '', quantity: menge, currentQuantity: menge });
    });
  });
  order.lineItems.nodes = neu;
  return order;
}

function etHoleBestellungen_(q, first) {
  var adr = 'billingAddress { firstName lastName company countryCodeV2 } ' +
            'shippingAddress { firstName lastName company countryCodeV2 } ';
  var adrKurz = 'billingAddress { firstName lastName company } ';
  var li = 'sku title variantTitle quantity currentQuantity';
  var qr = ' variant { legacyResourceId } product { handle }';
  var ca = ' customAttributes { key value }';
  var stufen = [[adr, li + qr + ca], [adr, li + ca], [adrKurz, li + qr + ca], [adrKurz, li + ca],
                [adr, li + qr], [adr, li], [adrKurz, li]];
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

/* ---------- 2) Etikett senkrecht zentriert ---------- */

var ET_LAYOUT = 'v6';
ETIKETT.randObenMm = 3;
ETIKETT.randUntenMm = 3;

function etBaueDoc_(liste) {
  var doc = etNeuesDoc_('Etikett-temp');
  var body = doc.getBody();
  var r = ETIKETT.randMm * ET_MM;
  body.setPageWidth(ETIKETT.breiteMm * ET_MM).setPageHeight(ETIKETT.hoeheMm * ET_MM)
      .setMarginTop(ETIKETT.randObenMm * ET_MM).setMarginBottom(ETIKETT.randUntenMm * ET_MM)
      .setMarginLeft(r).setMarginRight(r);
  etKlein_(body.getChild(0).asParagraph());
  var hoehe = (ETIKETT.hoeheMm - ETIKETT.randObenMm - ETIKETT.randUntenMm - 1.5) * ET_MM;

  liste.forEach(function (x, i) {
    if (i > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
    var rahmen = body.appendTable([['']]);
    rahmen.setBorderWidth(0);
    rahmen.setColumnWidth(0, (ETIKETT.breiteMm - 2 * ETIKETT.randMm) * ET_MM);
    rahmen.getRow(0).setMinimumHeight(hoehe);
    var zelle = rahmen.getCell(0, 0)
      .setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0)
      .setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
    etKlein_(zelle.getChild(0).asParagraph());
    etZeichne_(zelle, x.e, x.schrift);
    var letzte = zelle.getChild(zelle.getNumChildren() - 1);
    if (letzte.getType() === DocumentApp.ElementType.PARAGRAPH) etKlein_(letzte.asParagraph());
    else etKlein_(zelle.appendParagraph(''));
  });

  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  return doc.getId();
}

/* ---------- 3) Telegram & Dateinamen ---------- */

function etNr_(order) { return String(order.name).replace(/\D/g, '') || String(order.name); }

function etMengenZeilen_(liste) {
  var summe = {};
  (liste || []).forEach(function (p) {
    var g = String(p.gewicht || '?').replace(/\s+/g, ' ').trim();
    summe[g] = (summe[g] || 0) + (p.menge || 0);
  });
  var gramm = function (g) {
    var m = g.match(/([\d.,]+)\s*(kg|g)/i);
    return m ? parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'kg' ? 1000 : 1) : 1e9;
  };
  var keys = Object.keys(summe).sort(function (a, b) { return gramm(a) - gramm(b); });
  var gesamt = keys.reduce(function (s, k) { return s + summe[k]; }, 0);
  return { zeilen: keys.map(function (g) { return '   ' + (g + '        ').slice(0, 8) + '×  ' + summe[g]; }),
           gesamt: gesamt };
}

function etKopf_(order) {
  return '📦 Bestellung ' + etNr_(order) + '\n👤 ' + (etKunde_(order) || 'Kunde unbekannt') + '\n━━━━━━━━━━━━';
}

/* ---------- 4) Zubehör als Packliste ---------- */

function etKurzname_(li) {
  var name = String(li.title || '').split(/\s+inkl\.|\s+–\s+\d+\s*Stück/i)[0].replace(/\s+–\s*$/, '').trim();
  var teile = String(li.variantTitle || '').split('/').map(function (x) { return x.trim(); })
    .filter(function (x) { return x && !/stück|preis|beinhaltet|default/i.test(x) && x.length <= 25; });
  return name + (teile.length ? ' · ' + teile.join(' · ') : '');
}

/* ---------- Bestellung verarbeiten (ersetzt alle früheren Versionen) ---------- */

function etVerarbeiteBestellung_(order, map) {
  var land = (order.shippingAddress && order.shippingAddress.countryCodeV2) ||
             (order.billingAddress && order.billingAddress.countryCodeV2) || '';
  var positionen = [], probenPos = [], fehlend = [], zubehoer = [];

  order.lineItems.nodes.forEach(function (li) {
    var sku = normalize(li.sku);
    var titel = li.title + (li.variantTitle ? ' – ' + li.variantTitle : '');
    var menge = (li.currentQuantity != null ? li.currentQuantity : li.quantity) || 0;
    if (!menge) return;
    var skuFix = String(li.sku || '').replace(/-SH-PQ(?=-|$)/i, '-PQ-SH');
    var entry = sku ? (lookupSku(normalize(skuFix), map) ||
                       lookupSku(normalize(skuFix.replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '')), map)) : null;
    if (!entry) {
      if (/^Probierset/i.test(li.title)) fehlend.push(menge + ' × ' + li.title);
      else zubehoer.push({ menge: menge, name: etKurzname_(li) });
      return;
    }
    var v = etVariante_(li.variantTitle);
    if (ET_KEIN_OEL.test(li.title + ' ' + (li.variantTitle || ''))) { zubehoer.push({ menge: menge, name: etKurzname_(li) }); return; }
    if (!v.gewicht) { fehlend.push(menge + ' × ' + titel + ' – keine Gewichtsangabe'); return; }
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
  if (res.pdf) {
    var m = etMengenZeilen_(positionen);
    etTelegram_(kopf + '\n🏷️ Duftöl-Etiketten\n' + m.zeilen.join('\n') + '\nGesamt: ' + m.gesamt + ' Etiketten' +
                (res.sprachen.join('') !== 'DE' ? '\n🌍 Sprache: ' + res.sprachen.join(' + ') : ''), res.pdf);
  }
  if (probenPdf && probenPdf.pdf) {
    var mp = etMengenZeilen_(probenPos);
    etTelegram_(kopf + '\n🧪 Proben\n' + mp.zeilen.join('\n') + '\nGesamt: ' + mp.gesamt + ' Etiketten', probenPdf.pdf);
  }
  if (zubehoer.length) {
    etTelegram_(kopf + '\n📋 Bitte mitpacken (ohne Etikett):\n' +
      zubehoer.map(function (z) { return '   ' + z.menge + ' ×  ' + z.name; }).join('\n'), null);
  }
  var warn = fehlend.slice();
  if (res.vorlagen.length) warn.push('Mit Standard-Vorlage (SDB fehlt): ' + res.vorlagen.join(', '));
  if (warn.length) etTelegram_(kopf + '\n⚠️ Bitte prüfen:\n- ' + warn.join('\n- '), null);

  if (ETIKETT.emailSenden) {
    var anh = [res.pdf, probenPdf && probenPdf.pdf].filter(Boolean);
    GmailApp.sendEmail(ETIKETT.empfaenger, 'Etiketten ' + etNr_(order) + ' – ' + (etKunde_(order) || ''),
      kopf + (warn.length ? '\n⚠️ ' + warn.join('\n⚠️ ') : ''), { name: 'Fragrance Hub Etiketten', attachments: anh });
  }
  Logger.log(order.name + ': ' + (res.anzahl || 0) + ' Etiketten, ' + (probenPdf ? probenPdf.anzahl : 0) +
             ' Proben, ' + zubehoer.length + ' Zubehör-Positionen');
}

/* ---------- 2b) Zentrierung abgesichert (v6c) – nie mehr Leerseiten ---------- */
// Ganz ans ENDE von CLP-Etikett.gs. Ersetzt etBaueDoc_ und etPassendeSchrift_ weiter oben.
// Passt ein Etikett zentriert nicht auf 1 Seite, wird es automatisch ohne Rahmen (oben bündig) gedruckt.

var ET_LAYOUT = 'v6c';
ETIKETT.randObenMm = 2.5;
ETIKETT.randUntenMm = 2.5;

function etBaueDoc_(liste) {
  var doc = etNeuesDoc_('Etikett-temp');
  var body = doc.getBody();
  var r = ETIKETT.randMm * ET_MM;
  body.setPageWidth(ETIKETT.breiteMm * ET_MM).setPageHeight(ETIKETT.hoeheMm * ET_MM)
      .setMarginTop(ETIKETT.randObenMm * ET_MM).setMarginBottom(ETIKETT.randUntenMm * ET_MM)
      .setMarginLeft(r).setMarginRight(r);
  etKlein_(body.getChild(0).asParagraph());
  var hoehe = (ETIKETT.hoeheMm - ETIKETT.randObenMm - ETIKETT.randUntenMm) * 0.8 * ET_MM;

  liste.forEach(function (x, i) {
    if (i > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
    if (x.e.ohneRahmen) { etZeichne_(body, x.e, x.schrift); return; }
    var rahmen = body.appendTable([['']]);
    rahmen.setBorderWidth(0);
    rahmen.setColumnWidth(0, (ETIKETT.breiteMm - 2 * ETIKETT.randMm) * ET_MM);
    rahmen.getRow(0).setMinimumHeight(hoehe);
    var zelle = rahmen.getCell(0, 0)
      .setPaddingTop(0).setPaddingBottom(0).setPaddingLeft(0).setPaddingRight(0)
      .setVerticalAlignment(DocumentApp.VerticalAlignment.CENTER);
    etKlein_(zelle.getChild(0).asParagraph());
    etZeichne_(zelle, x.e, x.schrift);
    var letzte = zelle.getChild(zelle.getNumChildren() - 1);
    if (letzte.getType() === DocumentApp.ElementType.PARAGRAPH) etKlein_(letzte.asParagraph());
    else etKlein_(zelle.appendParagraph(''));
  });

  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  return doc.getId();
}

function etPassendeSchrift_(e) {
  var d = e.daten;
  var sig = [ET_LAYOUT, d.code, d.produkt, d.signal, d.piktogramme.join(','), d.h.join(','), d.p.join(','),
             d.enthaelt, d.batch, d.ufi || '', d.vorlage ? 'B' : 'A', e.sprache, e.gewicht, e.sku, e.qualitaet,
             String(e.charge).length, ETIKETT.linksMm, ETIKETT.piktoMm, ETIKETT.adresse + ((ETIKETT.adresseOben && ETIKETT.logoId) ? '#L16' + ETIKETT.logoId : '')].join('|');
  var key = 'ETS6_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, sig, Utilities.Charset.UTF_8)).slice(0, 22);
  var props = PropertiesService.getScriptProperties();
  var gemerkt = props.getProperty(key);
  if (gemerkt) { e.ohneRahmen = /R$/.test(gemerkt); return parseFloat(gemerkt); }
  // Schnellmodus für sehr große Aufträge (Showroom-Stapel): feste Schriftgröße, kein Probe-Dokument je Etikett
  if (ETIKETT.festSchrift) { e.ohneRahmen = false; return ETIKETT.festSchrift; }

  var groessen = ETIKETT.schriftgroessen.concat(ET_KLEIN, [3.2, 3]);
  var teste = function (ohneRahmen) {
    e.ohneRahmen = ohneRahmen;
    for (var i = 0; i < groessen.length; i++) {
      var datei = DriveApp.getFileById(etBaueDoc_([{ e: e, schrift: groessen[i] }]));
      var seiten = etSeiten_(datei.getAs('application/pdf'));
      datei.setTrashed(true);
      if (seiten <= 1) return groessen[i];
    }
    return null;
  };

  var s = teste(false), ohne = false;                 // 1. Versuch: zentriert
  if (s === null) { s = teste(true); ohne = true; }   // 2. Versuch: ohne Rahmen
  if (s === null) {
    s = groessen[groessen.length - 1]; ohne = true;
    Logger.log('WARNUNG: ' + d.produkt + ' (' + e.sprache + ') passt nicht auf 1 Etikett.');
  }
  e.ohneRahmen = ohne;
  props.setProperty(key, s + (ohne ? 'R' : ''));
  return s;
}

/* ---------- 7) Etiketten-NAME = Produktname aus dem Shop (Fix 15.10.2026) ---------- */
// Ganz ans ENDE von CLP-Etikett.gs. Ersetzt erstelleEtikettenPdf_, erstelleProbenPdf_ und psFindeProbe_ weiter oben.
// Grund: Der Name kam bisher aus CLP-Daten Spalte B (Name aus dem Sicherheitsdatenblatt / OCR) und wich
// vom bestellten Produkt ab. Jetzt steht auf JEDEM Etikett genau der Shop-Name der bestellten Position.
// CLP-Daten liefert nur noch Gefahrendaten (Piktogramme, H/P-Sätze, Enthält, Batch, UFI).

function etShopName_(pos) {
  return String(pos.produkt || pos.titel || pos.sku || '').split(/\s+–\s+/)[0].trim();
}

function erstelleEtikettenPdf_(auftrag) {
  var sprachen = etSprachen_(auftrag.laenderCode);
  var saetze = etLadeSaetze_();
  var charge = 'FH-' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyMMdd') +
               '-' + String(auftrag.name).replace(/\D/g, '');
  var liste = [], fehlend = [], inhalt = [], vorlagen = [];

  auftrag.positionen.forEach(function (pos) {
    var name = etShopName_(pos);
    var d = pos.fabrikCode ? etLadeClp_(pos.fabrikCode) : null;
    var istVorlage = false;
    if (!d) {
      d = etVorlage_(pos);
      if (!d) {
        fehlend.push(name + ' [' + (pos.fabrikCode || 'ohne Fabrik-Code') + '] – keine CLP-Daten und keine VORLAGE-Zeile');
        return;
      }
      istVorlage = true;
      vorlagen.push(name + ' [' + (pos.fabrikCode || pos.sku || '') + ']');
    }
    var dd = {};
    Object.keys(d).forEach(function (k) { dd[k] = d[k]; });
    dd.produkt = name || d.produkt;                     // immer der Shop-Name
    sprachen.forEach(function (sp) {
      var e = { qrUrl: pos.qrUrl, daten: dd, sprache: sp, gewicht: pos.gewicht, charge: charge, saetze: saetze,
                sku: pos.sku || etSkuFuer_(pos.fabrikCode) };
      e.qualitaet = pos.qualitaet || etQualitaetFuer_(e.sku);
      var s = etPassendeSchrift_(e);
      for (var i = 0; i < pos.menge; i++) liste.push({ e: e, schrift: s });
      inhalt.push(pos.menge + ' × ' + dd.produkt + (e.qualitaet ? ' · ' + e.qualitaet : '') +
                  ' · ' + pos.gewicht + ' · ' + sp + (istVorlage ? '  ← VORLAGE' : ''));
    });
  });

  var pdf = null;
  if (liste.length) {
    var datei = DriveApp.getFileById(etBaueDoc_(liste));
    pdf = datei.getAs('application/pdf').setName('Etiketten-' + charge + '.pdf');
    datei.setTrashed(true);
  }
  return { pdf: pdf, anzahl: liste.length, inhalt: inhalt, fehlend: fehlend, vorlagen: vorlagen,
           charge: charge, sprachen: sprachen };
}

function erstelleProbenPdf_(orderName, proben) {
  var charge = 'FH-' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyMMdd') +
               '-' + String(orderName).replace(/\D/g, '');
  var doc = null, body = null, f = 0;
  [2, 3, 4, 5].some(function (faktor) {
    var d = etNeuesDoc_('Proben-temp');
    try {
      var b = d.getBody();
      var r = 1.5 * faktor * ET_MM;
      b.setPageWidth(ETIKETT.probeBreiteMm * faktor * ET_MM);
      b.setPageHeight(ETIKETT.probeHoeheMm * faktor * ET_MM);
      b.setMarginTop(r).setMarginBottom(0.5 * faktor * ET_MM).setMarginLeft(r).setMarginRight(r);
      doc = d; body = b; f = faktor;
      return true;
    } catch (e) {
      DriveApp.getFileById(d.getId()).setTrashed(true);
      return false;
    }
  });
  if (!doc) throw new Error('Google Docs akzeptiert die Probe-Etikettengröße nicht.');
  etKlein_(body.getChild(0).asParagraph());
  var anzahl = 0;
  proben.forEach(function (p) {
    var d = p.fabrikCode ? etLadeClp_(p.fabrikCode) : null;
    var info = { name: etShopName_(p) || (d && d.produkt) || p.sku,          // immer der Shop-Name
                 qualitaet: p.qualitaet || etQualitaetFuer_(p.sku),
                 sku: p.sku, gewicht: p.gewicht, charge: charge, batch: (d && d.batch) || '–', f: f };
    for (var i = 0; i < p.menge; i++) {
      if (anzahl > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
      etZeichneProbe_(body, info);
      anzahl++;
    }
  });
  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  var datei = DriveApp.getFileById(doc.getId());
  var pdf = datei.getAs('application/pdf').setName('Proben-' + charge + '.pdf');
  datei.setTrashed(true);
  return { pdf: anzahl ? pdf : null, anzahl: anzahl };
}

/** Probierset: nur EXAKT passender Duft – nie mehr "irgendein erster Treffer" (sonst falscher Name/Duft) */
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
      var proben = (pr.variants || []).filter(function (v) { return /6\s*g\b/i.test(v.title) && /probe|sample/i.test(v.title); });
      var v = proben.filter(function (x) { return /premium|exklusiv/i.test(x.title); })[0] || proben[0];
      if (v && v.sku) ergebnis = { sku: v.sku, title: pr.title, variantTitle: v.title };
    } else {
      Logger.log('Probierset: "' + name + '" – ' + treffer.length + ' exakte Treffer → manuell prüfen');
    }
  } catch (e) {
    Logger.log('Probierset: Suche nach "' + name + '" fehlgeschlagen: ' + e.message);
  }
  PS_CACHE[key] = ergebnis;
  return ergebnis;
}

/** Kontrolle: zeigt für eine Bestellung, welcher Name auf jedem Etikett steht (nichts wird gesendet). */
function pruefeEtikettenNamen() {
  var nr = String(ETIKETT.testBestellung).replace(/\D/g, '');
  var order = etFindeBestellung_(nr);
  if (!order) throw new Error('Bestellung nicht gefunden: ' + nr);
  var map = loadCodeMap();
  order.lineItems.nodes.forEach(function (li) {
    var skuFix = String(li.sku || '').replace(/-SH-PQ(?=-|$)/i, '-PQ-SH');
    var entry = li.sku ? (lookupSku(normalize(skuFix), map) ||
                          lookupSku(normalize(skuFix.replace(/-(a[a-z]{2}|\d+g|\d+kg)$/i, '')), map)) : null;
    Logger.log((entry ? '🏷️ ' : '   ') + li.title + ' | ' + (li.variantTitle || '') + ' | SKU ' + li.sku +
               (entry ? ' → Etikett-Name: "' + etShopName_({ produkt: li.title }) + '" (Fabrik-Code ' + (entry.factory || '–') + ')' : ' → kein Duftöl'));
  });
}


/** Einmalig 15.10.2026: korrigierte Etiketten fuer offene Bestellungen erneut senden.
 *  Mehrmals ausfuehren, bis im Log 'alles erledigt' steht (gemerkte Schriftgroessen machen jeden Lauf schneller). */
function etKorrekturSenden() {
  var props = PropertiesService.getScriptProperties();
  var offen = props.getProperty('ET_KORR');
  var nummern = (offen === null ? '4136,4139,4132,4134' : offen).split(',').filter(String);
  if (!nummern.length) { Logger.log('alles erledigt'); return; }
  var nr = nummern[0];
  var o = etFindeBestellung_(nr);
  if (o) {
    etTelegram_('\u{1F501} \u062A\u0635\u062D\u064A\u062D: \u0645\u0644\u0635\u0642\u0627\u062A \u0627\u0644\u0637\u0644\u0628 ' + nr + ' \u0628\u0627\u0644\u0627\u0633\u0645 \u0627\u0644\u0635\u062D\u064A\u062D \u2013 \u0627\u0637\u0628\u0639\u0648\u0647\u0627 \u0628\u062F\u0644 \u0627\u0644\u0633\u0627\u0628\u0642\u0629', null);
    etVerarbeiteBestellung_(o, loadCodeMap());
  }
  nummern.shift();
  props.setProperty('ET_KORR', nummern.join(','));
  Logger.log('gesendet: ' + nr + ' | noch offen: ' + (nummern.join(', ') || 'nichts'));
}

/** Stellt die originalen GHS-Piktogramme (Ordner CLP-Etiketten, 27.09.2026) wieder her */
function etPiktoWiederherstellen() {
  var ids = { GHS01: '1NU7ymgSwiAtBQA9WysFPE_4K7N1TbsZx', GHS02: '1pnayiak3FygkrcsejNGCjxUAMpTwqtIN',
    GHS03: '1o885htaURlTSbE7RoJmW2Q2pYLD2FGjl', GHS04: '1OW2wG-aJD79ll6IsX5EVPsSU4JlFOEzO',
    GHS05: '190m86E0xdiiwCclS5kMMQ9CRk1LAbjZ5', GHS06: '1JoMniUqfAB9V8_-qfIYvysfa-9kIEUL3',
    GHS07: '1KbnqRhsDgV3zJ4lSUiIL1UWT9Mn48CUG', GHS08: '1UiRk1sa5D8vQj8hHhtQFmc2NO2VMtSq6',
    GHS09: '1GvttTGSd9WuVBH4qhx6VbbzJJVHxgFY8' };
  var p = PropertiesService.getScriptProperties();
  Object.keys(ids).forEach(function (k) {
    var alt = p.getProperty('PIKTO_' + k);
    if (alt && alt !== ids[k]) {
      try { var f = DriveApp.getFileById(alt); if (f.getDateCreated() > new Date('2026-10-15T00:00:00Z')) f.setTrashed(true); } catch (e) {}
    }
    p.setProperty('PIKTO_' + k, ids[k]);
    Logger.log(k + ' -> ' + ids[k] + (alt === ids[k] ? ' (unveraendert)' : ' (wiederhergestellt, vorher ' + alt + ')'));
  });
}


/* ---------- 8) Geschwindigkeit (16.10.2026) ----------
   Ganz ans ENDE von CLP-Etikett.gs. Ersetzt etLadeClp_ und etPassendeSchrift_ weiter oben.
   • CLP-Tabelle nur EINMAL pro Lauf lesen (vorher: bei jeder Position die ganze Tabelle).
   • Schriftgröße: zuerst die schon bekannte Größe desselben Dufts (andere Größe/Qualität) mit 1 Probe prüfen,
     sonst binäre Suche (≈4 statt bis zu 20 Probe-Dokumente). Ergebnis wie bisher dauerhaft gemerkt. */
var ET_CLP_ZEILEN = null;
function etLadeClp_(fabrikCode) {
  if (!ET_CLP_ZEILEN) {
    ET_CLP_ZEILEN = {};
    var werte = openCodesSpreadsheet().getSheetByName(etClpBlatt_()).getDataRange().getValues();
    for (var i = 1; i < werte.length; i++) {
      var k = String(werte[i][0]).replace(/\.0$/, '').trim();
      if (k && !(k in ET_CLP_ZEILEN)) ET_CLP_ZEILEN[k] = werte[i];        // erster Treffer zählt (wie vorher)
    }
  }
  var r = ET_CLP_ZEILEN[String(fabrikCode).trim()];
  if (!r || !etListe_(r[4]).length) return null;                         // ohne H-Sätze → Muster B
  var ufi = String(r[13] || '').trim().toUpperCase();
  return {
    code: String(r[0]).replace(/\.0$/, '').trim(), produkt: String(r[1]).trim(), signal: String(r[2]).trim(),
    piktogramme: etListe_(r[3]), h: etListe_(r[4]), p: etListe_(r[5]),
    enthaelt: String(r[11] || r[6] || '').trim(), batch: String(r[7] || '').trim(),
    ufi: /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(ufi) ? ufi : '', vorlage: false
  };
}

function etPassendeSchrift_(e) {
  var d = e.daten;
  var md5 = function (s) { return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, s, Utilities.Charset.UTF_8)).slice(0, 22); };
  var adr = ETIKETT.adresse + ((ETIKETT.adresseOben && ETIKETT.logoId) ? '#L16' + ETIKETT.logoId : '');
  var sig = [ET_LAYOUT, d.code, d.produkt, d.signal, d.piktogramme.join(','), d.h.join(','), d.p.join(','),
             d.enthaelt, d.batch, d.ufi || '', d.vorlage ? 'B' : 'A', e.sprache, e.gewicht, e.sku, e.qualitaet,
             String(e.charge).length, ETIKETT.linksMm, ETIKETT.piktoMm, adr].join('|');
  var key = 'ETS6_' + md5(sig);
  var props = PropertiesService.getScriptProperties();
  var gemerkt = props.getProperty(key);
  if (gemerkt) { e.ohneRahmen = /R$/.test(gemerkt); return parseFloat(gemerkt); }
  if (ETIKETT.festSchrift) { e.ohneRahmen = false; return ETIKETT.festSchrift; }

  // gleicher Duft & gleiche Texte, nur andere Größe/Qualität/Charge → meist dieselbe Schriftgröße
  var key2 = 'ETH6_' + md5([ET_LAYOUT, d.code, d.produkt, d.signal, d.piktogramme.join(','), d.h.join(','), d.p.join(','),
             d.enthaelt, d.ufi || '', d.vorlage ? 'B' : 'A', e.sprache, ETIKETT.linksMm, ETIKETT.piktoMm, adr].join('|'));
  var groessen = ETIKETT.schriftgroessen.concat(ET_KLEIN, [3.2, 3]);       // absteigend
  var passt = function (i, ohne) {
    e.ohneRahmen = ohne;
    var datei = DriveApp.getFileById(etBaueDoc_([{ e: e, schrift: groessen[i] }]));
    var seiten = etSeiten_(datei.getAs('application/pdf'));
    datei.setTrashed(true);
    return seiten <= 1;
  };
  var suche = function (ohne) {                                         // größte Schrift, die auf 1 Etikett passt
    var lo = 0, hi = groessen.length - 1, best = -1;
    while (lo <= hi) { var m = (lo + hi) >> 1; if (passt(m, ohne)) { best = m; hi = m - 1; } else lo = m + 1; }
    return best;
  };
  var s = null, ohne = false, tipp = props.getProperty(key2);
  if (tipp) {
    var ti = groessen.indexOf(parseFloat(tipp)), to = /R$/.test(tipp);
    if (ti > -1 && passt(ti, to)) { s = groessen[ti]; ohne = to; }
  }
  if (s === null) {
    var b = suche(false);
    if (b > -1) { s = groessen[b]; ohne = false; }
    else { b = suche(true); if (b > -1) { s = groessen[b]; ohne = true; } }
  }
  if (s === null) {
    s = groessen[groessen.length - 1]; ohne = true;
    Logger.log('WARNUNG: ' + d.produkt + ' (' + e.sprache + ') passt nicht auf 1 Etikett.');
  }
  e.ohneRahmen = ohne;
  props.setProperty(key, s + (ohne ? 'R' : ''));
  props.setProperty(key2, s + (ohne ? 'R' : ''));
  return s;
}
