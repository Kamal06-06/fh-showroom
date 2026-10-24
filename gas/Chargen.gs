/* =====================================================================
   Chargen.gs – Chargen-Register (Werks-Batch) mit FIFO, Zertifikats-Leser und korrekte Etiketten
   (Stand 25.10.2026, muss NACH CLP-Etikett.gs, Showroom.gs und Lagerplaetze.gs geladen werden)

   • Blatt „Chargen“ im Codes-Sheet: je Fabrik-Code beliebig viele Chargen (alt + neu).
     Aktive Chargen werden nach FIFO verwendet: die älteste (Produktionsdatum) zuerst.
     Start: einmalig automatisch aus CLP-Daten Spalte H befüllt.
   • Etiketten (Shopify + Showroom-Server): EINE Charge (Werks-Batch) + Abfülldatum (= Auftragsdatum)
     + Auftragsnummer. Die frühere interne „Charge FH-…“ entfällt.
   • chZertifikateScan(): stündlich – neue/aktualisierte Zertifikate (Sync-Ordner) per OCR lesen,
     Batch / Produktion / Retest / Menge aus dem Analysenzertifikat ins Register, Meldung per Telegram.
   ===================================================================== */

var CH_BLATT = 'Chargen';
var CH_KOPF = ['Fabrik-Code', 'Batch', 'Produktion', 'Retest', 'Menge (kg)', 'Status', 'Eingang', 'Quelle', 'Leer seit', 'Datei-ID', 'Notiz'];
var ET_LAYOUT = 'v7';                       // neue Etikettenzeilen → Schriftgrößen neu berechnen
var ET_AUFTRAG_DATUM = {};                  // Shopify-Bestellname → createdAt (aus etHoleBestellungen_)
var ET_KONTEXT = null;                      // Showroom-Auftrag (Datum, Nummer, Chargen je Position)
var ET_LOT_TXT = {
  DE: { b: 'Charge', f: 'Abfülldatum', o: 'Auftrag' },
  EN: { b: 'Batch', f: 'Filling date', o: 'Order' },
  NL: { b: 'Batch', f: 'Vuldatum', o: 'Bestelling' },
  FR: { b: 'Lot', f: 'Date de remplissage', o: 'Commande' },
  IT: { b: 'Lotto', f: 'Data di riempimento', o: 'Ordine' },
  ES: { b: 'Lote', f: 'Fecha de envasado', o: 'Pedido' },
  PL: { b: 'Partia', f: 'Data napełnienia', o: 'Zamówienie' }
};

/* ---------------- Register ---------------- */
function chDatum_(v) {                      // → 'dd.MM.yyyy' (Text)
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'Europe/Berlin', 'dd.MM.yyyy');
  var s = String(v).trim(), m = s.match(/^(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{2,4})$/);
  if (m) return ('0' + m[1]).slice(-2) + '.' + ('0' + m[2]).slice(-2) + '.' + (m[3].length === 2 ? '20' + m[3] : m[3]);
  var d = new Date(s);
  return isNaN(d) ? s : Utilities.formatDate(d, 'Europe/Berlin', 'dd.MM.yyyy');
}
function chZeit_(s) { var m = String(s || '').match(/^(\d{2})\.(\d{2})\.(\d{4})$/); return m ? new Date(+m[3], +m[2] - 1, +m[1]).getTime() : 0; }

function chBlatt_() {
  var ss = openCodesSpreadsheet(), sh = ss.getSheetByName(CH_BLATT);
  if (sh) return sh;
  sh = ss.insertSheet(CH_BLATT);
  sh.getRange(1, 1, 1, CH_KOPF.length).setValues([CH_KOPF]).setFontWeight('bold');
  sh.setFrozenRows(1);
  sh.getRange('A:K').setNumberFormat('@');
  // Startbestand: aktuelle Batch-Nummer je Fabrik-Code aus CLP-Daten Spalte H
  var w = ss.getSheetByName(etClpBlatt_()).getDataRange().getValues(), heute = chDatum_(new Date()), rows = [], seen = {};
  for (var i = 1; i < w.length; i++) {
    var k = String(w[i][0]).replace(/\.0$/, '').trim(), b = String(w[i][7] || '').trim();
    if (!/^\d{7}$/.test(k) || !b || seen[k + '|' + b]) continue;
    seen[k + '|' + b] = 1;
    rows.push([k, b, '', '', '', 'aktiv', heute, 'Start aus CLP-Daten (Spalte H)', '', '', String(w[i][8] || '')]);
  }
  if (rows.length) sh.getRange(2, 1, rows.length, CH_KOPF.length).setValues(rows);
  return sh;
}

var CH_CACHE = null;
function chAlle_(frisch) {
  if (CH_CACHE && !frisch) return CH_CACHE;
  var sh = chBlatt_(), n = sh.getLastRow(), out = [];
  if (n >= 2) sh.getRange(2, 1, n - 1, CH_KOPF.length).getDisplayValues().forEach(function (r, i) {
    var fc = String(r[0]).trim(), b = String(r[1]).trim();
    if (fc && b) out.push({ row: i + 2, fc: fc, b: b, prod: r[2], retest: r[3], menge: r[4], status: r[5] || 'aktiv',
                            ein: r[6], quelle: r[7], leer: r[8], datei: r[9], notiz: r[10] });
  });
  CH_CACHE = out;
  return out;
}
/** aktive Chargen je Fabrik-Code, älteste zuerst (Produktion, sonst Eingang) */
function chAktiv_() {
  var m = {};
  chAlle_().forEach(function (x) { if (x.status !== 'leer') (m[x.fc] = m[x.fc] || []).push(x); });
  Object.keys(m).forEach(function (k) {
    m[k].sort(function (a, b) { return (chZeit_(a.prod) || chZeit_(a.ein) || a.row) - (chZeit_(b.prod) || chZeit_(b.ein) || b.row) || a.row - b.row; });
  });
  return m;
}
function chFifo_(fc) { var l = chAktiv_()[String(fc || '').trim()]; return l && l.length ? l[0].b : ''; }

/** Charge eintragen (oder vorhandene ergänzen). o = {fc, b, prod, retest, menge, quelle, datei, notiz} */
function chHinzu_(o) {
  var fc = String(o.fc || '').trim(), b = String(o.b || '').trim().toUpperCase();
  if (!/^\d{7}$/.test(fc)) throw new Error('Fabrik-Code (7 Ziffern) fehlt');
  if (!b) throw new Error('Batch fehlt');
  var sh = chBlatt_(), alle = chAlle_(true), hit = alle.filter(function (x) { return x.fc === fc && x.b.toUpperCase() === b; })[0];
  var werte = [fc, b, chDatum_(o.prod), chDatum_(o.retest), o.menge ? String(o.menge) : '', 'aktiv', chDatum_(new Date()), o.quelle || 'manuell', '', o.datei || '', o.notiz || ''];
  if (hit) {                                  // nur leere Felder ergänzen, Status bleibt
    var r = sh.getRange(hit.row, 1, 1, CH_KOPF.length), v = r.getDisplayValues()[0];
    [2, 3, 4, 9].forEach(function (i) { if (!v[i] && werte[i]) v[i] = werte[i]; });
    r.setValues([v]); CH_CACHE = null;
    return { neu: false, fc: fc, b: b };
  }
  sh.appendRow(werte); CH_CACHE = null;
  return { neu: true, fc: fc, b: b };
}
/** Charge als aufgebraucht markieren (leer=true) oder wieder aktivieren */
function chLeer_(o) {
  var fc = String(o.fc || '').trim(), b = String(o.b || '').trim().toUpperCase();
  var hit = chAlle_(true).filter(function (x) { return x.fc === fc && x.b.toUpperCase() === b; })[0];
  if (!hit) throw new Error('Charge nicht gefunden');
  chBlatt_().getRange(hit.row, 6, 1, 4).setValues([[o.leer ? 'leer' : 'aktiv', hit.ein, hit.quelle, o.leer ? chDatum_(new Date()) + (SR_USER ? ' · ' + SR_USER : '') : '']]);
  CH_CACHE = null;
  return true;
}
function chListe_() { return chAlle_(true).map(function (x) { delete x.row; return x; }); }

/* ---------------- App: Grunddaten mit aktiven Chargen ---------------- */
function srClpBasis_() {
  var codes = {}, canon = {};
  if (typeof loadCodeMap === 'function') {
    var m = loadCodeMap(), c = m.__canon || {};
    Object.keys(m).forEach(function (k) { if (k !== '__canon' && m[k] && m[k].factory) codes[k] = String(m[k].factory); });
    Object.keys(c).forEach(function (k) { if (c[k] && c[k].factory) canon[k] = String(c[k].factory); });
  } else codes = srFabrikCodes_();
  var ss = openCodesSpreadsheet(), clp = {}, w = ss.getSheetByName(etClpBlatt_()).getDataRange().getValues();
  for (var i = 1; i < w.length; i++) {
    var r = w[i], k = String(r[0]).replace(/\.0$/, '').trim();
    if (!k || clp.hasOwnProperty(k)) continue;
    var ufi = String(r[13] || '').trim().toUpperCase();
    clp[k] = { s: String(r[2]).trim(), g: etListe_(r[3]), h: etListe_(r[4]), p: etListe_(r[5]),
               e: String(r[11] || r[6] || '').trim(), b: String(r[7] || '').trim(),
               u: /^[0-9A-Z]{4}(-[0-9A-Z]{4}){3}$/.test(ufi) ? ufi : '' };
  }
  var saetze = {}, ws = ss.getSheetByName('Sätze').getDataRange().getValues();
  for (var j = 1; j < ws.length; j++) {
    var code = String(ws[j][0]).replace(/\s+/g, '').toUpperCase();
    if (code) saetze[code] = ws[j].slice(1, 8).map(function (x) { return String(x).trim(); });
  }
  var props = PropertiesService.getScriptProperties(), pikto = {};
  ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'].forEach(function (g) { pikto[g] = props.getProperty('PIKTO_' + g) || ''; });
  var lots = {}, akt = {};
  try { akt = chAktiv_(); } catch (e) { Logger.log('Chargen: ' + e.message); }
  Object.keys(akt).forEach(function (k) { lots[k] = akt[k].map(function (x) { return { b: x.b, p: x.prod, r: x.retest, m: x.menge, e: x.ein }; }); });
  return JSON.stringify({ at: Date.now(), codes: codes, canon: canon, clp: clp, saetze: saetze, pikto: pikto, lots: lots,
    adresse: ETIKETT.adresse, ohneP: ETIKETT.ohneP, immerP: (typeof ET_IMMER_P !== 'undefined') ? ET_IMMER_P : ['P102'],
    qrShop: (typeof ETIKETT_QR !== 'undefined') ? ETIKETT_QR.shop : 'https://fragranceshub.de' });
}

/* ---------------- Etiketten (Server) ---------------- */
/** Showroom-Auftrag vor srClp_: Datum, Auftragsnummer und gewählte Chargen merken */
function chKontext_(au) {
  var t = au && (au.offerAt || au.at) ? new Date(au.offerAt || au.at) : new Date();
  var lots = {};
  (au && au.items || []).forEach(function (it, i) {
    var lo = au.lots && au.lots[i];
    if (lo && lo.b) lots[String(it.code || '').toUpperCase() + '|' + String(it.tier || '')] = lo.b;
  });
  ET_KONTEXT = { datum: Utilities.formatDate(t, 'Europe/Berlin', 'dd.MM.yyyy'),
                 nr: 'AP-' + Utilities.formatDate(t, 'Europe/Berlin', 'yyyyMMdd-HHmm'), lots: lots };
}
function chAuftragInfo_(name) {
  if (ET_KONTEXT) return { datum: ET_KONTEXT.datum, nr: ET_KONTEXT.nr };
  var c = ET_AUFTRAG_DATUM[name], t = c ? new Date(c) : new Date();
  var nr = String(name || '');
  if (/^#TEST/.test(nr)) nr = '#TEST';
  return { datum: Utilities.formatDate(t, 'Europe/Berlin', 'dd.MM.yyyy'), nr: nr };
}
function chBatchFuer_(pos, d) {
  if (ET_KONTEXT) { var k = String(pos.sku || '').toUpperCase() + '|' + String(pos.qualitaet || ''); if (ET_KONTEXT.lots[k]) return ET_KONTEXT.lots[k]; }
  return (pos.fabrikCode && chFifo_(pos.fabrikCode)) || (d && d.batch) || '';
}

function erstelleEtikettenPdf_(auftrag) {
  var sprachen = etSprachen_(auftrag.laenderCode);
  var saetze = etLadeSaetze_();
  var info = chAuftragInfo_(auftrag.name);
  var liste = [], fehlend = [], inhalt = [], vorlagen = [];
  auftrag.positionen.forEach(function (pos) {
    var name = etShopName_(pos);
    var d = pos.fabrikCode ? etLadeClp_(pos.fabrikCode) : null;
    var istVorlage = false;
    if (!d) {
      d = etVorlage_(pos);
      if (!d) { fehlend.push(name + ' [' + (pos.fabrikCode || 'ohne Fabrik-Code') + '] – keine CLP-Daten und keine VORLAGE-Zeile'); return; }
      istVorlage = true;
      vorlagen.push(name + ' [' + (pos.fabrikCode || pos.sku || '') + ']');
    }
    var dd = {};
    Object.keys(d).forEach(function (k) { dd[k] = d[k]; });
    dd.produkt = name || d.produkt;
    dd.batch = istVorlage ? '' : chBatchFuer_(pos, d);
    sprachen.forEach(function (sp) {
      var e = { qrUrl: pos.qrUrl, daten: dd, sprache: sp, gewicht: pos.gewicht, saetze: saetze,
                charge: info.datum + info.nr, datum: info.datum, auftrag: info.nr,
                sku: pos.sku || etSkuFuer_(pos.fabrikCode) };
      e.qualitaet = pos.qualitaet || etQualitaetFuer_(e.sku);
      var s = etPassendeSchrift_(e);
      for (var i = 0; i < pos.menge; i++) liste.push({ e: e, schrift: s });
      inhalt.push(pos.menge + ' × ' + dd.produkt + (e.qualitaet ? ' · ' + e.qualitaet : '') + ' · ' + pos.gewicht + ' · ' + sp +
                  (dd.batch ? ' · Charge ' + dd.batch : '') + (istVorlage ? '  ← VORLAGE' : ''));
    });
  });
  var pdf = null;
  if (liste.length) {
    var datei = DriveApp.getFileById(etBaueDoc_(liste));
    pdf = datei.getAs('application/pdf').setName('Etiketten-' + String(info.nr).replace(/[^\w-]/g, '') + '.pdf');
    datei.setTrashed(true);
  }
  return { pdf: pdf, anzahl: liste.length, inhalt: inhalt, fehlend: fehlend, vorlagen: vorlagen, charge: info.nr, sprachen: sprachen };
}

function erstelleProbenPdf_(orderName, proben) {
  var info = chAuftragInfo_(orderName);
  var doc = null, body = null, f = 0;
  [2, 3, 4, 5].some(function (faktor) {
    var d = etNeuesDoc_('Proben-temp');
    try {
      var b = d.getBody(), r = 1.5 * faktor * ET_MM;
      b.setPageWidth(ETIKETT.probeBreiteMm * faktor * ET_MM);
      b.setPageHeight(ETIKETT.probeHoeheMm * faktor * ET_MM);
      b.setMarginTop(r).setMarginBottom(0.5 * faktor * ET_MM).setMarginLeft(r).setMarginRight(r);
      doc = d; body = b; f = faktor;
      return true;
    } catch (e) { DriveApp.getFileById(d.getId()).setTrashed(true); return false; }
  });
  if (!doc) throw new Error('Google Docs akzeptiert die Probe-Etikettengröße nicht.');
  etKlein_(body.getChild(0).asParagraph());
  var anzahl = 0;
  proben.forEach(function (p) {
    var d = p.fabrikCode ? etLadeClp_(p.fabrikCode) : null;
    var x = { name: etShopName_(p) || (d && d.produkt) || p.sku, qualitaet: p.qualitaet || etQualitaetFuer_(p.sku),
              sku: p.sku, gewicht: p.gewicht, batch: chBatchFuer_(p, d) || '–', datum: info.datum, auftrag: info.nr, f: f };
    for (var i = 0; i < p.menge; i++) {
      if (anzahl > 0) etKlein_(body.appendPageBreak().getParent().asParagraph());
      etZeichneProbe_(body, x);
      anzahl++;
    }
  });
  etKlein_(body.appendParagraph(''));
  doc.saveAndClose();
  var datei = DriveApp.getFileById(doc.getId());
  var pdf = datei.getAs('application/pdf').setName('Proben-' + String(info.nr).replace(/[^\w-]/g, '') + '.pdf');
  datei.setTrashed(true);
  return { pdf: anzahl ? pdf : null, anzahl: anzahl };
}

/** Probe-Etikett 40 × 30 mm (v7): eine Charge + Abfülldatum + Auftrag */
function etZeichneProbe_(body, x) {
  var C = DocumentApp.HorizontalAlignment.CENTER;
  var f = x.f || 1;
  if (ETIKETT.logoId) etLogo_(etStil_(body.appendParagraph(''), 6 * f).setAlignment(C).setLineSpacing(1),
                              ETIKETT.probeLogoHoeheMm * f, (ETIKETT.probeBreiteMm - 4) * f);
  var n = etStil_(body.appendParagraph(x.name), 7 * f).setAlignment(C);
  n.editAsText().setBold(true);
  var Q = etQualitaet_(x.qualitaet);
  if (Q) { var q = etStil_(body.appendParagraph(Q.symbol + ' ' + Q.name), 6.5 * f).setAlignment(C); q.editAsText().setBold(true).setForegroundColor(Q.farbe); }
  etStil_(body.appendParagraph(x.sku + ' · ' + x.gewicht), 6 * f).setAlignment(C);
  etStil_(body.appendParagraph('Charge / Batch: ' + x.batch), 5.5 * f).setAlignment(C);
  etStil_(body.appendParagraph('Abgefüllt / Filled: ' + x.datum), 5.5 * f).setAlignment(C);
  etStil_(body.appendParagraph('Auftrag / Order: ' + x.auftrag), 5.5 * f).setAlignment(C);
  var pr = etStil_(body.appendParagraph('Probe / Sample'), 6.5 * f).setAlignment(C);
  pr.editAsText().setBold(true);
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
  // Rückverfolgung (v7): EINE Charge (Werks-Batch, FIFO) + Abfülldatum (= Auftragsdatum) + Auftragsnummer
  var LT = ET_LOT_TXT[e.sprache] || ET_LOT_TXT.EN;
  if (d.batch) etText_(links, LT.b + ': ' + d.batch, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (e.datum) etText_(links, LT.f + ': ' + e.datum, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
  if (e.auftrag) etText_(links, LT.o + ': ' + e.auftrag, s - 0.5, false, C).editAsText().setForegroundColor(ET_GRAU);
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
        'id name createdAt tags ' + stufen[i][0] + 'lineItems(first: 250) { nodes { ' + stufen[i][1] + ' } } } } }',
        { q: q, first: first }).orders.nodes;
      orders.forEach(function (o) { if (o.createdAt) ET_AUFTRAG_DATUM[o.name] = o.createdAt; });
      return orders.map(psErweitere_);
    } catch (e) {
      fehler = e;
      Logger.log('Abfrage-Stufe ' + (i + 1) + ' fehlgeschlagen: ' + e.message.slice(0, 200));
    }
  }
  throw fehler;
}

/* ---------- 2) Etikett senkrecht zentriert ---------- */



/* ---------------- Zertifikats-Leser ---------------- */
var CH_SCAN_SEK = 270;
function chCoa_(flat) {
  var p = flat.search(/CERTIFICATE OF ANALYSIS|ANALYSENZERTIFIKAT|Certificate of Analysys/i);
  var t = p >= 0 ? flat.slice(p) : flat;
  var g = function (re) { var m = t.match(re); return m ? m[1].trim() : ''; };
  var batch = g(/Batch\s*(?:N[or]\.?|number|Nummer)?\s*:?\s*([A-Z]{1,4}\s?-\s?\d{4,})/i).replace(/\s/g, '').toUpperCase();
  if (!batch) batch = (g(/\b([A-Z]{2}-\d{6,8})\b/) || '').toUpperCase();
  return {
    batch: batch,
    code: g(/(?:FRAGRANCE OIL|Product Name and Code)[^0-9]{0,40}(\d{7})/i),
    prod: chDatum_(g(/(?:Production|Manufacturing|Herstell\w*|Produktions?)\s*Date?\w*\s*:?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i)),
    retest: chDatum_(g(/(?:Re-?test|Retest|Wiederholungspr\w*|Haltbar\w*|Expiry|Best before)\s*(?:Date|datum)?\s*:?\s*(\d{1,2}[.\/-]\d{1,2}[.\/-]\d{2,4})/i)),
    menge: g(/Amount of Production\s*:?\s*([\d.,]+)\s*KG/i)
  };
}
function chIstImSync_(file, syncId) {
  var stapel = [file.getParents()], tiefe = 0;
  while (stapel.length && tiefe < 6) {
    var it = stapel.shift(), naechste = [];
    while (it.hasNext()) { var f = it.next(); if (f.getId() === syncId) return true; naechste.push(f.getParents()); }
    stapel = stapel.concat(naechste); tiefe++;
  }
  return false;
}
/** stündlich: neue/aktualisierte Zertifikate lesen. Erster Lauf merkt sich nur den Zeitpunkt (Startbestand = Spalte H). */
function chZertifikateScan() {
  var start = Date.now(), props = PropertiesService.getScriptProperties();
  chBlatt_();
  var ab = props.getProperty('CH_SCAN_AB');
  var jetzt = new Date(start - 5 * 60e3).toISOString();
  if (!ab) { props.setProperty('CH_SCAN_AB', jetzt); return { neu: [], info: 'Start – ab jetzt werden neue Zertifikate gelesen' }; }
  var syncId = DriveApp.getFoldersByName(CONFIG.SYNC_FOLDER_NAME).next().getId();
  var q = 'modifiedDate > "' + ab.replace(/\.\d+Z$/, '') + '" and mimeType = "application/pdf" and trashed = false';
  var it = DriveApp.searchFiles(q), offen = [];
  while (it.hasNext()) { var f = it.next(); if (/(?<!\d)\d{7}(?!\d)/.test(f.getName()) && !/IFRA/i.test(f.getName())) offen.push(f); }
  var gemeldet = [], fertig = true, sdbHinweis = [];
  for (var i = 0; i < offen.length; i++) {
    if ((Date.now() - start) / 1000 > CH_SCAN_SEK) { fertig = false; break; }
    var f2 = offen[i];
    try {
      if (!chIstImSync_(f2, syncId)) continue;
      var flat = clpOcr_(f2).replace(/\r/g, ' ').replace(/\s+/g, ' ');
      var x = chCoa_(flat), fc = x.code || (f2.getName().match(/(?<!\d)(\d{7})(?!\d)/) || [])[1];
      if (!x.batch || !fc) continue;
      var r = chHinzu_({ fc: fc, b: x.batch, prod: x.prod, retest: x.retest, menge: x.menge, quelle: 'Zertifikat: ' + f2.getName(), datei: f2.getId() });
      if (r.neu) gemeldet.push('• ' + fc + ' · Charge ' + x.batch + (x.prod ? ' · Produktion ' + x.prod : '') + (x.retest ? ' · Retest ' + x.retest : '') + (x.menge ? ' · ' + x.menge + ' kg' : ''));
      // Sicherheitsdatenblatt geändert? (H-Sätze anders als in CLP-Daten)
      try {
        var alt = etLadeClp_(fc), h = (flat.match(/\b(?:EUH|H)\d{3}\b/g) || []).filter(function (v, k, a) { return a.indexOf(v) === k; });
        if (alt && h.length && h.slice().sort().join(',') !== alt.h.slice().sort().join(',')) sdbHinweis.push('• ' + fc + ': H-Sätze im neuen Zertifikat ' + h.join(', ') + ' (bisher ' + alt.h.join(', ') + ')');
      } catch (e2) {}
    } catch (e) { Logger.log('Zertifikat ' + f2.getName() + ': ' + e.message); }
  }
  if (fertig) props.setProperty('CH_SCAN_AB', jetzt);
  if (gemeldet.length) etTelegram_('📄 Neue Chargen aus Zertifikaten:\n' + gemeldet.join('\n') + '\n\nDie App nimmt immer zuerst die ältere Charge (FIFO). Leere Charge in der App mit „انتهت“ markieren.', null);
  if (sdbHinweis.length) etTelegram_('⚠️ Sicherheitsdatenblatt geändert – CLP-Daten prüfen (clpNeuLesen):\n' + sdbHinweis.join('\n'), null);
  return { neu: gemeldet, sdb: sdbHinweis, geprueft: offen.length, fertig: fertig };
}
/** Retest-Datum in den nächsten 60 Tagen erreicht → Hinweis (läuft mit dem Scan einmal täglich) */
function chRetestWarnung_() {
  var props = PropertiesService.getScriptProperties(), heute = chDatum_(new Date());
  if (props.getProperty('CH_RETEST_TAG') === heute) return;
  props.setProperty('CH_RETEST_TAG', heute);
  var grenze = Date.now() + 60 * 864e5, l = [];
  chAlle_(true).forEach(function (x) { var t = chZeit_(x.retest); if (x.status !== 'leer' && t && t < grenze) l.push('• ' + x.fc + ' · Charge ' + x.b + ' · Retest ' + x.retest); });
  if (l.length) etTelegram_('⏳ Chargen mit Retest-Datum in den nächsten 60 Tagen:\n' + l.join('\n'), null);
}
function chStuendlich() { try { chZertifikateScan(); } finally { chRetestWarnung_(); } }
/** Trigger einmal anlegen (wird auch automatisch aus der App heraus sichergestellt) */
function chSetup() {
  chBlatt_();
  var da = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'chStuendlich'; });
  if (!da) ScriptApp.newTrigger('chStuendlich').timeBased().everyHours(1).create();
  if (!PropertiesService.getScriptProperties().getProperty('CH_SCAN_AB')) chZertifikateScan();
  return { trigger: true, chargen: chAlle_(true).length };
}
function chTestLeser() {                       // Test: ein Zertifikat lesen (ohne Eintrag)
  var f = DriveApp.searchFiles('title contains "1010019" and mimeType = "application/pdf"');
  while (f.hasNext()) { var x = f.next(); if (/IFRA|de-DE/i.test(x.getName())) continue; Logger.log(x.getName() + ' → ' + JSON.stringify(chCoa_(clpOcr_(x).replace(/\s+/g, ' ')))); break; }
}
