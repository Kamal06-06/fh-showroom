/**
 * Fragrance Hub Germany – Zertifikate automatisch nach Zahlung versenden
 * Shopify (bezahlte Bestellungen) → Google Drive (Zertifikate-Sync) → E-Mail an den Kunden
 *
 * Einrichtung:
 * 1. CONFIG unten ausfüllen.
 * 2. Projekteinstellungen → Skripteigenschaften:
 *      SHOPIFY_CLIENT_ID und SHOPIFY_CLIENT_SECRET   (App aus dem Shopify Dev Dashboard)
 *      oder SHOPIFY_ACCESS_TOKEN                      (ältere Custom App mit festem Token)
 * 3. testOrder() mit einer echten Bestellnummer ausführen → Mail geht nur an OWNER_EMAIL.
 * 4. setup() einmal ausführen → prüft danach alle 10 Minuten automatisch.
 */

const CONFIG = {
  SHOP: 'fragrancsehub.myshopify.com',
  API_VERSION: '2026-07',

  // Google-Tabelle mit den Codes (Fragrance_Hub_Codes als Google Sheet)
  CODES_SHEET_ID: '1qETeGWZcHDYu7vdP0PxMVHgbyrUk9vv_TwQSL56fAk4',              // fest: es gibt 2 Dateien mit diesem Namen – nie die alte Kopie nehmen
  CODES_SHEET_TITLE: 'Fragrance Hub Codes',
  CODES_SHEET_NAME: '',            // leer = Blatt wird automatisch erkannt
  COL_PRODUCT_NAME: 'C',           // اسم المنتج
  COL_SHOP_CODE: 'D',              // الكود الظاهر للعملاء (= SKU in Shopify)
  COL_FACTORY_CODE: 'E',           // كود شهادة المصنع

  SYNC_FOLDER_NAME: 'Zertifikate-Sync',
  SEND_FOLDER_NAME: 'Zertifikate-Versand', // nur für große Bestellungen (Link statt Anhang)

  OWNER_EMAIL: 'info@fragranceshub.de',    // bekommt Hinweise zu fehlenden Zertifikaten
  SENDER_NAME: 'Fragrance Hub Germany',
  DONE_TAG: 'certs-sent',
  MAX_ATTACH_MB: 18,

  TEST_ORDER_NAME: '3761',          // z.B. '3772' – leer = letzte bezahlte Bestellung
};

/* ===================== Start & Zeitsteuerung ===================== */

function setup() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('START_DATE')) {
    props.setProperty('START_DATE', new Date().toISOString()); // alte Bestellungen werden ignoriert
  }
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processPaidOrders')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processPaidOrders').timeBased().everyMinutes(10).create();
  Logger.log('Eingerichtet. Bestellungen ab ' + props.getProperty('START_DATE') + ' werden verarbeitet.');
}

function processPaidOrders() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    const props = PropertiesService.getScriptProperties();
    const start = props.getProperty('START_DATE');
    if (!start) throw new Error('Bitte zuerst setup() ausführen.');

    const q = `financial_status:paid created_at:>='${start}' -tag:${CONFIG.DONE_TAG}`;
    const orders = fetchOrders(q, 50);
    if (!orders.length) return;          // nichts Neues → Drive wird gar nicht gelesen
    const ctx = buildContext();

    const t0 = Date.now(); // Zeitbudget: nach 4,5 Min. aufhören, Rest im nächsten Lauf (Google-Limit 6 Min.)
    orders.forEach(order => {
      if (Date.now() - t0 > 270000) return;
      if ((order.tags || []).includes(CONFIG.DONE_TAG)) return;
      if (props.getProperty('done_' + order.id)) return;
      try {
        processOrder(order, ctx, null);
        addTag(order.id, CONFIG.DONE_TAG);
        props.setProperty('done_' + order.id, '1');
      } catch (e) {
        const key = 'err_' + order.id;
        if (!props.getProperty(key)) {
          props.setProperty(key, '1');
          MailApp.sendEmail(CONFIG.OWNER_EMAIL,
            `Fehler beim Zertifikatsversand ${order.name}`,
            `Die Zertifikate für ${order.name} konnten nicht gesendet werden:\n\n${e.message}`);
        }
        Logger.log(order.name + ': ' + e.message);
      }
    });
  } finally {
    lock.releaseLock();
  }
}

/** Testlauf: sendet die Zertifikate einer Bestellung nur an OWNER_EMAIL, ohne Tag. */
function testOrder() {
  const nr = CONFIG.TEST_ORDER_NAME.replace('#', '').trim();
  const findByName = n => {
    const tries = /^\d+$/.test(n) ? [`B-Nr:${n}`, `#${n}`, n] : [n];
    for (const t of tries) {
      const found = fetchOrders(`name:"${t}"`, 1);
      if (found.length) return found;
    }
    return [];
  };
  const orders = nr
    ? findByName(nr)
    : shopifyGraphQL(`
        query {
          orders(first: 1, query: "financial_status:paid", sortKey: CREATED_AT, reverse: true) {
            nodes {
              id name email tags
              billingAddress { firstName lastName company }
              lineItems(first: 250) { nodes { sku title variantTitle } }
            }
          }
        }`, {}).orders.nodes;
  if (!orders.length) throw new Error('Keine passende Bestellung gefunden.');
  Logger.log('Teste Bestellung ' + orders[0].name);
  processOrder(orders[0], buildContext(), CONFIG.OWNER_EMAIL);
  Logger.log('Testmail gesendet an ' + CONFIG.OWNER_EMAIL);
}

/** Prüft alles und schreibt das Ergebnis ins Ausführungsprotokoll – sendet nichts. */
function diagnose() {
  const log = m => Logger.log(m);

  const index = buildFileIndex();
  const st = index.__stats;
  log(`ORDNER "${CONFIG.SYNC_FOLDER_NAME}": ${st.folders} Ordner, ${st.files} Dateien, davon ${st.withCode} mit 7-stelligem Code`);
  log('Beispiel-Dateinamen: ' + st.samples.join('  |  '));

  const map = loadCodeMap();
  const keys = Object.keys(map);
  log(`TABELLE: ${keys.length} Produkte. Beispiel: ` +
      keys.slice(0, 3).map(k => `${map[k].shop} → ${map[k].factory}`).join('  |  '));

  const nr = CONFIG.TEST_ORDER_NAME.replace('#', '').trim();
  const tries = /^\d+$/.test(nr) ? [`B-Nr:${nr}`, `#${nr}`, nr] : [nr];
  let order = null;
  for (const t of tries) { const f = fetchOrders(`name:"${t}"`, 1); if (f.length) { order = f[0]; break; } }
  if (!order) { log('BESTELLUNG nicht gefunden: ' + nr); return; }
  log(`BESTELLUNG ${order.name} – E-Mail: ${order.email || 'FEHLT'}`);

  order.lineItems.nodes.forEach(li => {
    const sku = normalize(li.sku);
    const e = sku ? lookupSku(sku, map) : null;
    const files = e ? findCertFiles(e.factory, index) : [];
    log(`• ${li.title} | SKU: "${li.sku || ''}" | in Tabelle (= Duftöl): ${e ? 'JA ' + e.shop + ' → ' + e.factory : 'NEIN'} | Dateien: ${files.length}` +
        (files.length ? ' (' + files.map(f => f.name).join(', ') + ')' : ''));
  });
}

/**
 * Prüft alle SKUs aus den letzten Bestellungen (bis 500) und zeigt im Protokoll:
 * welche als Duftöl erkannt werden, ob sie in der Tabelle stehen und ob Zertifikate existieren.
 * Sendet nichts.
 */
function checkSkus() {
  const log = m => Logger.log(m);
  const map = loadCodeMap();
  const index = buildFileIndex();

  const skus = {};
  let cursor = null;
  for (let page = 0; page < 20; page++) {
    const data = shopifyGraphQL(`
      query($after: String) {
        orders(first: 25, after: $after, sortKey: CREATED_AT, reverse: true) {
          pageInfo { hasNextPage endCursor }
          nodes { lineItems(first: 50) { nodes { sku title } } }
        }
      }`, { after: cursor });
    data.orders.nodes.forEach(o => o.lineItems.nodes.forEach(li => {
      const k = normalize(li.sku);
      if (!skus[k]) skus[k] = li.title;
    }));
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }

  const ok = [], noTable = [], noFiles = [], notOil = [];
  const rows = [];
  Object.keys(skus).forEach(sku => {
    const title = skus[sku];
    const label = `${title} [${sku || 'ohne SKU'}]`;
    const e = sku ? lookupSku(sku, map) : null;
    if (!e) {
      if (isOilSku(sku)) { noTable.push(label); rows.push(['❓ Nicht in Tabelle (Glas? oder Duftöl fehlt)', title, sku, '', '']); }
      else notOil.push(label);
      return;
    }
    if (!e.factory) {
      noFiles.push(`${label} → Fabrik-Code fehlt`);
      rows.push(['⚠️ Fabrik-Code fehlt', title, sku, e.shop, '']);
      return;
    }
    if (!findCertFiles(e.factory, index).length) {
      noFiles.push(`${label} → ${e.factory}`);
      rows.push(['⚠️ Keine Zertifikat-Datei', title, sku, e.shop, e.factory]);
      return;
    }
    ok.push(label);
    rows.push(['✅ OK – wird gesendet', title, sku, e.shop, e.factory]);
  });

  // Ergebnis als eigenes Blatt in "Fragrance Hub Codes"
  const ss = openCodesSpreadsheet();
  const sheet = ss.getSheetByName('SKU-Prüfung') || ss.insertSheet('SKU-Prüfung');
  sheet.clear();
  const header = [['Status', 'Produkt', 'SKU in Shopify', 'Code in Tabelle', 'Fabrik-Code']];
  rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]));
  sheet.getRange(1, 1, 1, 5).setValues(header).setFontWeight('bold');
  if (rows.length) sheet.getRange(2, 1, rows.length, 5).setValues(rows);
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 5);

  log(`Geprüft: ${Object.keys(skus).length} verschiedene SKUs aus den letzten Bestellungen`);
  log(`✅ Wird gesendet: ${ok.length}`);
  log(`❓ Mit -SH, aber nicht in der Tabelle (Glas? oder fehlendes Duftöl): ${noTable.length}`);
  log(`⚠️ In der Tabelle, aber keine Zertifikat-Datei oder kein Fabrik-Code: ${noFiles.length}`);
  log(`⏭️ Ohne -SH, ignoriert: ${notOil.length}`);
  log('➡️ Vollständige Liste: Tabelle "Fragrance Hub Codes", Blatt "SKU-Prüfung"');
}

/**
 * Sucht für jede ⚠️- und ❓-Zeile im Blatt "SKU-Prüfung" in GANZ Google Drive nach passenden Zertifikaten
 * und schreibt Fundort + vorgeschlagenen Fabrik-Code in die Spalten F–H. Sendet nichts.
 * Läuft max. 5 Minuten – danach einfach erneut ausführen, es macht dort weiter.
 */
function findMissing() {
  const started = Date.now();
  const sh = openCodesSpreadsheet().getSheetByName('SKU-Prüfung');
  if (!sh) throw new Error('Blatt "SKU-Prüfung" fehlt – bitte zuerst checkSkus ausführen.');
  sh.getRange(1, 6, 1, 3).setValues([['Gefunden (Dateiname)', 'Ordner', 'Vorschlag Fabrik-Code']]).setFontWeight('bold');

  const data = sh.getDataRange().getValues();
  const esc = t => String(t).replace(/\\/g, '').replace(/'/g, "\\'");
  const search = term => {
    const out = [];
    const it = DriveApp.searchFiles(`title contains '${esc(term)}' and trashed = false and mimeType != 'application/vnd.google-apps.folder'`);
    while (it.hasNext() && out.length < 4) out.push(it.next());
    return out;
  };

  let done = 0, left = 0;
  for (let r = 1; r < data.length; r++) {
    const [status, title, sku, , factory, foundBefore] = data[r];
    if (foundBefore) continue;
    const isWarn = String(status).startsWith('⚠️');
    const isQ = String(status).startsWith('❓');
    if (!isWarn && !isQ) continue;
    if (Date.now() - started > 5 * 60 * 1000) { left++; continue; }

    const terms = isWarn ? [String(factory)] : [String(title).trim(), (canonCode(sku) || '').split('|')[0]];
    let files = [];
    for (const t of terms) {
      if (!t || t.length < 3) continue;
      files = search(t);
      if (files.length) break;
    }

    let row;
    if (!files.length) {
      row = ['– nicht gefunden –', '', ''];
    } else {
      const names = files.map(f => f.getName());
      const folders = files.map(f => { const p = f.getParents(); return p.hasNext() ? p.next().getName() : '?'; });
      const codes = [...new Set(names.join(' ').match(/(?<!\d)\d{7}(?!\d)/g) || [])];
      row = [names.join('  |  '), [...new Set(folders)].join('  |  '), codes.join(', ')];
    }
    sh.getRange(r + 1, 6, 1, 3).setValues([row]);
    done++;
  }
  sh.autoResizeColumns(6, 3);
  Logger.log(`Geprüft in diesem Lauf: ${done}` + (left ? ` | Noch offen: ${left} → findMissing bitte erneut ausführen` : ' | Fertig ✅'));
}

/* ===================== Fehlende Duftöle in die Tabelle übernehmen ===================== */

/**
 * Schritt 1: Erstellt das Blatt "Neue Duftöle" aus allen ❓-Zeilen von "SKU-Prüfung".
 * Wahrscheinliche Duftöle sind schon angehakt, Glas/Zubehör nicht. Sendet nichts, ändert die Tabelle nicht.
 */
function prepareNewOils() {
  const started = Date.now();
  const ss = openCodesSpreadsheet();
  const check = ss.getSheetByName('SKU-Prüfung');
  if (!check) throw new Error('Blatt "SKU-Prüfung" fehlt – bitte zuerst checkSkus ausführen.');
  const map = loadCodeMap();

  const cand = {};
  check.getDataRange().getValues().slice(1).forEach(([status, title, sku]) => {
    if (!String(status).startsWith('❓') || !sku) return;
    const c = canonCode(sku);
    if (!c) return;
    const [base, pq] = c.split('|');
    const shop = base + (pq ? '-PQ-SH' : '-SH');
    if (map[normalize(shop)] || cand[shop]) return;
    cand[shop] = { title: String(title).trim(), sku, shop, oil: looksLikeOil(base, String(title)) };
  });

  const rows = Object.values(cand)
    .sort((a, b) => (b.oil - a.oil) || a.title.localeCompare(b.title))
    .map(x => {
      let hint = '';
      if (x.oil && Date.now() - started < 4.5 * 60 * 1000) hint = suggestCodeByName(x.title);
      return [x.oil, x.title, x.shop, x.sku, '', hint];
    });

  const sh = ss.getSheetByName('Neue Duftöle') || ss.insertSheet('Neue Duftöle');
  sh.clear();
  sh.getRange(1, 1, 1, 7).setValues([['Hinzufügen?', 'Produkt', 'Shop-Code (für Tabelle)', 'Beispiel-SKU',
    'Fabrik-Code (nur wenn sicher, sonst leer)', 'Hinweis aus Drive (nur zur Info)', 'Erledigt']]).setFontWeight('bold');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).insertCheckboxes();   // setzt alles auf false …
    sh.getRange(2, 1, rows.length, 6).setValues(rows);       // … danach die echten Haken
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 7);
  Logger.log(`Blatt "Neue Duftöle": ${rows.length} Kandidaten, davon ${rows.filter(r => r[0]).length} als Duftöl angehakt. ` +
             'Bitte prüfen, Haken korrigieren, dann addNewOils ausführen.');
}

/**
 * Wie prepareNewOils, aber aus ALLEN Produkten des Shops (nicht nur aus Bestellungen).
 * Liest die öffentliche Produktliste des Shops (nur veröffentlichte Produkte). Schreibt "Neue Duftöle" – danach addNewOils.
 */
function importAllOils() {
  // Öffentliche Produktliste des Online-Shops – braucht KEINE zusätzliche Berechtigung
  const map = loadCodeMap();
  const shopOils = {};      // alle Duftöl-Codes im Shop
  const cand = {};          // davon fehlend in der Tabelle
  let variants = 0;

  for (let page = 1; page <= 100; page++) {
    const res = UrlFetchApp.fetch(`https://${CONFIG.SHOP}/products.json?limit=250&page=${page}`,
                                  { muteHttpExceptions: true, followRedirects: true });
    if (res.getResponseCode() >= 300) throw new Error('Produktliste nicht lesbar: HTTP ' + res.getResponseCode());
    const products = JSON.parse(res.getContentText()).products || [];
    if (!products.length) break;
    products.forEach(p => (p.variants || []).forEach(v => {
      variants++;
      const sku = normalize(v.sku);
      const title = String(p.title || '').trim();
      if (!sku) return;
      const c = canonCode(sku);
      if (!c) return;
      const [base, pq] = c.split('|');
      const inTable = lookupSku(sku, map);
      if (!inTable && !looksLikeOil(base, title)) return;
      const shop = base + (pq ? '-PQ-SH' : '-SH');
      shopOils[shop] = true;
      if (inTable || cand[shop]) return;
      cand[shop] = [true, title, shop, v.sku, '', ''];
    }));
  }

  const rows = Object.values(cand).sort((a, b) => a[1].localeCompare(b[1]));
  const ss = openCodesSpreadsheet();
  const sh = ss.getSheetByName('Neue Duftöle') || ss.insertSheet('Neue Duftöle');
  sh.clear();
  sh.getDataRange().clearDataValidations();
  sh.getRange(1, 1, 1, 7).setValues([['Hinzufügen?', 'Produkt', 'Shop-Code (für Tabelle)', 'Beispiel-SKU',
    'Fabrik-Code (nur wenn sicher, sonst leer)', 'Hinweis', 'Erledigt']]).setFontWeight('bold');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).insertCheckboxes();
    sh.getRange(2, 1, rows.length, 6).setValues(rows);
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 7);

  const total = Object.keys(shopOils).length;
  Logger.log(`Varianten im Shop geprüft: ${variants}`);
  Logger.log(`🧴 Duftöl-Sorten im Shop (Standard und Premium getrennt gezählt): ${total}`);
  Logger.log(`✅ Schon in der Tabelle: ${total - rows.length}`);
  Logger.log(`➕ Fehlen in der Tabelle: ${rows.length} → Blatt "Neue Duftöle" prüfen, dann addNewOils ausführen`);
}

/** Schritt 2: Übernimmt alle angehakten Zeilen aus "Neue Duftöle" in die Code-Tabelle (C, D, E). */
function addNewOils() {
  const ss = openCodesSpreadsheet();
  const sh = ss.getSheetByName('Neue Duftöle');
  if (!sh) throw new Error('Blatt "Neue Duftöle" fehlt – bitte zuerst prepareNewOils ausführen.');
  const target = getCodesSheet(ss);
  const map = loadCodeMap();
  const col = l => l.toUpperCase().charCodeAt(0) - 64;

  const data = sh.getDataRange().getValues();
  let added = 0, skipped = 0;
  for (let r = 1; r < data.length; r++) {
    const [tick, title, shop, , factoryRaw, , done] = data[r];
    if (tick !== true || done) continue;
    const factory = String(factoryRaw || '').trim();
    if (map[normalize(shop)] || (factory && !/^\d{7}$/.test(factory))) {
      sh.getRange(r + 1, 7).setValue(factory && !/^\d{7}$/.test(factory) ? '✗ Fabrik-Code ungültig' : '– schon in Tabelle');
      skipped++;
      continue;
    }
    const row = target.getLastRow() + 1;
    target.getRange(row, col(CONFIG.COL_PRODUCT_NAME)).setValue(title);
    target.getRange(row, col(CONFIG.COL_SHOP_CODE)).setValue(shop);
    if (factory) target.getRange(row, col(CONFIG.COL_FACTORY_CODE)).setValue(factory);
    sh.getRange(r + 1, 7).setValue('✔ hinzugefügt');
    map[normalize(shop)] = { shop };
    added++;
  }
  Logger.log(`Neu in der Tabelle: ${added} | übersprungen: ${skipped}`);
}

/** Grobe Einschätzung: Duftöl-Codes haben H/D/U (Herren/Damen/Unisex) oder beginnen mit AR; Zubehör-Wörter sprechen dagegen. */
function looksLikeOil(base, title) {
  if (/(flasche|crimp|spritze|ethanol|alkohol|glas|zerstäuber|deckel|pumpe|trichter|kappe|verschluss|etikett|karton|box|pipette|tester|sprüh|beutel|tüte)/i.test(title)) return false;
  const segs = base.split('-');
  return segs.some(x => ['H', 'D', 'U'].includes(x)) || segs[0] === 'AR' || /^FHG\s/i.test(title);
}

/** Sucht PDFs, deren Name den Produktnamen enthält, und nennt gefundene 7-stellige Codes (nur als Hinweis). */
function suggestCodeByName(title) {
  const name = title.replace(/^FHG\s+/i, '').replace(/'/g, '').trim();
  if (name.length < 4) return '';
  const it = DriveApp.searchFiles(`title contains '${name}' and trashed = false and mimeType = 'application/pdf'`);
  const codes = new Set();
  let n = 0;
  while (it.hasNext() && n++ < 6) (it.next().getName().match(/(?<!\d)\d{7}(?!\d)/g) || []).forEach(c => codes.add(c));
  return codes.size ? [...codes].join(', ') : '';
}

/* ===================== Verarbeitung einer Bestellung ===================== */

function buildContext() {
  return { codeMap: loadCodeMap(), index: buildFileIndex() };
}

function processOrder(order, ctx, overrideRecipient) {
  const recipient = overrideRecipient || order.email;
  if (!recipient) throw new Error('Keine E-Mail-Adresse in der Bestellung.');

  const blobs = [];
  const srcFiles = [];
  const found = [];
  const missing = [];
  const seen = {};
  const alkohol = [];
  const alkSeen = {};
  const offen = [];

  order.lineItems.nodes.forEach(li => {
    const alk = alkoholSds_(li.sku);
    if (alk && !alkSeen[alk.key]) { alkSeen[alk.key] = true; alkohol.push(alk.text); }
    const sku = normalize(li.sku);
    const label = li.title + (li.variantTitle ? ' – ' + li.variantTitle : '');
    // Nur Produkte aus der Code-Tabelle sind Duftöle. Alles andere (Glas, Deckel, Sprüher …) wird ignoriert.
    const entry = sku ? lookupSku(sku, ctx.codeMap) : null;
    if (!entry) return;
    if (seen[entry.shop]) return;
    seen[entry.shop] = true;

    if (!entry.factory) { offen.push({ label: label, shop: entry.shop }); missing.push(`${label} [${entry.shop}] – Fabrik-Code fehlt in der Tabelle`); return; }
    const files = findCertFiles(entry.factory, ctx.index);
    if (!files.length) { offen.push({ label: label, shop: entry.shop }); missing.push(`${label} [${entry.shop}] – kein Zertifikat für Fabrik-Code ${entry.factory}`); return; }

    const productName = entry.name || li.title;
    files.forEach(f => {
      const ext = (f.file.getName().match(/\.[a-z0-9]+$/i) || ['.pdf'])[0];
      const parts = [entry.shop, productName, f.type, f.lang].filter(Boolean);
      blobs.push(f.file.getBlob().setName(safeName(parts.join('_')) + ext));
      srcFiles.push(f.file);
    });
    found.push(`${entry.shop} – ${productName}`);
  });

  if (blobs.length || alkohol.length || offen.length) {
    const totalMB = blobs.reduce((s, b) => s + b.getBytes().length, 0) / 1048576;
    let link = null;
    let attachments = blobs;
    if (totalMB > CONFIG.MAX_ATTACH_MB) {
      link = createShareFolder(order.name, blobs, srcFiles);
      attachments = [];
    }
    sendCustomerMail(recipient, order, found, attachments, link, alkohol, offen.map(o => o.label));
  }

  if (missing.length) {
    MailApp.sendEmail(CONFIG.OWNER_EMAIL,
      `Fehlende Zertifikate – Bestellung ${order.name}`,
      `Für folgende Produkte der Bestellung ${order.name} (${order.email || '-'}) wurde nichts gesendet:\n\n- ` +
      missing.join('\n- ') +
      `\n\nBitte manuell nachsenden oder die Code-Tabelle ergänzen.`);
  }
  if (offen.length && !order.nachlieferung) {
    try {
      const ba = order.billingAddress || {};
      zertOffenMerken_(recipient, [ba.firstName, ba.lastName].filter(Boolean).join(' '), offen.map(o => o.shop));
    } catch (e) { Logger.log('Offen merken: ' + e.message); }
  }
  const result = { sent: found.length, missing: missing.length };
  Logger.log(`Gesendet: ${result.sent} Produkt(e) | Fehlend: ${result.missing}` + (missing.length ? '\n- ' + missing.join('\n- ') : ''));
  return result;
}

function sendCustomerMail(to, order, found, attachments, link, alkohol, ausstehend) {
  ausstehend = ausstehend || [];
  alkohol = alkohol || [];
  const b = order.billingAddress || {};
  const name = [b.firstName, b.lastName].filter(Boolean).join(' ');
  const greeting = name ? `Guten Tag ${name},` : 'Guten Tag,';

  let body = `${greeting}\n\n` + (order.nachlieferung ? 'wie angekündigt erhalten Sie heute die noch ausstehenden Unterlagen. ' : order.anfrage ? 'vielen Dank für Ihre Anfrage. ' : `vielen Dank für Ihre Bestellung ${order.name}. `);
  if (found.length) body +=
    `Anbei erhalten Sie die IFRA-Zertifikate und Sicherheitsdatenblätter (Deutsch und Englisch) zu Ihren Produkten:\n\n- ` +
    found.join('\n- ') + '\n\n';
  if (alkohol.length) body +=
    (found.length ? 'Die Unterlagen zu Ihrem Alkohol finden Sie unter diesen Links:\n\n' : 'Hier erhalten Sie die Unterlagen zu Ihrem Alkohol:\n\n') +
    alkohol.join('\n\n') + '\n\n';
  if (ausstehend.length) body +=
    'Für folgende Produkte werden die Unterlagen gerade beim Hersteller aktualisiert. Sie erhalten sie automatisch per E-Mail, sobald sie vorliegen (in der Regel innerhalb von 3 Werktagen):\n\n- ' +
    ausstehend.join('\n- ') + '\n\n';
  if (link) body += `Wegen der Dateigröße finden Sie die Dokumente unter diesem Link:\n${link}\n\n`;
  body +=
    (order.anfrage ? '' : `Ihre Rechnung erhalten Sie separat per E-Mail.\n`) +
    `Bei Fragen antworten Sie einfach auf diese Nachricht.\n\n` +
    `Mit freundlichen Grüßen\n${CONFIG.SENDER_NAME}\nfragranceshub.de`;

  GmailApp.sendEmail(to, order.anfrage ? `Zertifikate zu Ihrer Anfrage – ${CONFIG.SENDER_NAME}` : `Zertifikate zu Ihrer Bestellung ${order.name} – ${CONFIG.SENDER_NAME}`, body, {
    name: CONFIG.SENDER_NAME,
    replyTo: CONFIG.OWNER_EMAIL,
    ...(fhAbsender_() ? { from: fhAbsender_() } : {}),
    attachments: attachments,
  });
}

/** Platzsparend: jede Zertifikatsdatei liegt nur EINMAL in der Bibliothek, der Bestellordner enthält nur Verknüpfungen.
 *  Gleiche Bestellung → gleicher Ordner (keine Doppel-Ordner). Siehe Speicher.gs */
function createShareFolder(orderName, blobs, srcs) {
  const root = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.SEND_FOLDER_NAME);
  const name = 'Bestellung ' + orderName;
  const it = root.getFoldersByName(name);
  const folder = it.hasNext() ? it.next() : root.createFolder(name);
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  const lib = zertBibliothek_();
  blobs.forEach((b, i) => {
    const fname = b.getName();
    if (folder.getFilesByName(fname).hasNext()) return;
    const libFile = zertBibliothekDatei_(lib, b, srcs ? srcs[i] : null);
    zertVerknuepfung_(libFile.getId(), folder, fname);
  });
  return folder.getUrl();
}

/* ===================== Google Drive: Zertifikate finden ===================== */

/**
 * Liest ALLE Dateien in Zertifikate-Sync (inkl. Unterordner) einmal ein
 * und ordnet sie nach jedem 7-stelligen Fabrik-Code im Dateinamen.
 */
/**
 * Zertifikats-Index mit Zwischenspeicher (Drive-Datei), damit Bestellungen schnell bleiben.
 * Neu eingelesen wird nur, wenn der Sync neue/geänderte Dateien gemeldet hat, nach 24 h oder mit force=true.
 */
function buildFileIndex(force) {
  var props = PropertiesService.getScriptProperties();
  var desc = '';
  try { desc = DriveApp.getFoldersByName(CONFIG.SYNC_FOLDER_NAME).next().getDescription() || ''; } catch (e) {}
  var stats = desc.split('|')[1] || '';
  var fid = props.getProperty('ZERT_INDEX_FILE');
  if (!force && fid) {
    try {
      var c = JSON.parse(DriveApp.getFileById(fid).getBlob().getDataAsString());
      var frisch = Date.now() - c.t < 24 * 3600 * 1000 && (c.desc === desc || /neu 0, aktualisiert 0/.test(stats));
      if (frisch) return indexAusCache_(c.idx);
    } catch (e) { Logger.log('Index-Cache: ' + e.message); }
  }
  var live = buildFileIndexLive_();
  var idx = {};
  Object.keys(live).forEach(function (code) {
    if (code === '__stats') return;
    idx[code] = live[code].map(function (e) { return { id: e.id || e.file.getId(), name: e.name, type: e.type, lang: e.lang, t: 0 }; });
  });
  var json = JSON.stringify({ t: Date.now(), desc: desc, idx: idx });
  try {
    if (fid) DriveApp.getFileById(fid).setContent(json);
    else props.setProperty('ZERT_INDEX_FILE', DriveApp.createFile('Zertifikate-Index (automatisch, nicht löschen).json', json, 'application/json').getId());
  } catch (e) {
    try { props.setProperty('ZERT_INDEX_FILE', DriveApp.createFile('Zertifikate-Index (automatisch, nicht löschen).json', json, 'application/json').getId()); } catch (e2) { Logger.log('Index speichern: ' + e2.message); }
  }
  return live;
}

function indexAusCache_(idx) {
  var out = {};
  Object.keys(idx).forEach(function (code) {
    out[code] = idx[code].map(function (o) {
      var x = { id: o.id, name: o.name, type: o.type, lang: o.lang, t: o.t };
      Object.defineProperty(x, 'file', { get: function () { return this._f || (this._f = DriveApp.getFileById(this.id)); } });
      return x;
    });
  });
  out.__stats = { cached: true };
  return out;
}

function zertT_(e) { return e.t != null ? e.t : e.file.getLastUpdated().getTime(); }

function buildFileIndexLive_() {
  const it = DriveApp.getFoldersByName(CONFIG.SYNC_FOLDER_NAME);
  if (!it.hasNext()) throw new Error('Ordner nicht gefunden: ' + CONFIG.SYNC_FOLDER_NAME);
  const index = {};
  const stats = { folders: 0, files: 0, withCode: 0, samples: [] };

  const seenNames = {};
  function walk(folder, inherited) {
    stats.folders++;
    const lang = langFromText(folder.getName(), true) || inherited;
    const files = folder.getFiles();
    while (files.hasNext()) {
      const file = files.next();
      const name = file.getName();
      stats.files++;
      if (stats.samples.length < 8) stats.samples.push(name);
      const codes = name.match(/(?<!\d)\d{7}(?!\d)/g);
      if (!codes) continue;
      const dk = name + '|' + (lang || langFromText(name, false) || 'EN');
      if (seenNames[dk]) continue;
      seenNames[dk] = true;
      stats.withCode++;
      const isSc = file.getMimeType() === 'application/vnd.google-apps.shortcut';
      const entry = { name, type: typeFromName(name), lang: lang || langFromText(name, false) || 'EN', id: isSc ? file.getTargetId() : file.getId() };
      if (isSc) Object.defineProperty(entry, 'file', { get: function () { return this._f || (this._f = DriveApp.getFileById(this.id)); } }); else entry.file = file;
      new Set(codes).forEach(c => (index[c] = index[c] || []).push(entry));
    }
    const subs = folder.getFolders();
    while (subs.hasNext()) walk(subs.next(), lang);
  }
  walk(it.next(), '');

  index.__stats = stats;
  return index;
}

/**
 * Alle Zertifikate zu einem Fabrik-Code; pro Typ+Sprache die neueste Datei.
 * 1) Zertifikate-Sync  2) falls dort nichts: ganz Google Drive (z.B. Ordner des Werks "IFRA -2026 …", gr/en)
 */
function findCertFiles(code, index) {
  code = String(code).trim();
  if (!/^\d{7}$/.test(code)) return [];
  let list = index[code] || [];
  if (!list.length) list = searchDriveForCode(code);
  const best = {};
  list.forEach(e => {
    const key = e.type + '|' + e.lang;
    if (!best[key] || zertT_(e) > zertT_(best[key])) best[key] = e;
  });
  return Object.values(best);
}

const _driveCache = {};
function searchDriveForCode(code) {
  if (_driveCache[code]) return _driveCache[code];
  const re = new RegExp('(^|\\D)' + code + '(\\D|$)');
  const out = [];
  const it = DriveApp.searchFiles(`title contains '${code}' and trashed = false and mimeType = 'application/pdf'`);
  while (it.hasNext() && out.length < 20) {
    const file = it.next();
    const name = file.getName();
    if (!re.test(name)) continue;
    let lang = '';
    const parents = file.getParents();
    if (parents.hasNext()) lang = langFromText(parents.next().getName(), true);
    out.push({ file, name, type: typeFromName(name), lang: lang || langFromText(name, false) || 'EN' });
  }
  _driveCache[code] = out;
  return out;
}

function typeFromName(name) {
  const n = name.toUpperCase();
  if (n.includes('IFRA')) return 'IFRA';
  if (/(^|[^A-Z])(M?SDS|SDB)([^A-Z]|$)/.test(n) || n.includes('SICHERHEITSDATENBLATT') || n.includes('SAFETY')) return 'SDS';
  return 'Zertifikat';
}

function langFromText(text, isFolder) {
  const t = String(text).toLowerCase().trim();
  if (isFolder) {
    if (['gr', 'de', 'ger', 'deutsch', 'german'].includes(t)) return 'DE';
    if (['en', 'eng', 'english', 'englisch'].includes(t)) return 'EN';
    return '';
  }
  if (/(^|[_\-\s.(])(de|ger|gr|deutsch|german)([_\-\s.)]|$)/.test(t)) return 'DE';
  if (/(^|[_\-\s.(])(en|eng|english|englisch)([_\-\s.)]|$)/.test(t)) return 'EN';
  return '';
}

/* ===================== Code-Tabelle ===================== */

function openCodesSpreadsheet() {
  const src = CONFIG.CODES_SHEET_ID.trim();
  if (src) return src.includes('docs.google.com') ? SpreadsheetApp.openByUrl(src) : SpreadsheetApp.openById(src);
  const it = DriveApp.searchFiles(`title = '${CONFIG.CODES_SHEET_TITLE}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`);
  if (!it.hasNext()) throw new Error('Google-Tabelle nicht gefunden: ' + CONFIG.CODES_SHEET_TITLE);
  return SpreadsheetApp.open(it.next());
}

/** Das Blatt mit den Codes (das mit den meisten 7-stelligen Fabrik-Codes). */
function getCodesSheet(ss) {
  if (CONFIG.CODES_SHEET_NAME) {
    const sheet = ss.getSheetByName(CONFIG.CODES_SHEET_NAME);
    if (!sheet) throw new Error('Blatt nicht gefunden: ' + CONFIG.CODES_SHEET_NAME);
    return sheet;
  }
  const cFac = CONFIG.COL_FACTORY_CODE.toUpperCase().charCodeAt(0) - 65;
  let best = null, bestCount = 0;
  ss.getSheets().filter(sh => !['SKU-Prüfung', 'Neue Duftöle'].includes(sh.getName())).forEach(sh => {
    const count = sh.getDataRange().getValues().filter(r => /^\d{7}$/.test(String(r[cFac] || '').trim())).length;
    if (count > bestCount) { bestCount = count; best = sh; }
  });
  if (!best) throw new Error('Keine Fabrik-Codes in Spalte ' + CONFIG.COL_FACTORY_CODE + ' gefunden.');
  return best;
}

function loadCodeMap() {
  const ss = openCodesSpreadsheet();
  const colIdx = letter => letter.toUpperCase().charCodeAt(0) - 65;
  const cName = colIdx(CONFIG.COL_PRODUCT_NAME);
  const cShop = colIdx(CONFIG.COL_SHOP_CODE);
  const cFac = colIdx(CONFIG.COL_FACTORY_CODE);

  const rows = getCodesSheet(ss).getDataRange().getValues();

  const map = {};
  const canonMap = {};
  rows.forEach(r => { // Kopfzeilen passen zu keiner SKU und stören nicht
    if (r.length <= Math.max(cName, cShop, cFac)) return;
    const shop = String(r[cShop]).trim();
    const factory = String(r[cFac]).trim();
    if (!shop || !isOilSku(normalize(shop))) return;          // nur Duftöl-Codes (mit -SH)
    if (factory && !/^\d{7}$/.test(factory)) return;        // Fabrik-Code darf leer sein
    const entry = { shop, factory, name: String(r[cName]).trim() };
    map[normalize(shop)] = entry;
    const c = canonCode(shop);
    if (c && !canonMap[c]) canonMap[c] = entry;
  });
  Object.defineProperty(map, '__canon', { value: canonMap, enumerable: false });
  return map;
}

/**
 * Vergleichbarer Kern eines Codes, unabhängig von der Position von "PQ" und von Zusätzen hinter "SH":
 *   AM-GUI-D-16-PQ-SH        → AM-GUI-D-16|PQ
 *   XJ-NAX-U-16-SH-PQ-AAB    → XJ-NAX-U-16|PQ
 *   JP-NIG-H-02-SH-AAB       → JP-NIG-H-02
 */
function canonCode(code) {
  const segs = normalize(code).split('-').filter(Boolean);
  const i = segs.indexOf('SH');
  if (i < 1) return null;
  const before = segs.slice(0, i);
  const pq = segs.includes('PQ');
  return before.filter(x => x !== 'PQ').join('-') + (pq ? '|PQ' : '');
}

/* ===================== Shopify API ===================== */

function fetchOrders(query, first) {
  const data = shopifyGraphQL(`
    query($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT) {
        nodes {
          id name email tags
          billingAddress { firstName lastName company }
          lineItems(first: 250) { nodes { sku title variantTitle } }
        }
      }
    }`, { q: query, first: first });
  return data.orders.nodes;
}

function addTag(id, tag) {
  const data = shopifyGraphQL(`
    mutation($id: ID!, $tags: [String!]!) {
      tagsAdd(id: $id, tags: $tags) { userErrors { message } }
    }`, { id: id, tags: [tag] });
  const errs = data.tagsAdd.userErrors;
  if (errs.length) throw new Error('Tag konnte nicht gesetzt werden: ' + errs[0].message);
}

function shopifyGraphQL(query, variables) {
  const res = UrlFetchApp.fetch(`https://${CONFIG.SHOP}/admin/api/${CONFIG.API_VERSION}/graphql.json`, {
    method: 'post',
    contentType: 'application/json',
    headers: { 'X-Shopify-Access-Token': getAccessToken() },
    payload: JSON.stringify({ query, variables }),
    muteHttpExceptions: true,
  });
  const json = JSON.parse(res.getContentText());
  if (res.getResponseCode() >= 300 || json.errors) {
    throw new Error('Shopify-Fehler: ' + res.getContentText().slice(0, 500));
  }
  return json.data;
}

function getAccessToken() {
  const props = PropertiesService.getScriptProperties();
  const fixed = props.getProperty('SHOPIFY_ACCESS_TOKEN');
  if (fixed) return fixed;

  const cache = CacheService.getScriptCache();
  const cached = cache.get('shopify_token');
  if (cached) return cached;

  const res = UrlFetchApp.fetch(`https://${CONFIG.SHOP}/admin/oauth/access_token`, {
    method: 'post',
    payload: {
      grant_type: 'client_credentials',
      client_id: props.getProperty('SHOPIFY_CLIENT_ID'),
      client_secret: props.getProperty('SHOPIFY_CLIENT_SECRET'),
    },
    muteHttpExceptions: true,
  });
  if (res.getResponseCode() >= 300) throw new Error('Shopify-Anmeldung fehlgeschlagen: ' + res.getContentText());
  const json = JSON.parse(res.getContentText());
  const ttl = Math.min(Math.max((json.expires_in || 3600) - 300, 60), 21600);
  cache.put('shopify_token', json.access_token, ttl);
  return json.access_token;
}

/* ===================== Hilfsfunktionen ===================== */

/** Duftöle haben ein "-SH" im Code (z.B. JP-NIG-H-02-SH-aab). */
function isOilSku(sku) {
  return /(^|-)SH(-|$)/.test(sku);
}

/** Findet den Tabellen-Eintrag; Zusätze wie "-AAB" am Ende werden schrittweise entfernt. */
function lookupSku(sku, map) {
  let s = sku;
  while (s) {
    if (map[s] && /(^|-)SH$/.test(s)) return map[s];   // nur Codes, die auf -SH enden
    const i = s.lastIndexOf('-');
    if (i < 0) break;
    s = s.slice(0, i);
  }
  const c = canonCode(sku);
  return (c && map.__canon && map.__canon[c]) || null;
}

function normalize(s) {
  return String(s || '').trim().toUpperCase();
}

function safeName(s) {
  return s.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim();
}

function getOrCreateFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

/** Sucht im Online-Shop nach Produkten, deren SKU oder Name einen Suchbegriff enthält – nur zur Kontrolle. */
function findInShop() {
  const terms = ['2787', 'GENETIC', 'LL-B22', 'BERGAMOTE', 'PM-HER', 'HEROD'];   // Suchbegriffe
  let products = 0, variants = 0, pages = 0;
  for (let page = 1; page <= 100; page++) {
    const res = UrlFetchApp.fetch(`https://${CONFIG.SHOP}/products.json?limit=250&page=${page}`, { muteHttpExceptions: true });
    const list = res.getResponseCode() < 300 ? (JSON.parse(res.getContentText()).products || []) : [];
    if (!list.length) break;
    pages++;
    list.forEach(p => {
      products++;
      (p.variants || []).forEach(v => {
        variants++;
        const hay = (String(v.sku || '') + ' ' + p.title).toUpperCase();
        if (terms.some(t => hay.includes(t))) Logger.log(`GEFUNDEN: "${p.title}" | Variante: ${v.title} | SKU: "${v.sku}"`);
      });
    });
  }
  Logger.log(`Seiten: ${pages} | Produkte: ${products} | Varianten: ${variants}`);
}

/* ===================== Preisliste ↔ Shop über den Namen zuordnen ===================== */

/**
 * Schritt 1: Für Preislisten-Artikel, deren Code im Shop nicht vorkommt, wird das Shop-Produkt
 * über den Duftnamen (+ Standard/Premium) gesucht. Ergebnis im Blatt "Zuordnung" zum Prüfen.
 */
function matchPriceListToShop() {
  const map = loadCodeMap();
  const shop = [];                       // {title, vtitle, sku, canon}
  const shopCanon = {};
  for (let page = 1; page <= 100; page++) {
    const res = UrlFetchApp.fetch(`https://${CONFIG.SHOP}/products.json?limit=250&page=${page}`, { muteHttpExceptions: true });
    const list = res.getResponseCode() < 300 ? (JSON.parse(res.getContentText()).products || []) : [];
    if (!list.length) break;
    list.forEach(p => (p.variants || []).forEach(v => {
      const c = canonCode(v.sku || '');
      if (!c) return;
      shopCanon[c] = true;
      shop.push({ title: p.title, vtitle: String(v.title || ''), sku: v.sku, canon: c });
    }));
  }

  const rows = [];
  const seen = {};
  PRICE_LIST.forEach(([code, qual, name, cert]) => {
    const c = canonCode(code) || canonCode(code + '-SH');
    if (!c || shopCanon[c] || seen[c]) return;
    seen[c] = true;
    const wantPremium = c.endsWith('|PQ');            // PQ-Version ja/nein – aus dem Code
    const target = normName(name);
    const cands = {};
    shop.forEach(v => {
      const n = normName(v.title);
      const score = n === target ? 1 : similarity(n, target);
      if (score < 0.8) return;
      const isPremium = v.canon.endsWith('|PQ');
      if (isPremium !== wantPremium) return;
      if (!cands[v.canon] || cands[v.canon].score < score) cands[v.canon] = { score, v };
    });
    const list = Object.values(cands).sort((a, b) => b.score - a.score);
    const tableEntry = lookupSku(code, map);
    const certUse = (cert && /^\d{7}$/.test(cert)) ? cert : (tableEntry ? tableEntry.factory : '');
    if (!list.length) {
      rows.push([false, code, name, certUse, '– nicht gefunden –', '', '']);
      return;
    }
    list.slice(0, 3).forEach((x, i) => {
      const [base, pq] = x.v.canon.split('|');
      const sure = i === 0 && list.length === 1 && x.score === 1;
      rows.push([sure, code, name, certUse, x.v.sku, base + (pq ? '-PQ-SH' : '-SH'),
                 `${x.v.title} (${x.v.vtitle})${x.score < 1 ? ' – Name ähnlich, bitte prüfen' : ''}`]);
    });
  });

  const ss = openCodesSpreadsheet();
  const sh = ss.getSheetByName('Zuordnung') || ss.insertSheet('Zuordnung');
  sh.clear();
  sh.getDataRange().clearDataValidations();
  sh.getRange(1, 1, 1, 8).setValues([['Übernehmen?', 'Code Preisliste', 'Duftname', 'Zert.-Code',
    'SKU im Shop (Beispiel)', 'Code für Tabelle', 'Produkt im Shop', 'Erledigt']]).setFontWeight('bold');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 1).insertCheckboxes();
    sh.getRange(2, 1, rows.length, 7).setValues(rows);
  }
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 8);
  Logger.log(`Zuordnungen: ${rows.length} Zeilen, davon sicher (angehakt): ${rows.filter(r => r[0]).length}. ` +
             'Blatt "Zuordnung" prüfen, dann applyMatches ausführen.');
}

/** Schritt 2: Angehakte Zeilen aus "Zuordnung" → Shop-Code mit Zert.-Code in die Tabelle (neu oder leeren Code füllen). */
function applyMatches() {
  const ss = openCodesSpreadsheet();
  const z = ss.getSheetByName('Zuordnung');
  if (!z) throw new Error('Blatt "Zuordnung" fehlt – bitte zuerst matchPriceListToShop ausführen.');
  const sh = getCodesSheet(ss);
  const col = l => l.toUpperCase().charCodeAt(0) - 64;
  const cName = col(CONFIG.COL_PRODUCT_NAME), cShop = col(CONFIG.COL_SHOP_CODE), cFac = col(CONFIG.COL_FACTORY_CODE);
  const values = sh.getDataRange().getValues();
  const rowByCanon = {};
  values.forEach((r, i) => { const c = canonCode(String(r[cShop - 1] || '')); if (c && !(c in rowByCanon)) rowByCanon[c] = i + 1; });

  const data = z.getDataRange().getValues();
  let added = 0, filled = 0, skipped = 0;
  for (let r = 1; r < data.length; r++) {
    const [tick, , name, cert, , shopCode, , done] = data[r];
    if (tick !== true || done || !shopCode) continue;
    const c = canonCode(shopCode);
    const row = rowByCanon[c];
    let msg;
    if (row) {
      const current = String(values[row - 1][cFac - 1] || '').trim();
      if (!current && cert) { sh.getRange(row, cFac).setValue(cert); filled++; msg = '✔ Zert.-Code eingetragen'; }
      else { skipped++; msg = current ? '– schon mit Code ' + current : '– ohne Zert.-Code, nichts zu tun'; }
    } else {
      const nr = sh.getLastRow() + 1;
      sh.getRange(nr, cName).setValue(name);
      sh.getRange(nr, cShop).setValue(shopCode);
      if (cert) sh.getRange(nr, cFac).setValue(String(cert));
      rowByCanon[c] = nr;
      added++; msg = '✔ hinzugefügt';
    }
    z.getRange(r + 1, 8).setValue(msg);
  }
  Logger.log(`Neu in Tabelle: ${added} | Zert.-Code ergänzt: ${filled} | übersprungen: ${skipped}`);
}

function normName(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/^fhg\s+/, '').replace(/\(.*?\)|\|.*$/g, '').replace(/[^a-z0-9]/g, '');
}

function similarity(a, b) {
  if (!a || !b) return 0;
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 0;
  const d = Array.from({ length: m + 1 }, (_, i) => [i]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return 1 - d[m][n] / Math.max(m, n);
}

/* ===================== B2B-Preisliste 09/2026 (aus PDF) ===================== */

/**
 * Trägt die Zertifikat-Codes (Zert.) aus der Preisliste in die Code-Tabelle ein:
 * leere Fabrik-Codes werden gefüllt, fehlende Produkte mit Zert.-Code werden ergänzt,
 * vorhandene abweichende Codes werden NICHT überschrieben, sondern gemeldet.
 * Zusätzlich: Vergleich Preisliste ↔ Online-Shop im Blatt "Preisliste-Vergleich".
 */
function applyPriceList() {
  const ss = openCodesSpreadsheet();
  const sh = getCodesSheet(ss);
  const col = l => l.toUpperCase().charCodeAt(0) - 64;
  const cName = col(CONFIG.COL_PRODUCT_NAME), cShop = col(CONFIG.COL_SHOP_CODE), cFac = col(CONFIG.COL_FACTORY_CODE);
  const values = sh.getDataRange().getValues();

  const rowByCanon = {};
  values.forEach((r, i) => {
    const c = canonCode(String(r[cShop - 1] || ''));
    if (c && !(c in rowByCanon)) rowByCanon[c] = i + 1;
  });

  const report = [];
  let filled = 0, same = 0, added = 0;
  PRICE_LIST.forEach(([code, qual, name, cert]) => {
    if (!cert) return;
    if (!/^\d{7}$/.test(cert)) { report.push(['✗ Zert.-Code ungültig (nicht 7-stellig)', code, name, cert]); return; }
    const c = canonCode(code) || canonCode(code + '-SH');
    const row = rowByCanon[c];
    if (row) {
      const current = String(values[row - 1][cFac - 1] || '').trim();
      if (!current) { sh.getRange(row, cFac).setValue(cert); filled++; }
      else if (current === cert) same++;
      else report.push(['⚠️ Abweichung – Tabelle nicht geändert', code, name, `Tabelle: ${current} | Preisliste: ${cert}`]);
    } else {
      const [base, pq] = c.split('|');
      const newRow = sh.getLastRow() + 1;
      sh.getRange(newRow, cName).setValue(name);
      sh.getRange(newRow, cShop).setValue(base + (pq ? '-PQ-SH' : '-SH'));
      sh.getRange(newRow, cFac).setValue(cert);
      rowByCanon[c] = newRow;
      added++;
    }
  });

  // Vergleich mit dem Online-Shop
  const shopSet = {};
  for (let page = 1; page <= 100; page++) {
    const res = UrlFetchApp.fetch(`https://${CONFIG.SHOP}/products.json?limit=250&page=${page}`, { muteHttpExceptions: true });
    const products = res.getResponseCode() < 300 ? (JSON.parse(res.getContentText()).products || []) : [];
    if (!products.length) break;
    products.forEach(p => (p.variants || []).forEach(v => {
      const c = canonCode(v.sku || '');
      if (c && !shopSet[c]) shopSet[c] = p.title;
    }));
  }
  const pdfSet = {};
  PRICE_LIST.forEach(([code, qual, name]) => { const c = canonCode(code) || canonCode(code + '-SH'); if (c) pdfSet[c] = [code, name]; });
  Object.keys(pdfSet).forEach(c => { if (!shopSet[c]) report.push(['📄 In Preisliste, nicht im Online-Shop', pdfSet[c][0], pdfSet[c][1], '']); });

  const out = ss.getSheetByName('Preisliste-Vergleich') || ss.insertSheet('Preisliste-Vergleich');
  out.clear();
  out.getRange(1, 1, 1, 4).setValues([['Hinweis', 'Code', 'Produkt', 'Details']]).setFontWeight('bold');
  if (report.length) out.getRange(2, 1, report.length, 4).setValues(report);
  out.setFrozenRows(1);
  out.autoResizeColumns(1, 4);

  Logger.log(`Zert.-Codes eingetragen (vorher leer): ${filled}`);
  Logger.log(`Neue Produkte mit Zert.-Code ergänzt: ${added}`);
  Logger.log(`Schon richtig: ${same}`);
  Logger.log(`Hinweise (Abweichungen, ungültige Codes, nicht im Shop): ${report.length} → Blatt "Preisliste-Vergleich"`);
}

/** [Artikel-Code, Qualität, Duftname, Zert.-Code] – aus B2B_Preisliste_Duftoele_09_2026.pdf */
const PRICE_LIST = [["AR-ADG-H-02-SH","Standard","Acqua di Gio","1020052"],["AR-ADG-H-02-PQ-SH","Premium","Acqua di Gio","1010044"],["AR-PRO-H-03-SH","Standard","Acqua Di Gio Profondo",""],["AR-STY-H-05-SH","Standard","Stronger with you",""],["AR-STY-H-05-PQ-SH","Premium","Stronger with you","1060168"],["AR-IST-H-06-SH","Standard","intensely Stronger with you",""],["AR-COD-H-08-SH","Standard","Code",""],["AR-OUD-H-09-SH","Standard","Oud Royal Prive",""],["AR-DIA-H-10-SH","Standard","Diamonds",""],["AR-AMB-U-11-SH","Standard","Ambre Eccentrico",""],["AR-ADG-D-12-SH","Standard","Acqua Di Gio women",""],["AR-OCG-D-13-SH","Standard","Ocean Di Gio","2020057"],["AR-COD-D-14-SH","Standard","Code",""],["AR-DIA-D-15-SH","Standard","Diamonds",""],["AR-BIY-D-16-SH","Standard","Because It's You","2020058"],["AR-SI-D-17-SH","Standard","Si",""],["AR-SIP-D-18-SH","Standard","Si Passione","2020182"],["AR-SII-D-19-SH","Standard","Si Intense",""],["AR-MYW-D-20-SH","Standard","My Way",""],["AR-STY-H-21-PQ-SH","Exklusiv","Stronger With You Absolutely",""],["ATC-OS-003-SH","Premium","Orange Sanguine","3020105"],["LL-B22-002-SH","Premium","Bergamote 22","3050153"],["GR-MAO-U-01-SH","Exklusiv","Mango Aoud Gritti","3010014"],["2787-GB-001-SH","Exklusiv","Genetic Bliss","3010099"],["XJ-ACC-U-01-SH","Premium","Accento",""],["XJ-ERB-U-03-SH","Standard","Erba pura","3010016"],["XJ-ERB-U-03-PQ-SH","Exklusiv","Erba pura","3010218"],["XJ-EGO-U-04-SH","Premium","Erba Gold",""],["XJ-APO-U-05-SH","Premium","APOLLONIA",""],["XJ-OPE-U-06-SH","Premium","Opera",""],["SO-AFG-U-07-SH","Standard","Afgano Puro",""],["SO-VIB-U-08-SH","Premium","Vibrato Sospiro","3010034"],["XJ-AL2-U-09-SH","Standard","Alexandria // 2",""],["XJ-AL2-U-10-PQ-SH","Premium","Alexandria // 2",""],["XJ-AL3-U-11-SH","Premium","Alexandria /// 3",""],["XJ-OUV-U-12-SH","Premium","Ouverture",""],["XJ-40K-U-13-SH","Premium","40 Knots","3010203"],["XJ-OES-U-14-SH","Premium","Shooting Stars Oesel",""],["XJ-NAX-U-16-SH","Standard","Naxos",""],["XJ-NAX-U-16-PQ-SH","Exklusiv","Naxos",""],["XJ-PAC-U-17-SH","Premium","Purple Accento","3010217"],["XJ-MTW-U-18-SH","Premium","JOIN THE CLUB MORE THAN WORDS",""],["XJ-AOV-U-19-SH","Premium","Accento Overdose",""],["XJ-SOP-U-20-SH","Premium","Soprano",""],["XJ-TMS-U-21-SH","Premium","Toni lommi Monkey Special",""],["XJ-T21-U-22-PQ-SH","Premium","Torino 21",""],["XJ-WAR-U-23-PQ-SH","Premium","Wardasina",""],["XJ-LAC-U-24-PQ-SH","Premium","LA CAPITALE",""],["XJ-ITA-U-25-SH","Premium","Casamorati - Italica",""],["XJ-T23-U-26-SH","Premium","Torino 23",""],["XJ-T22-U-27-PQ-SH","Premium","Torino 22",""],["XJ-CDS-U-28-SH","Premium","Cruz del Sur",""],["XJ-LIR-D-29-SH","Standard","Lira",""],["XJ-GRB-D-30-SH","Premium","Casamorati Gran Ballo",""],["XJ-TOS-D-31-SH","Premium","La Tosca",""],["XJ-DAB-D-32-SH","Premium","Casamorati - Dama Bianca",""],["XJ-WOW-U-33-SH","Premium","White on White",""],["XJ-GOD-U-34-PQ-SH","Premium","Golden Dallah",""],["XJ-REN-U-1861-35-SH","Premium","Renaissance - XJ 1861",""],["XJ-RWD-U-36-PQ-SH","Exklusiv","Richwood",""],["CA-1888-U-37-SH","Premium","Casamorati - 1888",""],["XA-T24-U-38-PQ-SH","Premium","Torino 24",""],["XE-COR-U-39-PQ-SH","Exklusiv","Coro",""],["XE-QUP-D-40-SH","Premium","Casamorati - Quattro Pizzi","3010233"],["XE-MUS-D-41-PQ-SH","Premium","Muse",""],["XJ-BQT-42-PQ-SH","Premium","Bouquet Ideale",""],["SO-IPD-U-43-SH","Premium","Il Padrino Sospiro","3010011"],["XJ-STR-44-SH","Premium","Starlight","3020111"],["XJ-BLM-46-SH","Premium","Black Moonlight","3020109"],["XJ-NIO-48-SH","Exklusiv","Nio","1050143"],["XJ-ZEF-49-SH","Premium","Zefiro 1861","3050157"],["XJ-MML-50-SH","Exklusiv","Mamluk","3050158"],["XD-BA-U-01-PQ-SH","Exklusiv","Blonde Amber",""],["CC-NO1-U-02-PQ-SH","Premium","NO 1",""],["CC-JKE-U-03-SH","Premium","Jump Up and Kiss Me Hedonistic",""],["CC-XFM-H-04-SH","Premium","X for Men",""],["CC-1872-H-05-SH","Premium","1872 for Men",""],["CC-MAT-U-06-SH","Premium","Matsukita",""],["MC-OMA-U-01-PQ-SH","Exklusiv","Oud Maracujá",""],["MC-HIB-U-02-PQ-SH","Exklusiv","Hibiscus Mahajád",""],["SH-GOF-U-01-SH","Exklusiv","God of Fire",""],["SHL-VEI-U-02-SH","Exklusiv","Venom Incarnat",""],["BN-NYN-U-01-SH","Premium","NY Nights",""],["BN-DUA-U-02-SH","Exklusiv","Amber Dubai",""],["DSD-DBR-D-01-SH","Premium","Debaser DS&Durga;",""],["SD-TUR-U-01-SH","Exklusiv","Dubai - Turath","3010219"],["SOD-MEY-03-SH","Exklusiv","Meydan","3050152"],["LV-OMB-U-02-SH","Standard","Ombre Nomade",""],["LV-OMB-U-02-PQ-SH","Premium","Ombre Nomade",""],["LV-AFS-U-03-SH","Standard","Afternoon Swim",""],["LV-CAC-U-04-SH","Standard","Cactus Garden",""],["LV-IMA-U-06-SH","Standard","Imagination","1010220"],["LV-IMA-U-06-PQ-SH","Premium","Imagination","1010027"],["LV-MET-U-07-SH","Premium","Météore",""],["LV-NDF-U-08-SH","Premium","Nuit de Feu",""],["LV-CAD-U-09-SH","Premium","California Dream",""],["LV-COS-U-10-SH","Premium","City Of Stars",""],["LV-IMM-U-11-SH","Standard","L'Immensité",""],["LV-TUR-U-14-PQ-SH","Premium","Turbulences",""],["LV-PAC-U-15-SH","Premium","Pacific Chill",""],["LV-FDD-U-16-SH","Exklusiv","Fleur de Desert",""],["LV-RDV-U-17-SH","Premium","Rose des Vents",""],["LV-SOY-D-18-SH","Standard","Spell On You",""],["LV-CMO-D-19-SH","Premium","Contre Moi",""],["LV-APO-D-20-SH","Premium","Apogée",""],["LV-ATR-D-21-SH","Premium","Attrape-Rêves",""],["LV-OTB-U-22-PQ-SH","Premium","On the Beach",""],["LV-HDA-D-23-SH","Premium","Heures d'Absence",""],["LV-CBT-U-24-PQ-SH","Premium","Cœur Battant",""],["LV-LOV-U-25-PQ-SH","Exklusiv","LV Lovers",""],["LV-NM-U-26-SH","Premium","Nouveau Monde",""],["LV-ORA-27-SH","Premium","Oraga","1050147"],["LEP-AMB-001-SH","Exklusiv","Ambre Supermassive","3050148"],["MM-JC-001-SH","Premium","Jazz Club","1050150"],["MM-SD-002-SH","Premium","Sailing Day","3050160"],["PM-HER-H-23-SH","Premium","Herod",""],["PM-PEG-H-02-SH","Standard","Pegasus",""],["PM-HAL-H-03-SH","Premium","Haltane",""],["PM-LAY-H-04-SH","Standard","Layton",""],["PM-LAY-H-05-PQ-SH","Exklusiv","Layton (Premium Qualität)",""],["PM-KAL-H-06-SH","Premium","Kalan",""],["PM-GAL-H-07-SH","Premium","Galloway",""],["PM-OAJ-H-08-SH","Premium","Oajan",""],["PM-SHG-H-09-SH","Premium","Shagya",""],["PM-ALT-H-10-SH","Premium","Althaïr","1010017"],["PM-GOD-H-11-SH","Premium","Godolphin",""],["PM-PER-H-12-SH","Premium","Percival",""],["PM-SAF-D-13-SH","Premium","Safanad",""],["PM-DEL-D-14-SH","Premium","Delina","2050121"],["PM-VAL-D-15-SH","Premium","Valaya",""],["PDM-PLT-U-16-SH","Premium","Palatine",""],["PDM-SDL-H-17-SH","Standard","Sedley",""],["PM-GRN-U-18-PQ-SH","Premium","Greenley",""],["PM-PER-M-19-PQ-SH","Exklusiv","Perseus",""],["PDM-DELEXC-20-PQ-SH","Premium","Delina Exclusif",""],["PDM-DELLR-21-PQ-SH","Premium","Delina La Rosée",""],["PDM-CASI-22-PQ-SH","Premium","Cassili",""],["PM-CAS-U-23-SH","Premium","Castley","1010007"],["PDM-ORI-24-SH","Premium","Oriana","2020079"],["TF-BLO-U-02-SH","Standard","Black Orchid",""],["TF-BLO-U-02-PQ-SH","Premium","Black Orchid",""],["TF-TOV-U-04-SH","Standard","Tobacco Vanille",""],["TF-TOV-U-04-PQ-SH","Premium","Tobacco Vanille",""],["TF-TOU-U-05-SH","Premium","Tobacco Oud",""],["TF-VAF-U-06-SH","Premium","Vanille Fatale",""],["TF-NOI-U-07-SH","Standard","Noir",""],["TF-NEX-U-09-SH","Standard","Noir Extreme",""],["TF-NEX-U-09-PQ-SH","Premium","Noir Extreme","1010021"],["TF-MYM-U-10-SH","Exklusiv","Myrrhe Mystère",""],["TF-PAT-U-11-SH","Standard","Patchouli Absolu",""],["TF-CAP-U-12-SH","Standard","Costa Azzurra Parfum",""],["TF-EBE-U-13-SH","Premium","Ébène Fumé",""],["TF-OUM-U-14-SH","Premium","Oud Minérale",""],["TF-TUS-U-15-SH","Standard","Tuscan Leather",""],["TF-OUW-U-16-SH","Standard","Oud Wood","3050122"],["TF-OUW-U-16-PQ-SH","Premium","Oud Wood","3050123"],["TF-FFF-U-17-SH","Standard","Fucking Fabulous",""],["TF-CRO-U-18-SH","Standard","Café Rose",""],["TF-ROP-U-19-SH","Standard","Rose Prick",""],["TF-NER-U-20-SH","Standard","Neroli Portofino","3050124"],["TF-NER-U-20-PQ-SH","Exklusiv","Neroli Portofino","3050125"],["TF-OLP-U-21-SH","Premium","Ombre Leather Parfum",""],["TF-OLU-U-22-SH","Premium","Ombre Leather",""],["TF-SOL-U-23-SH","Standard","Soleil Blanc",""],["TF-BIT-U-24-SH","Standard","Bitter Peach",""],["TF-ELC-U-25-SH","Premium","Electric Cherry",""],["TF-MDA-U-26-SH","Standard","Mandarino Di Amalfi","3050126"],["TF-MDA-U-26-PQ-SH","Exklusiv","Mandarino Di Amalfi","3050127"],["TF-MET-U-27-SH","Premium","Metallique",""],["TF-CHS-U-28-PQ-SH","Premium","Cherry Smoke",""],["TF-VSX-U-29-SH","Premium","Vanille Sex",""],["TF-VEO-U-30-SH","Standard","Velvet Orchid",""],["TF-LOC-U-32-SH","Standard","Lost Cherry",""],["TF-LOC-U-32-PQ-SH","Exklusiv","Lost Cherry (Premium Qualität)","3010020"],["TF-VIB-U-33-SH","Standard","Violet Blonde",""],["HO-DAT-U-01-SH","Exklusiv","Dates Delight",""],["THO-KEG-U-02-PQ-SH","Exklusiv","Keep Glazed",""],["THO-ALM-U-03-SH","Premium","Almond Harmony","3010013"],["NC-PAI-U-02-PQ-SH","Premium","Patchouli Intense",""],["BD-GRI-U-01-SH","Premium","Gris Charnel","3010029"],["BDK-VT-U-02-SH","Premium","Velvet Tonka",""],["BDK-RSM-U-03-PQ-SH","Premium","Rouge Smoking",""],["BDK-TRO-U-04-PQ-SH","Premium","Tabac Rose","3010208"],["BDK-CDC-05-SH","Premium","Crème de Cuir","3060166"],["BDK-PCS-07-SH","Standard","Pas Ce Soir","2050155"],["MO-AOB-U-01-SH","Standard","Aoud Black",""],["MO-ROS-U-02-SH","Standard","Roses Musk",""],["MO-CAF-U-03-SH","Standard","Café Intense",""],["MO-ART-U-05-SH","Standard","Arabian Tonka",""],["MO-ART-U-05-PQ-SH","Premium","Arabien Tonka","3010221"],["MO-AON-U-06-SH","Premium","Aoud Night",""],["MO-INC-U-07-SH","Premium","Intense Cherry",""],["MO-HOA-U-08-SH","Premium","Honey Aoud",""],["MO-AOE-U-09-SH","Premium","Aoud Ever",""],["MO-SPA-U-10-SH","Premium","Spicy Aoud",""],["MO-STN-U-11-SH","Premium","Starry Night","3010032"],["MO-APR-U-12-SH","Premium","Aoud Purple Rose",""],["MO-SWP-U-13-SH","Premium","Sweet Peony",""],["MO-DAP-U-14-SH","Premium","Dark Purple",""],["MO-PUG-U-15-SH","Premium","Pure Gold",""],["MO-SWV-U-16-SH","Premium","Sweet Vanille","3010033"],["MO-MUK-U-17-SH","Premium","Mukhallat",""],["MO-WOS-U-18-SH","Standard","Wood Spices",""],["MO-CRA-U-19-SH","Premium","Crazy In Love",""],["MO-AOF-U-20-SH","Premium","Aoud Flowers Collection",""],["MO-WHO-U-21-SH","Premium","White Oud",""],["MO-OUP-U-22-SH","Premium","Oud Pashmina",""],["MO-INF-U-23-SH","Premium","Infinity",""],["MO-AMB-U-24-SH","Premium","Amber Musk",""],["MO-MAZ-U-25-SH","Premium","Oud Mazing",""],["MO-VAC-U-26-SH","Premium","Vanilla Cake","3010103"],["MO-VLA-U-27-SH","Premium","Vanille Absolu","2010204"],["MO-SEI-U-28-SH","Premium","Sensual Instinct",""],["MO-DAV-U-29-SH","Premium","Dark Vanilla",""],["MO-ARM-U-30-PQ-SH","Premium","Arabians Musk","3010234"],["LI-BLA-U-01-SH","Exklusiv","Blanche Bête",""],["LI-LIQ-U-02-SH","Premium","Liquide ( 2022 )",""],["MF-BAC-U-02-SH","Standard","Baccarat Rouge 540",""],["MF-BAC-U-02-PQ-SH","Premium","Baccarat Rouge 540",""],["MF-AQU-U-03-SH","Standard","Aqua Universalis","3020183"],["MF-HOM-U-04-SH","Standard","L’Homme À la Rose",""],["MF-724-U-05-SH","Premium","MFK 724",""],["MF-GRS-U-06-SH","Premium","Grand Soir",""],["MF-BAX-U-07-SH","Premium","Baccarat Rouge 540 Extrait de Parfum",""],["MF-OSM-U-08-SH","Premium","Oud Satin Mood",""],["MF-GFG-U-09-SH","Standard","Gentle Fluidity (Gold)",""],["MF-KKY-U-10-PQ-SH","Premium","Kurky",""],["MF-AMF-U-11-SH","Standard","Amyris Femme",""],["MF-OSM-U-08-PQ-SH","Exklusiv","Oud Silk Mood",""],["DI-HOI-H-02-SH","Standard","Homme Intense",""],["DI-HOI-H-02-PQ-SH","Premium","Homme Intense","1010045"],["DI-HOS-H-03-SH","Standard","Homme Sport Intense",""],["DI-HOM-H-04-PQ-SH","Premium","Homme",""],["DI-SAU-H-06-SH","Standard","Sauvage",""],["DI-SAU-H-06-PQ-SH","Premium","Sauvage",""],["DI-SAE-H-07-SH","Standard","Sauvage Elixir",""],["DI-FEV-U-08-SH","Standard","Feve Delicieuse",""],["CD-GRI-U-09-SH","Premium","Gris",""],["CD-BOI-U-10-SH","Premium","Bois d'Argent",""],["CD-VAD-U-11-SH","Premium","Vanilla Diorama",""],["CD-AMB-U-12-SH","Premium","Ambre Nuit",""],["CD-OUR-U-13-SH","Premium","Oud Rosewood","302007"],["DI-FAH-H-15-SH","Standard","Fahrenheit",""],["DI-FAH-H-15-PQ-SH","Premium","Fahrenheit",""],["DI-FA3-H-16-SH","Standard","Fahrenheit 32",""],["DI-ADD-D-17-SH","Standard","Addict",""],["DI-POI-D-18-SH","Standard","Poison",""],["DI-JAD-D-19-SH","Standard","J'adore",""],["DI-JIJ-D-20-SH","Standard","J'adore in Joy",""],["DI-MDC-D-21-SH","Standard","Miss Dior Cherie",""],["DI-MDR-D-22-SH","Standard","Miss Dior",""],["DI-MDR-D-23-SH","Premium","Miss Dior Rose N'Roses",""],["DI-HYP-D-25-SH","Standard","Hypnotic",""],["DI-HYP-D-25-SH","Premium","Hypnotic",""],["DI-ROU-D-26-SH","Standard","Rouge Trafalgar",""],["DI-MDB-D-27-PQ-SH","Premium","Miss Dior Blooming Bouquet",""],["DI-SEF-H-28-PQ-SH","Premium","Sauvage Eau Forte",""],["DI-HOM-COL-29-SH","Premium","Dior Homme Cologne",""],["DI-JADLOR-D-30-PQ-SH","Premium","L'Or de J'adore",""],["CL-LOU-U-01-SH","Premium","Loubiprince",""],["AC-KHA-U-01-SH","Premium","Khaltat Night",""],["MGB-OF-001-SH","Premium","Orange Flamingo","3010093"],["DP-ORP-U-01-SH","Premium","Orphéon Diptyque",""],["PR-ADS-U-01-SH","Standard","Aqua Di Sale",""],["PR-AEZ-U-02-SH","Standard","Acqua e Zucchero","3010102"],["PR-CON-U-03-SH","Premium","Confetto",""],["PR-VNT-U-04-SH","Premium","Vanitas","2010012"],["PR-INI-H-01-SH","Standard","Invictus Intense","1020185"],["PR-INA-H-02-SH","Standard","Invictus Aqua","1020184"],["PR-INV-H-03-SH","Standard","Invictus","1020068"],["PR-PXS-H-04-SH","Standard","Pure XS",""],["PR-BXS-H-05-SH","Standard","Black XS",""],["PR-PHA-H-06-SH","Standard","Phantom","1020187"],["PR-LIX-H-07-SH","Standard","Lixeses XS",""],["PR-OMI-H-09-SH","Standard","One Million",""],["PR-OMI-H-09-PQ-SH","Premium","One Million","1010048"],["PR-OMV-H-10-SH","Standard","One Million Privé","1020188"],["PR-OML-H-11-SH","Standard","One Million Lucky",""],["PR-OEL-H-12-SH","Standard","One Million Elixir",""],["PR-OMR-H-13-SH","Standard","One Million Royal",""],["PR-OGO-H-14-SH","Standard","One Million Golden Oud",""],["PR-OLY-D-15-SH","Standard","Olympea",""],["PR-OLB-D-16-SH","Standard","Olympea Blossom",""],["PR-BXW-D-17-SH","Standard","Black XS","1020186"],["PR-FAM-D-18-SH","Standard","Fame",""],["PR-LMI-D-19-SH","Standard","Lady Million",""],["PR-LML-D-20-SH","Standard","Lady Million Lucky",""],["PR-LMR-D-21-SH","Standard","Lady Million Royal",""],["LP-SUG-U-01-PQ-SH","Premium","Sun-Gria",""],["AM-REF-H-01-SH","Standard","Reflection Man","1030080"],["AM-REF-H-01-PQ-SH","Exklusiv","Reflection Man","1050138"],["AM-HON-H-02-SH","Premium","Honour Man","1020072"],["AM-OPX-U-03-SH","Premium","Opus XIV - Royal Tobacco",""],["AM-DIA-H-04-SH","Premium","Dia Man",""],["AM-POM-H-05-SH","Premium","Portrayal Man",""],["AM-GUI-U-06-SH","Premium","Guidance (Unisex)",""],["AM-INT-H-07-SH","Premium","Interlude Man",""],["AM-REF-D-08-SH","Standard","Reflection Women",""],["AM-DIW-D-09-SH","Standard","Dia Women",""],["AM-ITW-D-10-SH","Standard","Interlude Women",""],["AM-POW-D-11-SH","Standard","Portrayal Women",""],["AM-EPI-H-12-SH","Premium","Epic Man","1020189"],["AM-LVD-D-13-SH","Premium","Love Delight",""],["AM-BRA-H-14-PQ-SH","Exklusiv","Bracken Man",""],["AM-GOL-H-15-SH","Premium","Gold Man",""],["AM-GUI-D-16-PQ-SH","Exklusiv","Guidance 46","3010235"],["AMO-P50-17-SH","Exklusiv","Purpose 50","3030083"],["AMO-OUT-18-SH","Exklusiv","Outlands","3050149"],["AMO-IBI-20-SH","Exklusiv","Interlude Black Iris","3050154"],["AMO-OVM-21-SH","Exklusiv","Overture Man","1020106"],["AMO-BND-22-SH","Exklusiv","Boundless","3010094"],["KL-ANG-U-01-SH","Standard","Angels' Share",""],["KL-ANG-U-01-PQ-SH","Premium","Angels' Share","3010222"],["KL-SMK-U-02-SH","Premium","Smoking Hot",""],["KL-BTB-U-03-SH","Premium","Back To Black",""],["KL-PEO-U-04-SH","Premium","Pearl Oud",""],["KL-RIL-U-05-SH","Premium","Rolling in Love","3020190"],["KL-SAC-U-06-SH","Premium","Sacred Wood",""],["KL-MOU-U-07-SH","Premium","Musk Oud",""],["KL-APH-U-08-SH","Premium","Back to Black, Aphrodisiac",""],["KL-LDS-U-10-SH","Standard","Love Don't Be Shy",""],["KL-LDS-U-10-PQ-SH","Premium","Love Don't Be Shy","2010211"],["KL-LWT-U-11-SH","Premium","Love the way you Taste",""],["KL-WIG-U-12-SH","Premium","Woman in Gold",""],["KL-GGB-U-13-SH","Standard","Good Girl Gone Bad",""],["KIL-AS-ROCKS-14-SH","Premium","Angels' Share on the Rocks","3010009"],["KIL-BK-PM-15-SH","Premium","Black Phantom",""],["KIL-PRI-17-SH","Premium","I Don't Need a Prince by My Side to Be a Princess","3020107"],["KIL-INT-18-SH","Premium","Intoxicated","3030081"],["IN-SID-U-01-SH","Premium","Side Effect","3010210"],["IN-OFG-U-02-SH","Premium","Oud for Greatness",""],["IN-OFH-U-03-SH","Premium","Oud for Happiness",""],["IN-MUT-U-04-SH","Standard","Musk Therapy","3020073"],["IN-NDL-U-05-SH","Premium","Narcotic Delight","3010223"],["IN-RHB-U-06-SH","Premium","initio Rehab",""],["IN-BBR-U-07-PQ-SH","Exklusiv","Blessed Baraka",""],["IN-PLO-U-08-PQ-SH","Exklusiv","Psychedelic Love",""],["CR-SIL-U-02-SH","Standard","Silver",""],["CR-SIL-U-02-PQ-SH","Exklusiv","Silver",""],["CR-AVE-H-04-SH","Standard","Aventus",""],["CR-AVE-H-04-PQ-SH","Exklusiv","Aventus","1010019"],["CR-MIL-U-05-SH","Premium","Millésime Impérial",""],["CR-ORI-U-06-SH","Premium","Original Vétiver","3050115"],["CR-VIW-U-07-SH","Standard","Virgin Island Water",""],["CR-GRI-U-08-SH","Standard","Green Irish",""],["CR-VIK-H-09-SH","Premium","Viking",""],["CR-SUB-U-10-SH","Exklusiv","Sublime Vanille","3010224"],["CR-AVH-D-11-SH","Standard","Aventus for Her",""],["CR-ABS-U-12-PQ-SH","Exklusiv","Absolu Aventus","1010025"],["TT-KIR-U-01-SH","Standard","Kirke","3050128"],["TT-KIR-U-01-PQ-SH","Premium","Kirke","3010036"],["TT-DEL-U-02-SH","Standard","Delox","3020191"],["TT-VEL-U-03-SH","Premium","Velorum",""],["TT-GUM-U-04-SH","Premium","Gumin Extrait",""],["TT-CAS-U-05-SH","Premium","Casanova Extrait","3010035"],["TT-SIR-U-06-SH","Premium","Sirrah Extrait","3010037"],["TT-HAL-U-07-SH","Premium","Halley Extrait",""],["TT-ORZ-U-08-SH","Standard","Orza",""],["TT-ATL-U-09-PQ-SH","Premium","Atlantide",""],["TT-TEL-U-10-PQ-SH","Premium","Telea",""],["TT-ROS-U-11-SH","Premium","Rosso Pompei",""],["TT-ORI-U-12-SH","Premium","Orion",""],["TT-AND-U-13-SH","Premium","Andromeda",""],["TT-CAS-U-14-SH","Premium","Cassiopea",""],["TT-DRC-15-SH","Exklusiv","Draco","3010096"],["JP-LEM-H-01-SH","Standard","Le Male","1020192"],["JP-JP2-U-02-SH","Standard","JPG 2",""],["JP-SCM-H-03-SH","Standard","Scandal Man","1020193"],["JP-LME-H-04-SH","Standard","Le Male Elixir","1020194"],["JP-ULM-H-05-SH","Premium","Ultra Male","1010212"],["JP-LBM-H-06-SH","Standard","Le Beau Male",""],["JP-SCW-D-07-SH","Standard","Scandal Women",""],["JP-CLA-D-08-SH","Standard","Classique",""],["JP-SLP-D-09-SH","Standard","Scandal Le Parfum Intense","2020055"],["JP-GAU-D-10-SH","Standard","Gaultier Divine","2020195"],["JP-SBN-D-11-SH","Standard","Scandal by Night",""],["JP-BEL-D-12-SH","Standard","LA Belle","2020196"],["JP-SAB-13-SH","Premium","Scandal Absolu",""],["JP-LEMEAB-14-SH","Premium","le male elixir absolu",""],["ZRK-MUS-001-SH","Premium","The Muse","2020104"],["MA-RET-U-01-SH","Standard","Red Tobacco","3010005"],["MA-MON-U-02-SH","Standard","Monsieur Casanova",""],["MA-AOV-U-03-SH","Premium","Aoud Vanille",""],["MA-BLA-U-04-SH","Premium","Black Vanilla",""],["MA-CED-U-05-SH","Premium","Cedrat Boise",""],["MA-TON-U-06-SH","Premium","Tonka Cola",""],["MA-INC-U-07-SH","Premium","Instant Crush",""],["MA-ROV-U-08-SH","Standard","Roses Vanille",""],["MA-COC-U-09-SH","Standard","Coco Vanille","2020074"],["MA-FRV-U-10-PQ-SH","Premium","French Riviera","3010225"],["VE-BLU-H-01-SH","Standard","Blue Jeans",""],["VE-DYL-H-02-SH","Standard","Dylan Blue","1020197"],["VE-ABS-H-03-SH","Standard","Absolu",""],["VE-ERO-H-04-SH","Standard","EROS","1010236"],["VE-ERF-H-05-SH","Premium","Eros Flame",""],["VE-BRC-D-06-SH","Premium","Bright Crystal","2010003"],["VE-RED-D-07-SH","Standard","Red Jeans",""],["VE-CRN-D-08-SH","Standard","Crystal Noir","2050117"],["VE-CRN-D-08-PQ-SH","Premium","Crystal Noir","2050116"],["VE-EPF-D-09-SH","Standard","Eros Pour Femme",""],["GU-GUI-H-01-SH","Standard","Guilty",""],["GU-INU-U-02-SH","Premium","Intense Oud","3050118"],["GU-BYG-H-03-SH","Standard","by Gucci",""],["GU-ENV-D-04-SH","Standard","Envy Me",""],["GU-BLO-D-05-SH","Standard","Bloom",""],["GU-BAM-D-06-SH","Standard","Bamboo",""],["GU-RU2-D-07-SH","Standard","Rush 2",""],["GU-RUS-D-08-SH","Standard","Rush",""],["GU-BGG-D-09-SH","Standard","By Gucci",""],["GU-FLG-D-10-SH","Standard","Flora Gorgeous",""],["GU-GUW-D-11-SH","Standard","Guilty Women",""],["GU-FLO-D-12-SH","Standard","Flora","2020056"],["YS-LHO-H-01-SH","Standard","L’Homme","1050139"],["YS-LAN-H-02-SH","Standard","La Nuit De L’Homme","1050129"],["YS-MYS-H-03-SH","Standard","MYSLF",""],["YS-YYY-H-04-SH","Standard","Y",""],["YS-BLO-D-06-SH","Standard","Black Opium",""],["YS-BLO-D-06-SH","Premium","Black Opium",""],["YS-CIN-D-07-SH","Standard","Cinema",""],["YS-LIB-D-08-SH","Standard","Libre",""],["YS-LIB-D-08-PQ-SH","Exklusiv","Libre","2050140"],["YS-LIB-D-09-PQ-SH","Premium","Libre Intense","2010043"],["YS-MAN-D-11-SH","Standard","Manifesto",""],["YS-KOU-H-13-SH","Premium","Kouros",""],["YSL-LIBRE-LP-14-PQ","Premium","Libre LE Parfum",""],["YSL-BC-15-SH","Premium","Bybycat","3050161"],["YR-EVI-D-10-SH","Standard","Evidence",""],["YR-MAG-D-12-SH","Standard","Magnolia",""],["JCH-MB-001-SH","Standard","Jimmy Choo Man Blue","1050151"],["JCH-UH-002-SH","Premium","Jimmy Choo Urban Hero","1010092"],["CH-ALS-H-02-SH","Standard","Allure Sport",""],["CH-ALS-H-02-PQ-SH","Premium","Allure Sport",""],["CH-PLT-H-03-SH","Standard","Platinum Égoïste",""],["CH-BLE-H-05-SH","Standard","Bleu de Chanel",""],["CH-BLE-H-05-PQ-SH","Premium","Bleu de Chanel","1010023"],["CH-NO5-D-06-SH","Standard","N°5","2050119"],["CH-NO1-D-07-SH","Standard","N°19",""],["CH-CHA-D-08-SH","Standard","Chance",""],["CH-COM-D-10-SH","Standard","Coco Mademoiselle",""],["CH-COM-D-10-PQ-SH","Premium","Coco Mademoiselle","2010039"],["CH-CON-D-11-SH","Standard","Coco Noir",""],["CH-COC-D-12-SH","Standard","Coco",""],["CH-GAB-D-13-SH","Standard","Gabrielle",""],["CH-CET-D-14-SH","Standard","Chance Eau Tendre",""],["CH-ALS-D-15-SH","Premium","Allure Sensuelle",""],["GU-LHI-H-01-SH","Standard","L'Homme Idéal",""],["GU-HAR-H-02-SH","Standard","Habit Rouge Prive",""],["GU-SDV-U-03-SH","Premium","Spiritueuse Double Vanille",""],["GU-SAR-U-04-SH","Premium","Santal Royal","3010101"],["GU-INS-D-05-SH","Standard","Insolence",""],["GU-SAM-D-06-SH","Standard","Samsara",""],["GU-MON-D-07-SH","Standard","Mon Guerlain",""],["GU-EMO-U-08-PQ-SH","Exklusiv","Encens Mythique d'Orient",""],["GU-TOH-U-09-PQ-SH","Premium","Tobacco Honey",""],["GU-CHO-U-10-PQ-SH","Premium","Cherry Oud",""],["GU-TSR-U-11-SH","Premium","Tonka Sarrapia Extrait 75","3010008"],["AZ-AZZ-H-01-SH","Standard","Azzaro (Classic)",""],["AZ-WAN-H-02-SH","Standard","Wanted",""],["AZ-MOW-H-03-SH","Premium","The Most Wanted","1010022"],["AZ-CHR-H-04-SH","Standard","Chrome",""],["AZZ-WBN-05-SH","Standard","Wanted by Night","1010024"],["PR-LRB-H-01-SH","Standard","Luna Rossa Black",""],["PR-LRC-H-02-SH","Standard","Luna Rossa Carbon Homme",""],["PR-APH-H-03-SH","Standard","Amber Pour Homme",""],["PR-LHO-H-04-SH","Standard","L'Homme",""],["PR-PAR-D-05-SH","Standard","Paradoxe","2010002"],["PR-CAN-D-06-SH","Standard","Candy",""],["DG-DAG-H-01-SH","Standard","Dolce & Gabbana (Classic)",""],["DG-ONE-H-02-SH","Standard","The One",""],["DG-KIN-H-03-SH","Standard","King",""],["DG-EXE-H-04-SH","Standard","Exclusive Edition",""],["DG-LBM-H-05-SH","Standard","Light Blue Man",""],["DG-DAG-D-06-SH","Standard","Dolce & Gabbana (Classic)",""],["DG-ONE-D-07-SH","Standard","The One",""],["DG-QUE-D-08-SH","Standard","Queen",""],["DG-LIB-D-09-SH","Standard","Light Blue women",""],["DG-PFM-D-10-SH","Standard","Pour Femme",""],["DG-DEV-U-11-SH","Premium","Devotion",""],["GV-GEN-H-01-PQ-SH","Premium","Gentleman",""],["GV-GOI-H-02-SH","Standard","Gentleman Only Intense",""],["GV-PIH-H-03-SH","Standard","Pi",""],["GV-PLY-H-04-SH","Standard","Play man",""],["GV-XER-H-05-SH","Standard","Xeryus Rouge",""],["GV-POH-H-06-SH","Standard","Pour Homme",""],["GV-AMA-D-07-SH","Standard","Amarige",""],["GV-PLY-D-08-SH","Standard","Play Women",""],["GV-HOT-D-09-SH","Standard","Hot Couture",""],["GV-LIN-D-10-SH","Premium","L'Interdit 2018",""],["GV-IRR-D-11-SH","Standard","Irresistible",""],["GV-LIR-D-29-SH","Premium","L'Interdit Rouge",""],["GIV-GRP-30-SH","Premium","Gentleman Givenchy Réserve Privée","1010026"],["RJ-AMA-U-01-SH","Premium","Amber Aoud","3010213"],["RJ-ELY-H-02-SH","Premium","Elysium Pour Homme",""],["RJ-REC-H-03-SH","Premium","Reckless Pour Homme","2010205"],["ROJ-MSD-06-SH","Exklusiv","A Midsummer Dream","3060172"],["ROJ-ENI-05-SH","Exklusiv","Enigma","2010098"],["RL-PBL-H-01-SH","Standard","Polo Blue",""],["RL-PBK-H-02-SH","Standard","Polo Black",""],["RL-PEX-H-03-SH","Standard","Polo Explorer",""],["RL-PUR-H-04-SH","Standard","Purple Label",""],["RL-SAF-H-05-SH","Standard","Safari",""],["RL-RAL-D-06-SH","Standard","Ralph",""],["RL-ROM-D-07-SH","Standard","Romance",""],["WD-LON-U-01-PQ-SH","Premium","Widian London","3010038"],["BV-BLU-H-01-SH","Standard","Blue",""],["BV-AQV-H-02-SH","Standard","Aqva",""],["BV-TYG-H-03-SH","Standard","Le Gemme Tygar",""],["BV-OPS-D-04-SH","Standard","Omnia Pink Sapphire",""],["BV-JAS-D-05-SH","Standard","Jasmin Noir",""],["OP-MEG-U-01-SH","Premium","Megamare","3010226"],["OP-TER-U-02-SH","Exklusiv","Terroni","3010227"],["OP-BER-U-03-SH","Exklusiv","Bergamask","3010228"],["AT-OSK-U-01-SH","Premium","Oud Save The King",""],["AT-OSQ-U-02-SH","Premium","Oud Save the Queen",""],["VA-UOM-H-01-SH","Standard","Uomo",""],["VA-UBR-H-02-SH","Standard","Uomo Born In Roma","1010214"],["VA-DON-D-03-SH","Standard","Donna",""],["VA-DBR-D-04-SH","Premium","Donna Born In Roma","2010042"],["VA-VOC-D-05-SH","Standard","Voce Viva",""],["GI-AMB-H-01-SH","Premium","Ambassador",""],["GI-AMB-D-02-SH","Premium","Ambassador Women","2020069"],["GIS-TIT-03-SH","Premium","Titanium","1020078"],["JM-WSS-U-01-SH","Standard","Wood Sage & Sea Salt","3010229"],["JM-EPF-U-02-SH","Standard","English Pear & Freesia",""],["JM-MYT-U-03-SH","Standard","Myrrh & Tonka Perfume","3010206"],["JM-CYP-U-04-PQ-SH","Premium","Cypress & Grapevine intense",""],["NI-HAC-U-01-SH","Premium","Hacivat",""],["NI-ANI-U-02-SH","Premium","Ani","3050132"],["NI-HAX-U-03-SH","Premium","Hacivat X",""],["NI-SHE-U-04-SH","Premium","Shem",""],["NI-WHC-U-05-SH","Premium","Whlong Cha","3010215"],["NI-NEF-U-06-PQ-SH","Premium","Nefs","3010230"],["NI-HSW-U-07-SH","Premium","Hundred Silent Ways",""],["NSH-FYF-08-SH","Premium","Fan Your Flames","3020108"],["PH-TRG-H-01-SH","Standard","The Tragedy of Lord George",""],["PH-IWP-H-02-SH","Standard","The Inimitable William",""],["PH-CLC-D-03-SH","Standard","Clandestine Clara",""],["PH-HAL-U-04-SH","Exklusiv","Halfeti",""],["MP-AFL-U-01-SH","Premium","African Leather",""],["MP-MAR-U-02-SH","Premium","Marfa",""],["EN-FLN-U-01-SH","Premium","Fleur Narcotique",""],["EN-BLT-U-02-PQ-SH","Exklusiv","Blue Talisman","3050137"],["EXN-LIP-04-SH","Premium","Lust in Paradise","2030082"],["EXN-HED-05-SH","Exklusiv","The Hedonist","3010095"],["EXN-VK-06-SH","Premium","Venenum Kiss","3010097"],["MM-SEN-U-01-SH","Standard","Sensual",""],["EM-MO2-U-01-SH","Premium","Molecule 02 = Ambroxan","3010018"],["EM-MO1-U-02-SH","Premium","Molecule 01 = ISO-E-Super","3010030"],["LEP-SBR-002-SH","Exklusiv","Sacred Bond","3060171"],["BU-BUR-H-01-SH","Standard","Burberry (Classic)",""],["BU-HER-H-02-SH","Standard","Hero",""],["BU-MRB-H-03-SH","Standard","Mr. Burberry",""],["BU-MYB-D-04-SH","Standard","My Burberry",""],["BU-HER-D-05-SH","Standard","Her",""],["BU-GOD-D-06-SH","Standard","Goddess",""],["BU-MBB-D-07-SH","Standard","My Burberry Black",""],["BU-WEE-U-08-SH","Standard","Weekend",""],["NA-BLA-U-01-SH","Standard","Black Afgano",""],["NA-BLA-U-02-PQ-SH","Exklusiv","Black Afgano",""],["NA-FAN-U-03-SH","Standard","Fantomas",""],["HB-HUG-H-02-SH","Standard","Hugo Boss (Classic)",""],["HB-HUG-H-02-PQ-SH","Premium","Hugo Boss",""],["HB-ELI-H-03-SH","Standard","Bottled Elixir",""],["HB-TSE-H-04-SH","Standard","The Scent Elixir",""],["HB-MOT-H-05-SH","Standard","In Motion",""],["HB-ENE-H-06-SH","Standard","Energise",""],["HB-BOT-H-07-SH","Standard","Bottled",""],["HB-BEP-H-08-SH","Standard","Bottled Eau de Parfum",""],["HB-TSE-H-09-SH","Standard","The Scent",""],["HB-EXT-H-10-SH","Standard","Extrem",""],["HB-ICE-H-11-SH","Standard","Iced",""],["HB-ORM-H-12-SH","Standard","Orange Man","1050135"],["HB-ELE-H-13-SH","Standard","Element",""],["HB-BAL-H-14-SH","Standard","Baldessarini",""],["HB-HUG-D-15-SH","Standard","Hugo Boss (Classic)",""],["HB-ORW-D-16-SH","Standard","Orange Woman",""],["HB-MAV-D-17-SH","Standard","Ma Vie",""],["HB-TSH-D-18-SH","Standard","The Scent For Her",""],["HB-ALI-D-19-SH","Standard","Alive",""],["LC-CHA-H-01-SH","Standard","Challenge",""],["LC-MAG-H-02-SH","Standard","Magnetic","1020059"],["LC-RED-H-03-SH","Standard","Red",""],["LC-BLU-H-04-SH","Standard","Blue","1050142"],["LC-WHI-H-05-SH","Standard","White",""],["LC-COO-H-06-SH","Standard","Cool Play",""],["LC-ESS-H-07-SH","Standard","Essential",""],["LC-BLK-H-08-SH","Standard","Black",""],["LC-FRE-H-09-SH","Standard","Fresh",""],["LC-LAC-D-10-SH","Standard","Lacoste (Classic)",""],["LC-EFR-D-11-SH","Standard","Eau Fraiche",""],["LC-PAR-D-12-SH","Standard","Parfum",""],["DU-DEB-H-01-SH","Standard","Desire Blue","1010231"],["DU-DES-H-02-SH","Standard","Desire",""],["DU-FRE-H-03-SH","Standard","Fresh",""],["DU-LON-H-04-SH","Standard","London","1020198"],["DU-BRA-H-05-SH","Standard","Braun",""],["DU-ICO-H-06-SH","Standard","Icon",""],["CK-ETE-H-01-SH","Standard","Eternity",""],["CK-ESC-H-02-SH","Standard","Escape",""],["CK-EUP-H-03-SH","Standard","Euphoria",""],["CK-CK1-H-04-SH","Standard","CK1",""],["CK-CK1-H-04-PQ-SH","Premium","CK1",""],["CK-GOL-H-05-SH","Standard","Gold",""],["CK-CK2-H-06-SH","Standard","CK2",""],["CK-DEF-H-07-SH","Standard","Defy",""],["CK-ESC-D-08-SH","Standard","Escape Women",""],["CK-ETE-D-09-SH","Standard","Eternity Women",""],["CK-EUP-D-10-SH","Standard","Euphoria Women",""],["JP-HOM-H-01-SH","Standard","Homme","1020060"],["JP-NIG-H-02-SH","Standard","Nightflight","1020199"],["JP-WOW-H-03-SH","Standard","WOW!",""],["AJ-MAG-U-01-SH","Premium","Magic","3010001"],["AJ-SNO-U-02-SH","Standard","Snow",""],["AJ-SUL-U-03-SH","Premium","SULTAN N° 9","3010001"],["DV-ECH-H-01-SH","Standard","Echo",""],["DV-SIL-H-02-SH","Standard","Silver Shadow",""],["DV-CHA-H-03-SH","Standard","Champion",""],["DV-CWM-H-04-SH","Standard","Cool Water Man","1020075"],["DV-CWG-H-05-SH","Standard","Cool Water Game",""],["DV-CWW-D-06-SH","Standard","Cool Water Women",""],["MB-LEG-H-01-SH","Standard","Legend",""],["MB-EXP-H-02-SH","Standard","Explorer Platinum",""],["CH-212-H-01-SH","Standard","Herrera 212","1020200"],["CH-CHM-H-02-SH","Standard","CH Men",""],["CH-VIP-H-03-SH","Standard","VIP",""],["CH-SEX-H-04-SH","Standard","Sexy",""],["CH-BAD-H-05-SH","Standard","Badboy",""],["CH-GOG-D-06-SH","Standard","Good Girl",""],["CH-GOB-D-07-SH","Standard","Good Girl Blush",""],["CH-GFP-D-08-SH","Standard","Good Girl Fantastic Pink",""],["CH-SX2-D-09-SH","Standard","Sexy 212",""],["CH-VIP-D-10-SH","Standard","VIP Women",""],["CH-CHW-D-11-SH","Standard","CH Women",""],["CH-212H-D-01-SH","Premium","212 Heroes For Her",""],["PB-PLY-U-01-SH","Standard","Play Boy",""],["VP-DEP-U-01-SH","Premium","Dear Polly","3010232"],["AB-SEB-H-01-SH","Standard","Seduction Blue",""],["LC-OUB-H-01-SH","Premium","Oud Bouquet",""],["LC-IDO-D-02-SH","Standard","Idôle",""],["LC-TRE-D-03-SH","Standard","Trésor",""],["LC-IDN-D-04-SH","Standard","Idôle Now",""],["LC-LVB-D-05-SH","Standard","La Vie Est Belle","2020051"],["LC-LVB-D-06-PQ-SH","Premium","La Vie Est Belle","2010041"],["LC-LVR-D-07-SH","Standard","La Vie Est Belle En Rose",""],["LC-MIR-D-08-SH","Standard","Miracle",""],["LC-LVBINTEN-09-SH","Premium","La Vie Est Belle Intensement",""],["KA-YUM-D-01-SH","Premium","Yum Pistachio Gelato | 33",""],["KA-VAN-D-02-SH","Premium","Vanilla | 28","3020201"],["KA-VCR-D-03-SH","Exklusiv","Vanilla Candy Rock Sugar | 42",""],["KA-OVO-D-04-SH","Premium","Oudgasm Vanilla Oud | 36",""],["KY-DJW-U-05-SH","Premium","Déjà Vu White Flower | 57",""],["KY-MAU-U-06-SH","Exklusiv","Maui In A Bottle Sweet Banana | 37","2010040"],["KA-IOA-U-07-PQ-SH","Exklusiv","Invite Only Amber | 23 PQ",""],["KA-LBC-U-08-SH","Premium","Lovefest Burning Cherry | 48",""],["KA-WVS-U-09-SH","Premium","The Wedding Velvet Santal | 35",""],["KA-MBO-U-10-SH","Premium","Marrakesh In A Bottle Orange Blossom | 24",""],["YU-BMM-U-11-SH","Premium","Yum Boujee Marshmallow | 81","2020050"],["KA-EJAP-12-SH","Exklusiv","Eden Juicy Apple | 01",""],["GT-BIA-D-01-SH","Standard","Bianco Latte","3010216"],["NN-CAV-U-01-SH","Premium","Caramelo Vanilla","3010015"],["MP-VP-01-SH","Exklusiv","Vanilla Powder","3050131"],["TH-TOM-H-01-SH","Standard","Tommy Hilfiger (Classic)",""],["HE-TER-H-01-SH","Standard","Terre d’Hermès","1050130"],["HE-TER-H-01-PQ-SH","Exklusiv","Terre d’Hermès","1010237"],["HE-BAR-D-02-SH","Premium","Barenia",""],["CA-DEK-H-01-SH","Standard","Déclaration",""],["CA-PAS-H-02-SH","Standard","Pasha","1050144"],["CA-LAP-D-03-SH","Standard","La Panthère","2050136"],["ZV-HIM-H-01-SH","Standard","This is Him!","1050141"],["ZV-HER-D-02-SH","Standard","This is Her!",""],["ZV-ZAD-U-03-SH","Standard","Zadig & Voltaire (Classic)",""],["VR-SPI-H-01-SH","Standard","Spicebomb",""],["VR-BON-D-02-SH","Standard","Bonbon",""],["VR-FLO-D-03-SH","Standard","Flowerbomb",""],["FM-CAR-U-01-SH","Standard","Carnal Flower",""],["FM-POL-D-02-PQ-SH","Exklusiv","Portrait of a Lady",""],["FM-SJ-03-SH","Exklusiv","Synthetic Naturr - Synthetic Jungle","3050159"],["BY-BAL-U-01-SH","Premium","Bal d'Afrique",""],["BY-GYW-U-02-PQ-SH","Premium","Gypsy Water",""],["BY-BLA-U-03-SH","Premium","Blanche","2010207"],["BY-BK-SN-D-04-SH","Premium","Black Saffron",""],["BYR-MJG-04-SH","Premium","Mojave Ghost","3020114"],["MU-ANG-H-01-SH","Standard","Angel Man",""],["MU-ANG-D-02-SH","Standard","Angel Women","2050145"],["MU-ALI-D-04-SH","Standard","Alien",""],["MU-ALI-D-04-PQ-SH","Premium","Alien","2010006"],["LM-SEK-U-01-SH","Premium","Sekushi ~ No 7",""],["JB-SIL-H-01-SH","Standard","Silver Scent",""],["JB-OMS-H-02-SH","Standard","One Man Show",""],["CA-PHO-H-01-SH","Standard","Pour Homme",""],["HU-HUM-H-01-SH","Standard","Hummer Perfume",""],["LB-ROM-H-01-SH","Standard","Roma",""],["NI-SCU-H-01-SH","Standard","Sculpture",""],["LU-LUC-H-01-SH","Standard","Lucky Man",""],["KE-GRE-H-01-SH","Standard","Kenzo Green",""],["KEN-FLO-D-02-SH","Standard","Flower by Kenzo",""],["KEN-JUN-D-03-SH","Premium","Jungle L'Éléphant",""],["GF-FER-H-01-SH","Standard","Ferre",""],["MA-UOM-H-01-SH","Standard","Malizia Uomo",""],["CA-PUH-H-01-SH","Standard","Caron Pour un Homme",""],["MB-GAN-U-01-SH","Premium","Ganymede",""],["MAB-TIL-U-02-SH","Premium","Tilia","3010010"],["MAB-ENC-03-SH","Exklusiv","Encelade","3810100"],["DI-OTP-H-01-SH","Standard","Only The Brave Privé",""],["DI-BAD-H-02-SH","Standard","Bad",""],["DI-FFL-H-03-SH","Standard","Fuel For Life",""],["VO-PHO-U-02-SH","Standard","Voyage Pour Homme","1050134"],["VO-PHO-H-02-PQ-SH","Premium","Voyage","1010209"],["AME-SPO-U-01-SH","Standard","America Sport",""],["ISS-ISS-U-01-SH","Standard","Issey Miyake Man",""],["IM-LEA-D-02-SH","Standard","L'Eau d'Issey (Women)",""],["STD-STD-U-01-SH","Standard","S.T. Dupont",""],["ADI-ADI-U-01-SH","Standard","Adidas",""],["ACF-FIC-U-01-SH","Premium","Fico di Amalfi","3020202"],["ADP-CE-02-SH","Premium","Colonia Essenza","1050156"],["ARA-DEV-U-01-SH","Standard","Devin",""],["UNK-BLU-U-01-SH","Standard","Blue For Men",""],["RAS-HAW-U-02-SH","Standard","Hawas",""],["RA-BLU-D-03-SH","Standard","Blue Lady",""],["RA-ROM-D-04-SH","Standard","Romance",""],["BRU-BRU-U-01-SH","Standard","Brut",""],["PAR-PAR-H-01-SH","Standard","Paris Hilton man",""],["PH-PAR-D-02-SH","Standard","Paris Hilton (Women)",""],["MON-MON-U-01-SH","Standard","Monsieur Casanova",""],["JAC-DEJ-U-01-SH","Standard","de Jacomo",""],["GUY-DRA-U-01-SH","Standard","Drakkar Noir",""],["ORL-DER-U-02-SH","Standard","Derrick",""],["ROY-ROY-U-01-SH","Standard","Royal",""],["ROY-ROB-U-02-SH","Standard","Royal Blue",""],["CIG-CIG-U-01-SH","Premium","CIGAR",""],["REM-SHA-U-01-SH","Standard","Shalis",""],["RM-SHA-D-02-SH","Standard","Shalis (Women)",""],["JIL-SUN-U-01-SH","Standard","Sun",""],["SCO-SCO-U-01-SH","Standard","Scorpio",""],["AXY-CHO-U-01-SH","Standard","Chocolate",""],["FER-FER-U-01-SH","Standard","Ferrari",""],["FEN-FEN-U-01-SH","Standard","Fendi","1020065"],["LAP-RUM-D-01-SH","Standard","Rumba",""],["LAP-PHO-U-02-SH","Standard","Lapidus Man","1020113"],["LAP-PHO-U-02-PQ-SH","Exklusiv","Lapidus Man","1050133"],["TL-LAP-D-03-SH","Standard","Lapidus Woman",""],["LAM-LAM-U-01-SH","Standard","Lamborghini",""],["MER-MER-U-01-SH","Standard","Mercedes-Benz",""],["UNK-HAM-U-01-SH","Standard","Happy Men",""],["UNK-HAM-U-02-SH","Standard","Happy Men (Duplicate)",""],["UNK-KAH-U-01-SH","Standard","Kaher Alnesaa",""],["CHO-HEA-U-01-SH","Standard","Heaven","1020064"],["GOR-GOR-U-01-SH","Standard","Gorg Kerdahi",""],["JA-JAG-H-01-SH","Standard","Jaguar (Classic)",""],["ES-SEG-D-01-SH","Standard","Sexy Graffiti",""],["ES-COL-D-02-SH","Standard","Collection",""],["ES-MAG-D-03-SH","Standard","Magnetism",""],["ES-TAJ-D-04-SH","Standard","Taj Sunset","2020053"],["ES-TRO-D-05-SH","Standard","Tropical",""],["ES-ESP-D-06-SH","Standard","Especially",""],["ES-MON-D-07-SH","Standard","Moon Sparkle",""],["CA-AMO-D-01-SH","Standard","Amor Amor",""],["CA-ANA-D-02-SH","Standard","Anaïs Anaïs",""],["EL-MOD-D-01-SH","Standard","Modern Muse",""],["EL-PLE-D-02-SH","Standard","Pleasures",""],["AG-CLO-D-01-SH","Standard","Cloud",""],["DK-BED-D-01-SH","Standard","Be Delicious",""],["MW-TOS-D-01-SH","Standard","Tosca",""],["GB-GIO-D-01-SH","Standard","G by Giorgio",""],["NR-RIC-D-01-SH","Standard","Ricci Ricci",""],["NR-NIN-D-02-SH","Standard","Nina",""],["RC-ROB-D-01-SH","Standard","Roberto Cavalli Eau de Parfum",""],["RC-PAF-D-02-SH","Standard","Paradise Found",""],["RE-CHA-D-01-SH","Standard","Charlie",""],["ES-GON-D-01-SH","Standard","Girl of Now",""],["ES-LEP-D-02-SH","Standard","Le Parfum",""],["BS-FAN-D-01-SH","Standard","Fantasy",""],["BS-MID-D-02-SH","Standard","Midnight Fantasy",""],["BS-SUN-D-03-SH","Standard","Sunset Fantasy",""],["NA-VOY-D-01-SH","Standard","Voyage women",""],["VS-FAB-D-01-SH","Standard","Fabulous-SH",""],["VS-BSG-D-02-SH","Standard","Bombshell Gold",""],["VS-LIH-D-03-SH","Standard","Love is Heavenly",""],["JA-COB-D-01-SH","Standard","Cobra",""],["GR-CAB-D-01-SH","Standard","Cabotine",""],["AO-KAS-D-01-SH","Standard","Kashmir",""],["CHL-EDP-D-01-SH","Standard","Chloé Eau de Parfum",""],["CHL-NOM-D-02-SH","Standard","Nomade Eau de Parfum",""],["CHL-LOV-D-03-SH","Standard","Love Story",""],["PAC-CAS-D-01-SH","Standard","Cassilia",""],["LAN-MAR-D-01-SH","Standard","Marry Me!",""],["MDM-MLI-D-01-SH","Standard","My Love Intense",""],["ROC-MAN-D-01-SH","Standard","Rochas Man",""],["ROC-MAD-D-02-SH","Standard","Madame Rochas",""],["JG-VAV-U-01-SH","Premium","Vanilla Vibes",""],["JH-NAP-U-02-SH","Premium","Not a Perfume",""],["NR-RGE-D-01-SH","Standard","Narciso Rouge",""],["NR-FH-D-02-SH","Standard","Narciso Rodriguez for Her","2020112"],["NR-PDR-D-03-SH","Premium","Narciso Rodriguez Poudrée",""],["NR-MNFH-D-04-SH","Premium","Musc Noir For Her","2020070"],["NR-MNRFH-D-05-SH","Premium","Musc Noir Rose For Her",""],["NR-PMU-U-06-SH","Standard","For Her Pure Musc","2050120"],["ML-HWI-D-01-SH","Standard","Hawai",""],["OT-HDS-D-01-SH","Standard","Harem des Sultans",""],["OT-MDZ-D-02-SH","Standard","Frauenverführer",""],["OT-MHB-D-03-SH","Standard","Männerverführerin",""],["OT-DON-D-04-SH","Standard","Donnerstag Nacht",""],["OT-SMK-D-05-SH","Standard","Make-up",""],["AR-002-SH","Standard","White Musk",""],["AR-002-PQ-SH","Premium","White Musk","3010046"],["AR-003-SH","Standard","Kaaba Musk",""],["AR-004-SH","Standard","Red Musk",""],["AR-005-SH","Premium","Musk Tahara Abdul Samad Al Qurashi",""],["AR-006-SH","Premium","Musk Makka",""],["AR-007-SH","Premium","Musk Tahara","301004"],["AR-008-SH","Standard","Rosen-Moschus Tahara",""],["AR-009-SH","Standard","Granatapfel- Moschus Tahara",""],["AR-010-SH","Standard","Puder-Moschus Tahara",""],["AR-011-SH","Standard","Vanille- Moschus Tahara",""],["AR-012-SH","Standard","Lavendel- Moschus Tahara",""],["AR-013-SH","Standard","Blaubeere -Moschus Tahara Rot",""],["AR-014-SH","Standard","Blaubeere -Moschus Tahara Blue",""],["AR-015-SH","Standard","Lady Sweet Moschus Tahara",""],["AR-016-SH","Standard","Apfel- Moschus Tahara",""],["AR-017-SH","Standard","Mango-Moschus Tahara",""],["AR-018-SH","Standard","Honig- Moschus Tahara",""],["AR-019-SH","Exklusiv","Musk Al Ghazal Saudi-Arabien",""],["AR-020-SH","AR-001-SH","Scent of Incense",""],["AR-021-SH","Premium","Sultan of Oud",""],["AR-022-SH","Premium","Oud Al-Abiad",""],["AR-023-SH","AR-001-SH","Dehn Aloud Mubakhar",""],["AR-024-SH","AR-001-SH","Cambodian Oud",""],["AR-025-SH","AR-001-SH","Velvet Oud",""],["AR-026-SH","AR-001-SH","Sandal Oud",""],["AR-027-SH","AR-001-SH","White Oud",""],["AR-028-SH","Premium","Royal Oud",""],["AR-029-SH","Standard","Gulf Oud",""],["AR-030-SH","Standard","Isfahan Oud",""],["AR-031-SH","Standard","Perfect Oud",""],["AR-032-SH","Standard","Oud Kalemat",""],["AR-033-SH","Premium","Oud Isfahan Dior",""],["AR-034-SH","Premium","Diplomatic Oud",""],["AR-035-SH","Premium","Oud Sahib Alsumu",""],["AR-036-SH","Standard","Sultan Parfum",""],["AR-037-SH","Standard","Maqam Ibrahim",""],["AR-038-SH","Standard","Kashkha",""],["AR-039-SH","Standard","One Thousand and One Nights",""],["AR-040-SH","Standard","The Knight",""],["AR-041-SH","Standard","Dubai Princess",""],["AR-042-SH","Premium","The Message","3010031"],["AR-043-SH","Premium","Madawi Arabian Oud","2020076"],["AR-044-SH","Premium","Amazing",""],["AR-045-SH","Standard","Shaghaf Oud Swiss Arabian","3050146"],["AR-046-SH","Standard","Al Wisal Silver from Ajmal",""],["AR-047-SH","Premium","Al Wesal Golden from Ajmal",""],["AR-048-SH","Standard","Al Wisam Pour Homme Rasasi",""],["AR-049-SH","Standard","Gold Dust Rot",""],["AR-050-SH","Standard","Gold Dust Gelb",""],["AR-051-SH","Standard","Silver Dust",""],["AR-052-SH","Exklusiv","Woody Arabian Oud",""],["AR-053-SH","Premium","AMBER WOOD von Ajmal",""],["AR-054-SH","Premium","OUD ISPAN DIOR PRIVE",""],["AR-055-SH","Standard","Ana wel alshoq",""],["AR-056-SH","Standard","Gulf Flower",""],["AR-057-SH","Standard","Alamaken",""],["AR-058-SH","Standard","Love",""],["AR-059-SH","Standard","Sea Breeze","3020061"],["AR-060-SH","Standard","Tulip Flower",""],["AR-061-SH","Standard","Orchid Flower","3020062"],["AR-062-SH","Premium","Cardinia",""],["AR-063-SH","Standard","Jasminum Sambac","3020054"],["AR-064-SH","Standard","Jasmin",""],["AR-065-SH","Premium","Jasmin Premium Qualität",""],["AR-066-SH","Standard","Flower Violet",""],["AR-067-SH","Standard","Vanilla",""],["AR-068-SH","Premium","Amber",""],["AR-069-SH","Standard","Biscuits",""],["AR-070-SH","Standard","Hamul","3020066"],["AR-071-SH","Standard","Johnson",""],["AR-072-SH","Standard","Dove",""],["AR-073-SH","Standard","Shoulders",""],["AR-074-SH","Standard","Fa",""],["AR-075-SH","Standard","Basilicum",""],["AR-076-SH","Standard","Fruits",""],["AR-077-SH","Standard","Lily Flower",""],["AR-078-SH","Standard","Lavender","3020049"],["AR-079-SH","Standard","Narzisse",""],["AR-080-SH","Standard","Pine",""],["AR-081-SH","Standard","Cranberry","3020063"],["AR-082-SH","Standard","Mandarine",""],["AR-083-SH","Standard","Gory Roses / Blutige Rosen",""],["AR-084-SH","Standard","Kokosnuss",""],["AR-085-SH","Standard","Perfume of Paradise",""],["AR-086-SH","Premium","Oud Bouquet",""],["AR-087-SH","Exklusiv","Oud Mubakhar Saudi-Arabien",""],["AR-088-PQ-SH","Exklusiv","OUD AL-ABIAD Premium Qualität",""],["AR-089-SH","Standard","Patchouli",""],["AR-090-SH","Premium","Bade'e Al Oud Oud for Glory",""],["AR-091-SH","Premium","Zafaran Mukhalat",""],["AR-092-SH","Standard","Linden",""],["AR-093-SH","Standard","Lattafa Yara",""],["AR-094-SH","Standard","Lattafa Ammerat Al Arab",""],["AR-095-SH","Standard","Lattafa Assad Black",""],["AR-096-SH","Premium","Lattafa Atlas",""],["AR-097-SH","Standard","Lattafa Ana Abiyadehe Rouge",""],["AR-098-SH","Premium","Lattafa Khamra","3020071"],["AR-099-SH","Standard","Lattafa An Abiyadehe",""],["AR-100-SH","Premium","One & Only Gissah",""],["AR-101-SH","Premium","LA Luna Gissah",""],["AR-102-SH","Premium","Hudson Valley Gissah",""],["AR-103-SH","Premium","Helen Gissah",""],["AR-104-SH","Premium","Imperial Valley Gissah","3020077"],["AR-105-SH","Premium","Calabria by Gissah",""],["AR-105-A-SH","Premium","CAPRI Qissa",""],["AR-106-SH","Premium","Ammer Aloud",""],["AR-107-SH","Premium","Sheikh Al Shuyukh",""],["AR-108-SH","Premium","Raghba",""],["AR-109-SH","Premium","Bade'e Al Oud Oud for Glory",""],["AR-110-SH","Premium","Amber Wood",""],["AR-111-SH","Premium","Al-Haitham",""],["AR-112-SH","Premium","Anfas Ishq",""],["AR-113-PQ-SH","Exklusiv","Schwarz Musk Saudi Arabien",""],["AR-115-PQ-SH","Exklusiv","Royal Musk Saudi Arabien","3010047"],["AR-119-SH","Premium","Musk Tahara Fresh","3030086"]];

/** Alkohol-Unterlagen (SDS / Datenblatt) als Link – Dateien liegen in Shopify (Inhalt → Dateien). */
function alkoholSds_(sku) {
  var s = String(sku || '').toUpperCase();
  var base = 'https://cdn.shopify.com/s/files/1/0929/4571/1487/files/';
  if (s.indexOf('FHG-K-B001') === 0) return { key: 'kosmetik', text:
    'Ethanol 96 % – kosmetische Qualität\nSicherheitsdatenblatt (Deutsch): ' + base + 'SDS_Ethanol-96-Kosmetik_DE.pdf\nSafety Data Sheet (English): ' + base + 'SDS_Ethanol-96-Kosmetik_EN.pdf\nProduktinformation / Product information: ' + base + 'Produktinformation_Ethanol-96-Kosmetik.pdf' };
  if (s.indexOf('FH-AD96') === 0) return { key: 'denat', text:
    'Alcohol denat. 96 % – Parfümqualität\nTechnisches Datenblatt / Technical data sheet: ' + base + 'Datenblatt_Alcohol-denat-96_Parfuemqualitaet.pdf' };
  return null;
}
