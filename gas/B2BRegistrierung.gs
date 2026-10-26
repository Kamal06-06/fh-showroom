/* =====================================================================
   B2BRegistrierung.gs – Seite "Geschäftskunde werden" (fragranceshub.de/pages/geschaeftskunde-werden)
   Ablauf: Formular → doPost (form=b2b) → b2bRegistrierung_()
     1. USt-IdNr. automatisch bei VIES (EU) prüfen
     2. Kunde in Shopify anlegen (Adresse, Telefon, Firma, Tags B2B, Notiz)
        – existiert die E-Mail schon: Tags + Notiz ergänzen
     3. Begrüßungs-E-Mail automatisch an den Kunden (Absender: Fragrance Hub Germany)
     4. Telegram-Nachricht mit allen Angaben
   Die Kontaktformular-E-Mail von Shopify kommt zusätzlich wie bisher.
   Test: b2bTest() ausführen.
   ===================================================================== */

var B2B = {
  key: 'fh-b2b-26',
  tags: ['B2B', 'B2B-Registrierung'],
  laender: { 'Deutschland':'DE','Österreich':'AT','Schweiz':'CH','Niederlande':'NL','Belgien':'BE','Luxemburg':'LU',
             'Frankreich':'FR','Italien':'IT','Spanien':'ES','Polen':'PL','Dänemark':'DK','Schweden':'SE','Tschechien':'CZ' }
};

/** Wird von doPost aufgerufen, wenn e.parameter.form === 'b2b'. */
function b2bRegistrierung_(p) {
  if (!p || p.k !== B2B.key) return 'forbidden';
  if (p.website) return 'ok';                       // Spam-Falle (verstecktes Feld)
  var d = {
    firma: b2bTxt_(p.firma, 120), taet: b2bTxt_(p.taet, 80),
    ust: b2bTxt_(p.ust, 20).replace(/[\s.\-]/g, '').toUpperCase(),
    vn: b2bTxt_(p.vn, 60), nn: b2bTxt_(p.nn, 60),
    em: b2bTxt_(p.em, 120).toLowerCase(), tel: b2bTxt_(p.tel, 40),
    str: b2bTxt_(p.str, 120), plz: b2bTxt_(p.plz, 20), ort: b2bTxt_(p.ort, 80),
    land: b2bTxt_(p.land, 40), msg: b2bTxt_(p.msg, 1500)
  };
  if (!d.em || d.em.indexOf('@') < 1 || !d.firma) return 'missing';

  var props = PropertiesService.getScriptProperties();
  var dupKey = 'B2B_' + Utilities.base64EncodeWebSafe(d.em).slice(0, 60);
  var last = Number(props.getProperty(dupKey) || 0);
  if (Date.now() - last < 10 * 60 * 1000) return 'ok';          // doppelt abgeschickt
  props.setProperty(dupKey, String(Date.now()));

  var vies = b2bVies_(d.ust);
  var kunde = '';
  try { kunde = b2bShopifyKunde_(d, vies); } catch (err) { kunde = '⚠️ Shopify: ' + String(err.message || err).slice(0, 200); }

  var mail = '';
  if (kunde.indexOf('⚠️') === 0) mail = '⚠️ Begrüßung NICHT gesendet (Shopify-Fehler) – bitte manuell antworten';
  else {
    try { b2bBegruessungSenden_(d, vies); mail = '✉️ Begrüßung automatisch an ' + d.em + ' gesendet'; }
    catch (err) { mail = '⚠️ Begrüßung NICHT gesendet: ' + String(err.message || err).slice(0, 150); }
  }
  etTelegram_(b2bNachricht_(d, vies, kunde) + '\n\n' + mail, null);
  return 'ok';
}

function b2bTxt_(v, max) { return String(v || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }

/** USt-IdNr. bei VIES prüfen (kostenlos, offizielle EU-Schnittstelle). */
function b2bVies_(ust) {
  if (!ust) return { status: 'keine', text: 'keine USt-IdNr. angegeben' };
  var m = /^([A-Z]{2})([0-9A-Z]{2,13})$/.exec(ust);
  if (!m) return { status: 'format', text: 'Format ungültig (' + ust + ')' };
  var cc = m[1] === 'GR' ? 'EL' : m[1];
  try {
    var r = UrlFetchApp.fetch('https://ec.europa.eu/taxation_customs/vies/rest-api/ms/' + cc + '/vat/' + m[2], { muteHttpExceptions: true });
    var j = JSON.parse(r.getContentText() || '{}');
    if (j.isValid === true) {
      var name = (j.name && j.name !== '---') ? j.name : '';
      return { status: 'gueltig', text: '✅ gültig' + (name ? ' – ' + name : ''), name: name };
    }
    if (j.isValid === false) return { status: 'ungueltig', text: '❌ laut VIES ungültig' };
    return { status: 'unklar', text: 'VIES nicht erreichbar – bitte manuell prüfen' };
  } catch (e) {
    return { status: 'unklar', text: 'VIES nicht erreichbar – bitte manuell prüfen' };
  }
}

/** Kunde in Shopify anlegen oder vorhandenen ergänzen. */
function b2bShopifyKunde_(d, vies) {
  var cc = B2B.laender[d.land] || '';
  var note = 'B2B-Registrierung ' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy') +
    '\nFirma: ' + d.firma + '\nTätigkeit: ' + d.taet +
    '\nUSt-IdNr.: ' + (d.ust || '–') + ' (' + vies.text + ')' +
    '\nTelefon: ' + d.tel + (d.msg ? '\nNachricht: ' + d.msg : '');
  var tags = B2B.tags.slice();
  if (vies.status === 'gueltig') { tags.push('USt-IdNr-geprueft'); tags.push('b2b-ust'); }   // b2b-ust = automatischer Geschäftskunden-Rabatt (15 % Öle / 10 % Rest)

  var found = shopifyGraphQL('query($q:String!){customers(first:1,query:$q){nodes{id note}}}', { q: 'email:' + d.em });
  var vorhanden = found.customers.nodes[0];
  if (vorhanden) {
    shopifyGraphQL('mutation($id:ID!,$t:[String!]!){tagsAdd(id:$id,tags:$t){userErrors{message}}}', { id: vorhanden.id, t: tags });
    shopifyGraphQL('mutation($i:CustomerInput!){customerUpdate(input:$i){userErrors{message}}}',
      { i: { id: vorhanden.id, note: ((vorhanden.note ? vorhanden.note + '\n\n' : '') + note).slice(0, 5000) } });
    return 'bestehender Kunde ergänzt (Tags B2B)';
  }

  var tel = b2bTelefon_(d.tel, cc);
  var input = {
    firstName: d.vn, lastName: d.nn, email: d.em, note: note, tags: tags,
    addresses: [{ firstName: d.vn, lastName: d.nn, company: d.firma, address1: d.str, zip: d.plz, city: d.ort, countryCode: cc || null }]
  };
  if (tel) { input.phone = tel; input.addresses[0].phone = tel; }
  if (!cc) delete input.addresses[0].countryCode;

  var q = 'mutation($i:CustomerInput!){customerCreate(input:$i){customer{id} userErrors{field message}}}';
  var res = shopifyGraphQL(q, { i: input }).customerCreate;
  if (res.userErrors.length && tel) {                 // Telefonnummer ungültig → ohne Telefon nochmal
    delete input.phone; delete input.addresses[0].phone;
    res = shopifyGraphQL(q, { i: input }).customerCreate;
  }
  if (res.userErrors.length) throw new Error(res.userErrors.map(function (u) { return u.message; }).join('; '));
  return 'neu in Shopify angelegt';
}

/** Telefonnummer ins internationale Format (+49…) bringen, sonst leer. */
function b2bTelefon_(t, cc) {
  var s = String(t || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  if (s.charAt(0) !== '+') {
    var vw = { DE:'49', AT:'43', CH:'41', NL:'31', BE:'32', LU:'352', FR:'33', IT:'39', ES:'34', PL:'48', DK:'45', SE:'46', CZ:'420' }[cc];
    if (!vw) return '';
    s = '+' + vw + s.replace(/^0/, '');
  }
  return /^\+\d{8,15}$/.test(s) ? s : '';
}

function b2bNachricht_(d, vies, kunde) {
  var anrede = 'Guten Tag ' + (d.vn + ' ' + d.nn).trim();
  return '🏢 NEUE GESCHÄFTSKUNDEN-REGISTRIERUNG\n\n' +
    d.firma + '\n' + d.taet + '\n' +
    (d.vn + ' ' + d.nn).trim() + '\n' + d.em + '\n' + d.tel + '\n' +
    d.str + ', ' + d.plz + ' ' + d.ort + ', ' + d.land + '\n' +
    'USt-IdNr.: ' + (d.ust || '–') + ' → ' + vies.text + '\n' +
    (d.msg ? '\nNachricht: ' + d.msg + '\n' : '') +
    '\nShopify: ' + kunde +
    (vies.status === 'gueltig' ? '\n✅ Rabatt automatisch aktiv: 15 % Duftöle / 10 % Flakons & Zubehör' : '\n⛔ Kein Rabatt (USt-IdNr. fehlt/ungeprüft) – bei Bedarf Tag b2b-ust in Shopify manuell setzen') ;
}

/** Aktuelle B2B-Preislisten (Shopify-Dateien, nur Handelsnamen). Bei neuer Version: Datei in Shopify ersetzen – Link bleibt gleich. */
var FH_PREISLISTE = {
  de: 'https://cdn.shopify.com/s/files/1/0929/4571/1487/files/B2B-Preisliste_Duftoele_Fragrance-Hub.pdf',
  en: 'https://cdn.shopify.com/s/files/1/0929/4571/1487/files/B2B-Price-List_Fragrance-Oils_Fragrance-Hub.pdf'
};

/** Begrüßungs-E-Mail an den neuen Geschäftskunden (Absendername nur Fragrance Hub Germany). */
function b2bBegruessung_(d, vies) {
  var gueltig = vies.status === 'gueltig';
  var text = 'Guten Tag ' + (d.vn + ' ' + d.nn).trim() + ',\n\n' +
    'vielen Dank für Ihre Registrierung als Geschäftskunde bei Fragrance Hub Germany. ' +
    'Ihr Kundenkonto ist aktiv – Sie melden sich auf fragranceshub.de einfach mit dieser E-Mail-Adresse an.\n\n' +
    (gueltig
      ? 'Ihre USt-IdNr. ' + d.ust + ' wurde erfolgreich geprüft. Als Geschäftskunde erhalten Sie ab sofort automatisch 15 % Rabatt auf alle Duftöle und 10 % auf Flakons und Zubehör. ' +
        'Wichtig: Der Rabatt wird angezeigt, sobald Sie beim Bestellen in Ihrem Kundenkonto angemeldet sind.\n\n'
      : 'Für unseren Geschäftskunden-Rabatt (15 % auf Duftöle, 10 % auf Flakons und Zubehör) benötigen wir eine gültige USt-IdNr. ' +
        'Antworten Sie einfach auf diese E-Mail mit Ihrer USt-IdNr. – wir schalten den Rabatt dann für Ihr Kundenkonto frei.\n\n') +
    'Gerne beraten wir Sie persönlich zu Duftölen, Qualitäten und Mengen. Vor einer größeren Bestellung empfehlen wir unsere Probiersets oder individuelle Muster. ' +
    'Senden Sie uns einfach Ihre Wunschliste – wir erstellen Ihnen ein Angebot.\n\n' +
    'Unsere aktuelle B2B-Preisliste (PDF): ' + FH_PREISLISTE.de + '\n' +
    'Price list in English (PDF): ' + FH_PREISLISTE.en + '\n\n' +
    'Telefon und WhatsApp: +49 2361 4878835 (werktags 13:30 bis 16:30 Uhr)\n\n' +
    'Mit freundlichen Grüßen\nFragrance Hub Germany\nfragranceshub.de';
  return { betreff: 'Willkommen bei Fragrance Hub Germany', text: text };
}

function b2bBegruessungSenden_(d, vies) {
  var b = b2bBegruessung_(d, vies);
  var opts = { name: 'Fragrance Hub Germany', replyTo: 'info@fragranceshub.de' };
  var von = fhAbsender_();
  if (von) opts.from = von;
  GmailApp.sendEmail(d.em, b.betreff, b.text, opts);
}

/** Absenderadresse info@fragranceshub.de (Gmail „Senden als“ über Proton SMTP) – nur wenn in Gmail bestätigt, sonst null. */
function fhAbsender_() {
  var adr = 'info@fragranceshub.de';
  try { return GmailApp.getAliases().indexOf(adr) >= 0 ? adr : null; } catch (e) { return null; }
}

/** Test ohne Formular: legt KEINEN echten Kunden an, schickt nur die Telegram-Vorschau. */
function b2bTest() {
  var d = { firma:'Muster Parfum GmbH', taet:'Parfümhersteller / eigene Marke', ust:'DE811569869', vn:'Max', nn:'Muster',
            em:'test@example.com', tel:'0171 1234567', str:'Musterstraße 1', plz:'45665', ort:'Recklinghausen', land:'Deutschland', msg:'Test' };
  var vies = b2bVies_(d.ust);
  etTelegram_('🧪 TEST\n' + b2bNachricht_(d, vies, '(Test – kein Kunde angelegt)') + '\n\n✉️ Vorschau Begrüßung (nicht gesendet):\n\n' + b2bBegruessung_(d, vies).text, null);
  Logger.log(vies.text);
}



/* =====================================================================
   Kundenpflege – läuft täglich (Trigger: kundenpflegeEinrichten() einmal ausführen)
   1. Erinnerung USt-IdNr.: B2B-Registrierung ohne geprüfte USt-IdNr., 3–14 Tage alt → 1 E-Mail
   2. Nachbestell-Erinnerung: Geschäftskunden (b2b-ust), letzte Bestellung vor 35–45 Tagen → 1 E-Mail
      mit Warenkorb-Link zum Nachbestellen (einmal pro Bestellung)
   Test ohne Versand: kundenpflegeVorschau() – zeigt nur im Protokoll, wer eine E-Mail bekäme.
   ===================================================================== */
function kundenpflegeTaeglich() { kundenpflegeLauf_(false); }
function kundenpflegeVorschau() { kundenpflegeLauf_(true); }

function kundenpflegeEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'kundenpflegeTaeglich') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('kundenpflegeTaeglich').timeBased().everyDays(1).atHour(9).inTimezone('Europe/Berlin').create();
  Logger.log('Trigger eingerichtet: täglich ca. 9 Uhr');
}

function kundenpflegeLauf_(nurVorschau) {
  var log = [];
  try { b2bUstErinnerung_(nurVorschau, log); } catch (e) { log.push('⚠️ USt-Erinnerung: ' + e.message); }
  try { nachbestellErinnerung_(nurVorschau, log); } catch (e) { log.push('⚠️ Nachbestellung: ' + e.message); }
  Logger.log((nurVorschau ? 'VORSCHAU (nichts gesendet)\n' : '') + (log.join('\n') || 'Heute niemand fällig.'));
}

function fhMail_(to, betreff, text) {
  var opts = { name: 'Fragrance Hub Germany', replyTo: 'info@fragranceshub.de' };
  var von = fhAbsender_(); if (von) opts.from = von;
  GmailApp.sendEmail(to, betreff, text, opts);
}

function fhAnrede_(c) {
  var n = [c.firstName, c.lastName].filter(Boolean).join(' ').trim();
  return n ? 'Guten Tag ' + n + ',' : 'Guten Tag,';
}

function fhTag_(tageZurueck) {
  return Utilities.formatDate(new Date(Date.now() - tageZurueck * 864e5), 'Europe/Berlin', 'yyyy-MM-dd');
}

/** 1. Erinnerung: USt-IdNr. fehlt noch */
function b2bUstErinnerung_(nurVorschau, log) {
  var props = PropertiesService.getScriptProperties();
  var q = 'tag:"B2B-Registrierung" AND NOT tag:"b2b-ust" AND created_at:<' + fhTag_(3) + ' AND created_at:>' + fhTag_(14);
  var r = shopifyGraphQL('query($q:String!){customers(first:50,query:$q){nodes{id email firstName lastName}}}', { q: q });
  r.customers.nodes.forEach(function (c) {
    if (!c.email) return;
    var key = 'UST_ERI_' + c.id.split('/').pop();
    if (props.getProperty(key)) return;
    var text = fhAnrede_(c) + '\n\n' +
      'vielen Dank nochmals für Ihre Registrierung als Geschäftskunde bei Fragrance Hub Germany.\n\n' +
      'Ihr Geschäftskunden-Rabatt wartet auf Sie: 15 % auf alle Duftöle und 10 % auf Flakons und Zubehör. ' +
      'Zur Freischaltung benötigen wir nur noch Ihre gültige USt-IdNr. – antworten Sie einfach auf diese E-Mail damit.\n\n' +
      'Telefon und WhatsApp: +49 2361 4878835\n\n' +
      '-----\n\nHello, thank you again for registering as a business customer. Your business discount (15 % on fragrance oils, 10 % on bottles and accessories) is waiting for you – simply reply to this e-mail with your valid VAT number and we will activate it.\n\n' +
      'Mit freundlichen Grüßen / Kind regards\nFragrance Hub Germany\nfragranceshub.de';
    if (!nurVorschau) { fhMail_(c.email, 'Ihr Geschäftskunden-Rabatt wartet – Fragrance Hub Germany', text); props.setProperty(key, String(Date.now())); }
    log.push('USt-Erinnerung → ' + c.email);
  });
}

/** 2. Nachbestell-Erinnerung für Geschäftskunden */
function nachbestellErinnerung_(nurVorschau, log) {
  var props = PropertiesService.getScriptProperties();
  var shop = 'https://fragranceshub.de';
  var cursor = null, runde = 0;
  do {
    var r = shopifyGraphQL('query($q:String!,$c:String){customers(first:50,after:$c,query:$q){pageInfo{hasNextPage endCursor}nodes{id email firstName lastName ' +
      'lastOrder{id name createdAt cancelledAt lineItems(first:30){nodes{quantity title variantTitle variant{id}}}}}}}', { q: 'tag:"b2b-ust"', c: cursor });
    r.customers.nodes.forEach(function (c) {
      var o = c.lastOrder;
      if (!c.email || !o || o.cancelledAt) return;
      var tage = (Date.now() - new Date(o.createdAt).getTime()) / 864e5;
      if (tage < 35 || tage > 45) return;
      var key = 'NACHB_' + o.id.split('/').pop();
      if (props.getProperty(key)) return;
      var pos = o.lineItems.nodes.filter(function (li) { return li.variant && li.quantity > 0; });
      if (!pos.length) return;
      var link = shop + '/cart/' + pos.map(function (li) { return li.variant.id.split('/').pop() + ':' + li.quantity; }).join(',');
      var liste = pos.map(function (li) { return '• ' + li.quantity + ' × ' + li.title + (li.variantTitle ? ' – ' + li.variantTitle : ''); }).join('\n');
      var datum = Utilities.formatDate(new Date(o.createdAt), 'Europe/Berlin', 'dd.MM.yyyy');
      var text = fhAnrede_(c) + '\n\n' +
        'Zeit für Nachschub? Ihre letzte Bestellung ' + o.name + ' vom ' + datum + ':\n\n' + liste + '\n\n' +
        'Mit einem Klick erneut bestellen – die Mengen können Sie im Warenkorb noch anpassen:\n' + link + '\n\n' +
        'Ihr Geschäftskunden-Rabatt wird automatisch abgezogen, wenn Sie in Ihrem Kundenkonto angemeldet sind. ' +
        'Bestellungen bis 12:00 Uhr versenden wir am selben Werktag.\n\n' +
        'Telefon und WhatsApp: +49 2361 4878835\n\n' +
        '-----\n\nHello, time to restock? Reorder your last order ' + o.name + ' with one click (you can still adjust quantities in the cart): ' + link + '\n\n' +
        'Mit freundlichen Grüßen / Kind regards\nFragrance Hub Germany\nfragranceshub.de';
      if (!nurVorschau) { fhMail_(c.email, 'Zeit für Nachschub? Ihre letzte Bestellung mit einem Klick – Fragrance Hub Germany', text); props.setProperty(key, String(Date.now())); }
      log.push('Nachbestellung → ' + c.email + ' (' + o.name + ', vor ' + Math.round(tage) + ' Tagen)');
    });
    cursor = r.customers.pageInfo.hasNextPage ? r.customers.pageInfo.endCursor : null;
  } while (cursor && ++runde < 10);
}


/* =====================================================================
   Zertifikate anfordern – Seite fragranceshub.de/pages/zertifikate-anfordern
   Kunde gibt Artikel-Codes + E-Mail ein → IFRA/SDS werden automatisch gesendet
   (gleiche Logik wie nach einer Bestellung; Alkohol-SDS inklusive).
   Schutz: Spam-Falle, max. 10 Codes, max. 3 Anfragen pro E-Mail und Tag.
   ===================================================================== */
function zertAnfrage_(p) {
  if (!p || p.k !== 'fh-zert-26') return 'forbidden';
  if (p.website) return 'ok';
  var em = String(p.em || '').trim().toLowerCase().slice(0, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return 'missing';
  var codes = String(p.codes || '').toUpperCase().split(/[\s,;]+/).map(function (x) { return x.trim(); })
    .filter(function (x) { return /^[A-Z0-9][A-Z0-9-]{3,40}$/.test(x); });
  codes = codes.filter(function (x, i) { return codes.indexOf(x) === i; }).slice(0, 10);
  if (!codes.length) return 'missing';

  var props = PropertiesService.getScriptProperties();
  var tag = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyyMMdd');
  var key = 'ZERT_' + tag + '_' + Utilities.base64EncodeWebSafe(em).slice(0, 50);
  var n = Number(props.getProperty(key) || 0);
  if (n >= 3) return 'limit';
  props.setProperty(key, String(n + 1));

  var name = String(p.name || '').trim().slice(0, 80);
  // In Warteschlange legen – Versand übernimmt zertQueueLauf() (Trigger alle 10 Min.), damit die Seite sofort antwortet
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    var qu = JSON.parse(props.getProperty('ZERT_QUEUE') || '[]');
    if (qu.length < 50) qu.push({ em: em, name: name, codes: codes, t: Date.now() });
    props.setProperty('ZERT_QUEUE', JSON.stringify(qu));
  } finally { lock.releaseLock(); }
  return 'ok';
}

/** Arbeitet die Zertifikats-Anfragen ab (Trigger alle 10 Minuten, liest Drive nur, wenn etwas ansteht). */
function zertQueueLauf() {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  var qu;
  try { qu = JSON.parse(props.getProperty('ZERT_QUEUE') || '[]'); props.setProperty('ZERT_QUEUE', '[]'); } finally { lock.releaseLock(); }
  var offenRoh = props.getProperty('ZERT_OFFEN') || '[]';
  var pruefen = offenRoh !== '[]' && Date.now() - Number(props.getProperty('ZERT_OFFEN_CHECK') || 0) > 60 * 60 * 1000;
  if (!qu.length && !pruefen) return;
  var t0 = Date.now(); // Zeitbudget: nach 4 Min. aufhören, Rest zurück in die Warteschlange (Google-Limit 6 Min.)
  var ctx = buildContext();
  var rest = [];
  qu.forEach(function (a) {
    if (Date.now() - t0 > 240000) { rest.push(a); return; }
    try { zertSenden_(a.em, a.name, a.codes, ctx); } catch (e) { Logger.log('Zert ' + a.em + ': ' + e.message); }
  });
  if (rest.length) {
    var lock2 = LockService.getScriptLock(); lock2.waitLock(20000);
    try { var neu = JSON.parse(props.getProperty('ZERT_QUEUE') || '[]'); props.setProperty('ZERT_QUEUE', JSON.stringify(rest.concat(neu).slice(0, 50))); } finally { lock2.releaseLock(); }
    Logger.log('Zeitbudget erreicht – ' + rest.length + ' Anfrage(n) für den nächsten Lauf zurückgelegt');
    return;
  }
  if (pruefen && Date.now() - t0 < 180000) { props.setProperty('ZERT_OFFEN_CHECK', String(Date.now())); try { zertOffenPruefen_(ctx); } catch (e) { Logger.log('Offen prüfen: ' + e.message); } }
}

/** Merkt fehlende Zertifikate (E-Mail + Shop-Code) – sie werden automatisch nachgesendet, sobald sie in Drive liegen. */
function zertOffenMerken_(em, name, shops) {
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var offen = JSON.parse(props.getProperty('ZERT_OFFEN') || '[]');
    shops.forEach(function (s) {
      if (!offen.some(function (o) { return o.em === em && o.shop === s; })) offen.push({ em: em, name: name || '', shop: s, t: Date.now() });
    });
    props.setProperty('ZERT_OFFEN', JSON.stringify(offen.slice(-300)));
  } finally { lock.releaseLock(); }
}

/** Prüft stündlich die offenen Zertifikate und sendet nach, was inzwischen vorhanden ist. Nach 30 Tagen: Hinweis an den Inhaber. */
function zertOffenPruefen_(ctx) {
  var props = PropertiesService.getScriptProperties();
  var offen = JSON.parse(props.getProperty('ZERT_OFFEN') || '[]');
  if (!offen.length) return;
  var erledigt = {}, gruppen = {}, abgelaufen = [];
  offen.forEach(function (o) {
    var key = o.em + '|' + o.shop;
    var e = lookupSku(normalize(o.shop), ctx.codeMap);
    var files = (e && e.factory) ? findCertFiles(e.factory, ctx.index) : [];
    if (files.length) { (gruppen[o.em] = gruppen[o.em] || { name: o.name, shops: [] }).shops.push(o.shop); erledigt[key] = true; }
    else if (Date.now() - o.t > 30 * 24 * 3600 * 1000) { abgelaufen.push(o.shop + ' (' + o.em + ')'); erledigt[key] = true; }
  });
  Object.keys(gruppen).forEach(function (em) {
    var g = gruppen[em];
    var order = { anfrage: true, nachlieferung: true, name: 'Nachlieferung', email: em, billingAddress: { firstName: g.name, lastName: '' },
      lineItems: { nodes: g.shops.map(function (c) { return { sku: c, title: c, variantTitle: '' }; }) } };
    try { processOrder(order, ctx, null); } catch (e) { Logger.log('Nachlieferung ' + em + ': ' + e.message); }
  });
  if (abgelaufen.length) MailApp.sendEmail(CONFIG.OWNER_EMAIL, 'Zertifikate seit 30 Tagen ausstehend', 'Für diese Anfragen liegt nach 30 Tagen noch kein Zertifikat vor – bitte beim Werk nachfragen oder dem Kunden persönlich antworten:\n\n- ' + abgelaufen.join('\n- '));
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var neu = JSON.parse(props.getProperty('ZERT_OFFEN') || '[]').filter(function (o) { return !erledigt[o.em + '|' + o.shop]; });
    props.setProperty('ZERT_OFFEN', JSON.stringify(neu));
  } finally { lock.releaseLock(); }
  Logger.log('Offen geprüft: nachgesendet an ' + Object.keys(gruppen).length + ' Kunden, noch offen: ' + (offen.length - Object.keys(erledigt).length));
}

function zertQueueEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'zertQueueLauf') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('zertQueueLauf').timeBased().everyMinutes(10).create();
  Logger.log('Trigger eingerichtet: alle 10 Minuten');
}

function zertSenden_(em, name, codes, ctx) {
  var order = {
    anfrage: true, name: 'Anfrage', email: em,
    billingAddress: { firstName: name, lastName: '' },
    lineItems: { nodes: codes.map(function (c) { return { sku: c, title: c, variantTitle: '' }; }) }
  };
  var res = processOrder(order, ctx, null);
  var alk = codes.some(function (c) { return !!alkoholSds_(c); });
  if (!res.sent && !res.missing && !alk) {
    MailApp.sendEmail(CONFIG.OWNER_EMAIL, 'Zertifikatsanfrage ohne Treffer – ' + em,
      'Über die Seite "Zertifikate anfordern" wurden Codes angefragt, zu denen nichts gefunden wurde:\n\n' +
      codes.join('\n') + '\n\nE-Mail: ' + em + (name ? '\nName: ' + name : '') + '\n\nBitte manuell beantworten.');
  }
  return 'ok';
}


/** Bericht: Zertifikate für eine Liste von Codes + Gesamtübersicht der fehlenden Zertifikate (nur Log, sendet nichts). */
function zertBericht() {
  var ctx = buildContext();
  var liste = [['LV-MET-U-07-SH','1010359'],['CR-VIW-U-07-SH','3010360'],['PDM-SDL-H-17-SH','1010361'],['MF-BAX-U-07-SH','3010362'],
    ['MC-HIB-U-02-PQ-SH','3010363'],['MC-OMA-U-01-PQ-SH','3010364'],['MF-GRS-U-06-SH','3010245'],['DI-SAU-H-06-PQ-SH','1010366'],
    ['CH-PLT-H-03-SH','1010367'],['PR-LRB-H-01-PQ-SH','1010368'],['KA-EJAP-12-SH','3010369'],['YSL-LIBRE-LP-14-PQ-SH','2010370'],
    ['GU-CHO-U-10-PQ-SH','3010371'],['MAB-TIL-U-02-SH','3010010'],['YS-LIB-D-09-PQ-SH','2010043'],['PR-PAR-D-05-SH','2010002'],
    ['SO-IPD-U-43-SH','3010011'],['UNK-KAH-U-01-SH','3010310'],['VE-ERO-H-04-SH','1010236'],['VE-BLU-H-01-SH','1010320']];
  var out = [];
  liste.forEach(function (r) {
    var f = ctx.index[r[1]] || [];
    var e = lookupSku(normalize(r[0]), ctx.codeMap);
    out.push(r[0] + ' | ' + r[1] + ' | Tabelle: ' + (e ? (e.factory || 'ohne Fabrik-Code') : 'FEHLT') + ' | Dateien: ' + f.length + ' ' + f.map(function (x) { return x.type + '-' + x.lang; }).join(','));
  });
  Logger.log('LISTE\n' + out.join('\n'));
  var ohneCode = [], ohneDatei = [], gesamt = 0;
  Object.keys(ctx.codeMap).forEach(function (k) {
    var e = ctx.codeMap[k]; if (!e || !e.shop) return; gesamt++;
    if (!e.factory) ohneCode.push(e.shop);
    else if (!(ctx.index[e.factory] || []).length) ohneDatei.push(e.shop + ' ' + e.factory);
  });
  Logger.log('GESAMT Duftöl-Codes: ' + gesamt + ' | ohne Fabrik-Code: ' + ohneCode.length + ' | Fabrik-Code ohne Datei: ' + ohneDatei.length);
  Logger.log('OHNE_DATEI\n' + ohneDatei.join('\n'));
  Logger.log('OHNE_CODE\n' + ohneCode.join(', '));
}


/** Zeigt, welche Zertifikate das Werk in den letzten Tagen im Ordner "Fragrance Hub Documents" hinzugefügt hat (nur Log). */
function zertWerkNeu() {
  var seit = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  var heute = Utilities.formatDate(new Date(), 'Europe/Berlin', 'yyyy-MM-dd');
  var out = [], ordner = 0;
  (function walk(f, pfad) {
    ordner++;
    var files = f.getFiles();
    while (files.hasNext()) {
      var x = files.next(); var c = x.getDateCreated(); var u = x.getLastUpdated();
      if (c > seit || u > seit) out.push(Utilities.formatDate(c, 'Europe/Berlin', 'yyyy-MM-dd HH:mm') + ' | ' + pfad + '/' + x.getName() + (u > c ? ' (geändert ' + Utilities.formatDate(u, 'Europe/Berlin', 'yyyy-MM-dd HH:mm') + ')' : ''));
    }
    var subs = f.getFolders();
    while (subs.hasNext()) { var s = subs.next(); walk(s, pfad + '/' + s.getName()); }
  })(DriveApp.getFolderById('1Cf34gfmjrG8uTQIJLqPOJHoO8CW--oUy'), '');
  out.sort();
  Logger.log('Ordner gesamt: ' + ordner + ' | heute: ' + heute + ' | neue/geänderte Dateien (letzte 2 Tage): ' + out.length + '\n' + out.join('\n'));
}


/* ===================== Täglicher Prüfbericht (21 Uhr, Telegram) ===================== */
function pruefberichtEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'pruefberichtTaeglich') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('pruefberichtTaeglich').timeBased().atHour(21).everyDays(1).inTimezone('Europe/Berlin').create();
  Logger.log('Trigger eingerichtet: täglich ca. 21 Uhr');
}

function pruefberichtTaeglich() {
  var probleme = [], info = [], zeilen = [];
  try { var aufg = sendeOrdnerAufraeumen(); if (aufg) info.push('🧹 ' + aufg + ' مجلد طلب قديم نُقل إلى سلة المهملات'); } catch (e) { Logger.log('Aufräumen: ' + e.message); }
  // 1) Automatik-Trigger vorhanden?
  var handler = ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); });
  ['processPaidOrders', 'zertQueueLauf'].forEach(function (h) { if (handler.indexOf(h) < 0) probleme.push('⛔ البرنامج التلقائي ' + h + ' متوقف (لا يوجد Trigger)'); });
  // 2) Sync (IFRA immer neu) zuletzt gelaufen?
  try {
    var sf = DriveApp.getFoldersByName(CONFIG.SYNC_FOLDER_NAME).next();
    var d = sf.getDescription() || '';
    var m = /^(\d+)\|(.*)$/.exec(d);
    if (!m) info.push('ℹ️ حالة المزامنة غير معروفة بعد');
    else {
      var std = (Date.now() - Number(m[1])) / 3600000;
      if (std > 3) probleme.push('⛔ المزامنة لم تعمل منذ ' + Math.round(std) + ' ساعة');
      else if (m[2].indexOf('CONTINUES') >= 0) info.push('🔄 المزامنة ما زالت تنسخ شهادات المصنع (' + m[2] + ')');
    }
  } catch (e) { probleme.push('⛔ مجلد المزامنة غير موجود: ' + e.message); }

  var ctx = { codeMap: loadCodeMap(), index: buildFileIndex(true) };
  // 3) Aktive Duftöle im Shop prüfen
  var produkte = [], after = null;
  do {
    var data = shopifyGraphQL('query($a:String){ products(first:250, after:$a, query:"product_type:\'Fragrance Oil\' AND status:active"){ pageInfo{ hasNextPage endCursor } nodes{ title variants(first:5){ nodes{ sku } } } } }', { a: after });
    data.products.nodes.forEach(function (p) {
      var sku = (p.variants.nodes.map(function (v) { return v.sku; }).filter(Boolean)[0] || '');
      var stem = sku.indexOf('-SH') > 0 ? sku.split('-SH')[0] + '-SH' : sku;
      produkte.push({ title: p.title, stem: stem });
    });
    after = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (after);
  var ohneZeile = [], ohneCode = [], ohneDatei = [], proFabrik = {};
  produkte.forEach(function (p) {
    if (!p.stem) { ohneZeile.push(p); return; }
    var e = lookupSku(normalize(p.stem), ctx.codeMap);
    if (!e) { ohneZeile.push(p); zeilen.push(['Nicht in Tabelle', p.stem, p.title, '']); return; }
    if (!e.factory) { ohneCode.push(p); zeilen.push(['Ohne Fabrik-Code', p.stem, p.title, '']); return; }
    (proFabrik[e.factory] = proFabrik[e.factory] || []).push(p);
    if (!findCertFiles(e.factory, ctx.index).length) { ohneDatei.push(p); zeilen.push(['Zertifikat fehlt in Drive', p.stem, p.title, e.factory]); }
  });
  var doppelt = Object.keys(proFabrik).filter(function (f) { return proFabrik[f].length > 1; });
  doppelt.forEach(function (f) { proFabrik[f].forEach(function (p) { zeilen.push(['Fabrik-Code doppelt', p.stem, p.title, f]); }); });
  // 4) Neue Fabrik-Codes in Drive ohne Zuordnung
  var bekannt = {};
  Object.keys(ctx.codeMap).forEach(function (k) { var e = ctx.codeMap[k]; if (e && e.factory) bekannt[e.factory] = true; });
  var neu = Object.keys(ctx.index).filter(function (c) { return /^\d{7}$/.test(c) && !bekannt[c]; });
  neu.forEach(function (c) { zeilen.push(['Neuer Fabrik-Code ohne Zuordnung', '', ctx.index[c][0].name, c]); });
  // 5) Wartende Kunden + Bestellungen mit fehlenden Zertifikaten (24 h)
  var offen = JSON.parse(PropertiesService.getScriptProperties().getProperty('ZERT_OFFEN') || '[]');
  var fehlend24 = 0; try { fehlend24 = GmailApp.search('in:sent subject:"Fehlende Zertifikate" newer_than:1d').length; } catch (e) {}

  // Detail-Tabelle schreiben
  var ss = openCodesSpreadsheet();
  var sh = ss.getSheetByName('Prüfbericht') || ss.insertSheet('Prüfbericht');
  sh.clear();
  sh.getRange(1, 1, 1, 4).setValues([['Problem', 'Shop-Code', 'Produkt / Datei', 'Fabrik-Code']]).setFontWeight('bold');
  if (zeilen.length) sh.getRange(2, 1, zeilen.length, 4).setValues(zeilen);
  sh.setFrozenRows(1);

  if (doppelt.length) probleme.push('⚠️ رقم مصنع واحد لصنفين مختلفين: ' + doppelt.length + ' (' + doppelt.slice(0, 3).map(function (f) { return proFabrik[f].map(function (p) { return p.title; }).join(' / '); }).join('، ') + ')');
  if (neu.length) probleme.push('🆕 شهادات جديدة من المصنع غير مربوطة بصنف: ' + neu.length + ' (' + neu.slice(0, 8).join('، ') + ')');
  if (ohneZeile.length) probleme.push('➕ أصناف زيت في المتجر غير موجودة في الجدول: ' + ohneZeile.length + ' (مثل ' + ohneZeile.slice(0, 3).map(function (p) { return p.title; }).join('، ') + ')');
  var txt = '📋 تقرير الشهادات اليومي – ' + Utilities.formatDate(new Date(), 'Europe/Berlin', 'dd.MM.yyyy') + '\n\n';
  txt += (probleme.length ? probleme.join('\n') : '✅ كل الأنظمة تعمل، ولا توجد مشاكل جديدة') + '\n\n';
  txt += '📊 أصناف الزيت النشطة: ' + produkte.length + '\n';
  txt += '• بشهادة جاهزة: ' + (produkte.length - ohneZeile.length - ohneCode.length - ohneDatei.length) + '\n';
  txt += '• بدون رقم مصنع في الجدول: ' + ohneCode.length + '\n';
  txt += '• رقم المصنع موجود والشهادة غير موجودة في Drive: ' + ohneDatei.length + '\n';
  txt += '• عملاء ينتظرون شهادة: ' + offen.length + '\n';
  txt += '• طلبات اليوم بشهادات ناقصة: ' + fehlend24 + '\n';
  if (info.length) txt += '\n' + info.join('\n') + '\n';
  txt += '\nالتفاصيل: جدول Fragrance Hub Codes ← ورقة "Prüfbericht"';
  etTelegram_(txt, null);
  Logger.log(txt);
}


function zertIndexTest() {
  var t0 = Date.now(); var a = buildFileIndex(true); var t1 = Date.now(); var b = buildFileIndex(); var t2 = Date.now();
  var f = findCertFiles('3010362', b);
  Logger.log('Neu einlesen: ' + Math.round((t1 - t0) / 1000) + ' s, Codes: ' + (Object.keys(a).length - 1) + ' | aus Zwischenspeicher: ' + Math.round((t2 - t1) / 1000) + ' s, Codes: ' + (Object.keys(b).length - 1) + ' | 3010362: ' + f.map(function (x) { return x.file.getName(); }).join(', '));
}


/** Speicher-Analyse: welche eigenen Dateien belegen Drive (nur Log). */
function driveSpeicherAnalyse() {
  var t0 = Date.now(), gruppen = {}, gesamt = 0, n = 0;
  function add(g, s) { gruppen[g] = gruppen[g] || { mb: 0, n: 0 }; gruppen[g].mb += s / 1048576; gruppen[g].n++; }
  var it = DriveApp.searchFiles("'me' in owners and trashed = false");
  while (it.hasNext() && Date.now() - t0 < 300000) {
    var f = it.next(), s = f.getSize(), name = f.getName(); n++; gesamt += s;
    var g = 'Sonstiges';
    if (/_Zertifikat_|– Zertifikat/.test(name)) g = 'Zertifikate umbenannt (Bestell-Ordner/Versand-Kopien)';
    else if (/^(Kopie von|Copy of|نسخة من)/.test(name)) g = 'Kopien (Kopie von / نسخة من)';
    else if (/(^|\D)\d{7}(\D|$)/.test(name) && /\.pdf$/i.test(name)) g = 'Werks-Zertifikate (Sync-Kopien)';
    else if (/\.pdf$/i.test(name)) g = 'Andere PDFs';
    else if (/^image\/|^video\//.test(f.getMimeType())) g = 'Bilder/Videos';
    add(g, s);
  }
  var bo = 0, bit = DriveApp.searchFolders("title contains 'Bestellung' and 'me' in owners and trashed = false"); while (bit.hasNext()) { bit.next(); bo++; }
  var out = Object.keys(gruppen).map(function (k) { return k + ': ' + Math.round(gruppen[k].mb) + ' MB (' + gruppen[k].n + ' Dateien)'; });
  Logger.log('Dateien: ' + n + ' | gesamt ' + Math.round(gesamt / 1048576) + ' MB | Bestell-Ordner: ' + bo + (it.hasNext() ? ' | (nicht vollständig)' : '') + '\n' + out.join('\n'));
}


/** Bestell-Ordner mit Zertifikats-Kopien nach 14 Tagen in den Papierkorb (spart Drive-Speicher). */
function sendeOrdnerAufraeumen() {
  var it = DriveApp.getRootFolder().getFoldersByName(CONFIG.SEND_FOLDER_NAME);
  if (!it.hasNext()) return 0;
  var grenze = Date.now() - 14 * 24 * 3600 * 1000, n = 0, subs = it.next().getFolders();
  while (subs.hasNext()) {
    var f = subs.next();
    if (f.getName().indexOf('Bestellung ') === 0 && f.getDateCreated().getTime() < grenze) { f.setTrashed(true); n++; }
  }
  Logger.log('Bestell-Ordner in Papierkorb: ' + n);
  return n;
}
