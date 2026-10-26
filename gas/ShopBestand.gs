/* =====================================================================
   ShopBestand.gs – Shop-Verfügbarkeit der Duftöle aus dem echten Lager (kg)

   Regel:
   • Ein Öl (Code + Qualität) gilt als GEZÄHLT, wenn es seit dem letzten
     "Inventur-Start" im Blatt "Bewegungen" eine Inventur-Buchung hat und diese
     nicht per "Inventur-Reset" zurückgesetzt wurde.
   • GEZÄHLT + Aktiv = JA  → alle Größen dieses Öls im Shop:
        Menge je Größe = abrunden( (Lager kg − offene Bestellungen kg) ÷ Größe )
        Verkauf bei 0 gestoppt (DENY) → der Shop zeigt "Ausverkauft".
   • NICHT gezählt oder Aktiv = NEIN → "Weiterverkaufen, wenn nicht vorrätig"
        (CONTINUE) wie bisher; Mengen werden nicht verändert.
   • Offene Bestellungen = Shopify-Bestellungen, die das Lager noch nicht
     abgezogen hat (unbezahlt/autorisiert/teilbezahlt, oder bezahlt aber noch
     nicht gebucht). Bestellungen bis "Abzug erst nach Bestellnr." zählen nicht.

   Blatt "Shop-Bestand": eine Zeile je gezähltem Öl (automatisch). In Spalte C
   kann ein Öl mit NEIN vom Abgleich ausgenommen werden.
   Einstellungen: "Shop-Bestand-Abgleich" = JA/NEIN (Hauptschalter).

   Einmalig: shopBestandEinrichten()   (Blatt, Einstellungen, Trigger 15 Min.)
   Probe ohne Änderungen: shopBestandProbe()
   Sofort abgleichen: shopBestandAbgleich()
   ===================================================================== */
var SB_LOC_ = 'gid://shopify/Location/107236360575';           // Hauptlager
var SB_BLATT_ = 'Shop-Bestand';
var SB_VBLATT_ = 'Shop-Bestand-Varianten';
var SB_KOPF_ = ['Key', 'Produkt', 'Aktiv (JA/NEIN)', 'Gezählt am', 'Lager kg', 'Offene Bestellungen kg',
                'Verfügbar kg', 'Shop-Mengen', 'Status', 'Letzter Abgleich', 'Stand (intern)'];
var SB_VKOPF_ = ['Key', 'VariantId', 'ProductId', 'InventoryItemId', 'SKU', 'Größe', 'Gramm'];

/* ---------------- Shopify ---------------- */
function sbGql_(query, variables) {
  for (var i = 0; i < 6; i++) {
    var res = UrlFetchApp.fetch('https://' + CONFIG.SHOP + '/admin/api/' + CONFIG.API_VERSION + '/graphql.json', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { 'X-Shopify-Access-Token': getAccessToken() },
      payload: JSON.stringify({ query: query, variables: variables || {} })
    });
    var code = res.getResponseCode(), txt = res.getContentText(), j = null;
    try { j = JSON.parse(txt); } catch (e) { j = null; }
    if (code === 429 || (j && j.errors && JSON.stringify(j.errors).indexOf('THROTTLED') >= 0) || code >= 500) {
      Utilities.sleep(1500 * (i + 1)); continue;
    }
    if (code >= 300 || !j || j.errors) throw new Error('Shopify ' + code + ': ' + txt.slice(0, 500));
    return j.data;
  }
  throw new Error('Shopify: keine Antwort (gedrosselt)');
}

/* ---------------- Blätter ---------------- */
function sbBlatt_(name, kopf, versteckt) {
  var ss = lagerSS_(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, kopf.length).setValues([kopf]).setFontWeight('bold');
    sh.setFrozenRows(1);
    if (versteckt) sh.hideSheet();
  }
  return sh;
}
function sbEinstSetzen_(name, wert, notiz) {
  var sh = lagerSS_().getSheetByName('Einstellungen'), v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues();
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === name) { sh.getRange(i + 1, 2).setValue(wert); return; }
  sh.appendRow([name, wert, notiz || '']);
}

/* ---------------- Lager-Seite ---------------- */
/** Key -> Zeitpunkt der gültigen Zählung (seit letztem "Inventur-Start", ohne zurückgesetzte). Nur Öle. */
function sbGezaehlt_() {
  var sh = lagerSS_().getSheetByName('Bewegungen'), last = sh.getLastRow(), out = {};
  if (last < 2) return out;
  var v = sh.getRange(2, 1, last - 1, 5).getValues(), start = 0;
  var invMs = new Date(PropertiesService.getScriptProperties().getProperty('LAGER_INV_START') || 0).getTime() || 0;   // Fix 21.10.2026: Runde aus der App
  for (var i = v.length - 1; i >= 0; i--) if (String(v[i][1]) === 'Inventur-Start') { start = i + 1; break; }
  for (var j = start; j < v.length; j++) {
    if (invMs && (v[j][0] instanceof Date ? v[j][0].getTime() : new Date(v[j][0]).getTime()) < invMs) continue;
    var q = String(v[j][1]), k = String(v[j][4] || '');
    if (k.indexOf('|') < 0) continue;
    if (q === 'Inventur') out[k] = v[j][0];
    else if (q === 'Inventur-Reset') delete out[k];
  }
  return out;
}

/** Key -> kg in Shopify-Bestellungen, die das Lager noch nicht abgezogen hat. */
function sbOffen_() {
  var props = PropertiesService.getScriptProperties(), out = {}, gesehen = {};
  var abNr = Number(lagerEinstellung_('Abzug erst nach Bestellnr.', 0)) || 0;
  var iso = function (ms) { return new Date(Date.now() - ms).toISOString(); };
  var abfragen = [
    { q: "(financial_status:pending OR financial_status:authorized OR financial_status:partially_paid) AND created_at:>='" + iso(45 * 864e5) + "'", bezahlt: false },
    { q: "(financial_status:paid OR financial_status:partially_refunded) AND updated_at:>='" + iso(12 * 3600e3) + "'", bezahlt: true }
  ];
  abfragen.forEach(function (a) {
    var c = null;
    do {
      var d = sbGql_('query($q:String!,$c:String){orders(first:50,after:$c,query:$q){pageInfo{hasNextPage endCursor} ' +
        'nodes{id name cancelledAt displayFinancialStatus lineItems(first:100){nodes{sku title variantTitle currentQuantity}}}}}', { q: a.q, c: c });
      d.orders.nodes.forEach(function (o) {
        if (o.cancelledAt || gesehen[o.id]) return;
        var st = String(o.displayFinancialStatus || '');
        if (a.bezahlt ? ['PAID', 'PARTIALLY_REFUNDED'].indexOf(st) < 0 : ['PENDING', 'AUTHORIZED', 'PARTIALLY_PAID'].indexOf(st) < 0) return;
        var nr = parseInt(String(o.name || '').replace(/\D/g, ''), 10) || 0;
        if (abNr && nr && nr <= abNr) return;                                    // wird vom Lager nie abgezogen
        if (props.getProperty('LAGER_AB_' + String(o.id).split('/').pop())) return; // schon im Lager abgezogen
        gesehen[o.id] = 1;
        o.lineItems.nodes.forEach(function (li) {
          var p = lagerParseSku_(li.sku, li.title, li.variantTitle);
          if (!p || !p.item.oil) return;
          var k = lagerKey_(p.item.code, p.item.tier, true), q = Number(li.currentQuantity) || 0;
          if (q > 0) out[k] = Math.round(((out[k] || 0) + q * p.menge) * 1000) / 1000;
        });
      });
      c = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
    } while (c);
  });
  return out;
}

/* ---------------- Varianten-Zuordnung (Cache-Blatt, täglich neu) ---------------- */
function sbVariantenScan_() {
  var rows = [], c = null;
  do {
    var d = sbGql_('query($c:String){productVariants(first:200,after:$c){pageInfo{hasNextPage endCursor} ' +
      'nodes{id sku title product{id title} inventoryItem{id}}}}', { c: c });
    d.productVariants.nodes.forEach(function (v) {
      var p = lagerParseSku_(v.sku, v.product.title, v.title);
      if (!p || !p.item.oil) return;
      var g = Math.round(p.menge * 1000);
      if (g <= 0) return;
      rows.push([lagerKey_(p.item.code, p.item.tier, true), v.id, v.product.id, v.inventoryItem.id, v.sku,
                 String(v.title || '').split(' / ')[0].trim(), g]);
    });
    c = d.productVariants.pageInfo.hasNextPage ? d.productVariants.pageInfo.endCursor : null;
  } while (c);
  var sh = sbBlatt_(SB_VBLATT_, SB_VKOPF_, true);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SB_VKOPF_.length).clearContent();
  if (rows.length) sh.getRange(2, 1, rows.length, SB_VKOPF_.length).setValues(rows);
  PropertiesService.getScriptProperties().setProperty('SB_SCAN_AT', String(Date.now()));
  return rows.length;
}
function sbVariantenMap_() {
  var sh = sbBlatt_(SB_VBLATT_, SB_VKOPF_, true), last = sh.getLastRow(), out = {};
  if (last >= 2) sh.getRange(2, 1, last - 1, SB_VKOPF_.length).getValues().forEach(function (r) {
    if (!r[0]) return;
    (out[r[0]] = out[r[0]] || []).push({ id: r[1], pid: r[2], item: r[3], sku: r[4], size: r[5], g: Number(r[6]) });
  });
  return out;
}

/* ---------------- Hauptlauf ---------------- */
function shopBestandAbgleich() { return sbLauf_({}); }
function shopBestandVoll() { return sbLauf_({ voll: true }); }
function shopBestandProbe() { return sbLauf_({ probe: true, voll: true }); }
/** Test mit einem einzigen Öl (Key unten anpassen). */
var SB_TEST_KEY_ = 'XJ-AL2-U-10-SH|S';
function shopBestandTestProbe() { return sbLauf_({ nur: SB_TEST_KEY_, voll: true, probe: true }); }
function shopBestandTestEcht() { return sbLauf_({ nur: SB_TEST_KEY_, voll: true }); }
/** Prüft, ob die Shopify-App die nötigen Rechte hat. */
function shopBestandRechte() {
  var d = sbGql_('{currentAppInstallation{accessScopes{handle}}}');
  var h = d.currentAppInstallation.accessScopes.map(function (s) { return s.handle; });
  var noetig = ['write_inventory', 'write_products', 'read_orders'];
  var fehlt = noetig.filter(function (n) { return h.indexOf(n) < 0; });
  Logger.log('Rechte: ' + h.join(', ') + '\nFEHLT: ' + (fehlt.join(', ') || 'nichts'));
  return fehlt;
}

function sbLauf_(opt) {
  opt = opt || {};
  if (!opt.probe && String(lagerEinstellung_('Shop-Bestand-Abgleich', 'JA')).toUpperCase() !== 'JA') return 'aus';
  var cache = CacheService.getScriptCache();
  if (!opt.probe) { if (cache.get('SB_LAUF')) return 'läuft schon'; cache.put('SB_LAUF', '1', 900); }
  var log = [];
  try {
    var props = PropertiesService.getScriptProperties();
    var jetzt = new Date();
    // 1) Offene Bestellungen ZUERST, danach das Lager lesen (sonst könnte eine gerade gebuchte Bestellung fehlen)
    var offen = sbOffen_();
    var gez = sbGezaehlt_(), bm = lagerBestandMap_().map;

    // 2) Blatt "Shop-Bestand": neue gezählte Öle aufnehmen
    var sh = sbBlatt_(SB_BLATT_, SB_KOPF_, false), last = sh.getLastRow();
    var zeilen = last >= 2 ? sh.getRange(2, 1, last - 1, SB_KOPF_.length).getValues() : [], idx = {};
    zeilen.forEach(function (r, i) { if (r[0]) idx[String(r[0])] = i; });
    Object.keys(gez).forEach(function (k) {
      if (idx[k] != null || !bm[k]) return;
      idx[k] = zeilen.length;
      zeilen.push([k, String(bm[k].data[3] || ''), 'JA', '', '', '', '', '', '', '', '']);
    });

    // 3) Varianten-Zuordnung (neu scannen: täglich, bei Volllauf oder wenn ein Öl noch keine Varianten hat)
    var vmap = sbVariantenMap_(), scanAt = Number(props.getProperty('SB_SCAN_AT') || 0);
    var fehlt = zeilen.some(function (r) { return r[0] && !vmap[r[0]] && (!opt.nur || r[0] === opt.nur); });
    if (opt.voll || Date.now() - scanAt > 20 * 3600e3 || (fehlt && Date.now() - scanAt > 3600e3)) {
      log.push('Varianten gescannt: ' + sbVariantenScan_()); vmap = sbVariantenMap_();
    }
    var voll = opt.voll || Date.now() - Number(props.getProperty('SB_VOLL_AT') || 0) > 20 * 3600e3;

    // 4) Soll je Öl bestimmen
    var auftraege = [];
    zeilen.forEach(function (r, i) {
      var k = String(r[0] || ''); if (!k || (opt.nur && k !== opt.nur)) return;
      var aktiv = String(r[2]).trim().toUpperCase() !== 'NEIN', gezaehlt = gez[k] != null;
      var lager = bm[k] ? Number(bm[k].data[6]) || 0 : 0, off = offen[k] || 0;
      var verfG = Math.round((lager - off) * 1000);
      var sync = aktiv && gezaehlt;
      var stand = sync ? 'S:' + verfG : 'C';
      r[1] = r[1] || (bm[k] ? String(bm[k].data[3] || '') : '');
      r[3] = gezaehlt ? gez[k] : '';
      r[4] = Math.round(lager * 1000) / 1000; r[5] = off; r[6] = sync ? Math.max(0, verfG) / 1000 : '';
      var vs = vmap[k] || [];
      if (!vs.length) { r[7] = ''; r[8] = 'KEINE SHOP-VARIANTE'; r[9] = jetzt; r[10] = ''; return; }
      if (!voll && String(r[10]) === stand) return;                           // unverändert
      auftraege.push({ i: i, k: k, sync: sync, verfG: verfG, vs: vs, stand: stand,
                       grund: !aktiv ? 'AUS (manuell) – Weiterverkauf' : !gezaehlt ? 'NICHT GEZÄHLT – Weiterverkauf' : '' });
    });
    log.push('Öle im Blatt: ' + zeilen.length + ', zu bearbeiten: ' + auftraege.length + (voll ? ' (Volllauf)' : ''));

    // 5) Ist-Zustand aus Shopify für die betroffenen Varianten
    var alleV = [];
    auftraege.forEach(function (a) { a.vs.forEach(function (v) { alleV.push(v.id); }); });
    var ist = {};
    for (var p = 0; p < alleV.length; p += 80) {
      var d = sbGql_('query($ids:[ID!]!,$l:ID!){nodes(ids:$ids){... on ProductVariant{id inventoryPolicy product{id} ' +
        'inventoryItem{id tracked inventoryLevel(locationId:$l){quantities(names:["available"]){quantity}}}}}}', { ids: alleV.slice(p, p + 80), l: SB_LOC_ });
      d.nodes.forEach(function (n) {
        if (!n || !n.id) return;
        var lv = n.inventoryItem.inventoryLevel;
        ist[n.id] = { policy: n.inventoryPolicy, pid: n.product.id, item: n.inventoryItem.id, tracked: n.inventoryItem.tracked,
                      avail: lv && lv.quantities && lv.quantities.length ? lv.quantities[0].quantity : null };
      });
    }

    // 6) Änderungen planen
    var tracken = [], aktivieren = [], mengen = [], policy = {}, fehler = {};
    auftraege.forEach(function (a) {
      var text = [];
      a.vs.slice().sort(function (x, y) { return y.g - x.g; }).forEach(function (v) {
        var s = ist[v.id];
        if (!s) { fehler[a.k] = 'Variante fehlt in Shopify (neu scannen)'; return; }
        var wantPol = a.sync ? 'DENY' : 'CONTINUE';
        if (s.policy !== wantPol) (policy[s.pid] = policy[s.pid] || []).push({ id: v.id, inventoryPolicy: wantPol });
        if (!a.sync) return;
        var soll = Math.max(0, Math.floor(a.verfG / v.g));
        text.push(v.size + ': ' + soll);
        if (!s.tracked) tracken.push(s.item);
        if (s.avail == null) aktivieren.push({ item: s.item, soll: soll, k: a.k });
        else if (s.avail !== soll) mengen.push({ item: s.item, von: s.avail, soll: soll, k: a.k });
      });
      a.text = text.join(' · ');
    });
    log.push('Mengen: ' + mengen.length + ', Verkaufsregel: ' + Object.keys(policy).length + ' Produkte, Tracking: ' + tracken.length + ', Aktivierung: ' + aktivieren.length);

    if (opt.probe) {
      log.push('PROBE – nichts geändert');
      auftraege.forEach(function (a) { log.push(a.k + ' | ' + (a.sync ? 'SYNC ' + (a.verfG / 1000) + ' kg → ' + a.text : a.grund)); });
      mengen.slice(0, 60).forEach(function (m) { log.push('  ' + m.k + ' ' + m.item.split('/').pop() + ': ' + m.von + ' → ' + m.soll); });
      Object.keys(policy).forEach(function (pid) { log.push('  Regel ' + pid.split('/').pop() + ': ' + policy[pid].map(function (x) { return x.inventoryPolicy; }).join(',')); });
      Logger.log(log.join('\n'));
      return log.join('\n');
    }

    // 7) Schreiben: Tracking → Aktivieren → Mengen → erst dann DENY/CONTINUE
    tracken.forEach(function (item) {
      var r = sbGql_('mutation($id:ID!){inventoryItemUpdate(id:$id,input:{tracked:true}){userErrors{message}}}', { id: item });
      if (r.inventoryItemUpdate.userErrors.length) log.push('Tracking ' + item + ': ' + r.inventoryItemUpdate.userErrors[0].message);
    });
    aktivieren.forEach(function (x) {
      var r = sbGql_('mutation($i:ID!,$l:ID!,$a:Int,$k:String!){inventoryActivate(inventoryItemId:$i,locationId:$l,available:$a) @idempotent(key:$k){userErrors{message}}}',
        { i: x.item, l: SB_LOC_, a: x.soll, k: Utilities.getUuid() });
      if (r.inventoryActivate.userErrors.length) fehler[x.k] = 'Aktivierung: ' + r.inventoryActivate.userErrors[0].message;
    });
    var setzen = function (liste) {
      var stale = [];
      for (var s = 0; s < liste.length; s += 100) {
        var teil = liste.slice(s, s + 100);
        var r = sbGql_('mutation($i:InventorySetQuantitiesInput!,$k:String!){inventorySetQuantities(input:$i) @idempotent(key:$k){userErrors{code message}}}', {
          k: Utilities.getUuid(),
          i: { name: 'available', reason: 'correction', quantities: teil.map(function (m) {
            return { inventoryItemId: m.item, locationId: SB_LOC_, quantity: m.soll, changeFromQuantity: m.von }; }) }
        });
        var ue = r.inventorySetQuantities.userErrors;
        if (ue.length) {
          if (ue.some(function (e) { return e.code === 'CHANGE_FROM_QUANTITY_STALE'; })) stale = stale.concat(teil);
          else teil.forEach(function (m) { fehler[m.k] = 'Menge: ' + ue[0].message; });
        }
      }
      return stale;
    };
    var stale = setzen(mengen);
    if (stale.length) {                                   // in der Zwischenzeit verkauft: frisch lesen, einmal wiederholen
      var d2 = sbGql_('query($ids:[ID!]!,$l:ID!){nodes(ids:$ids){... on InventoryItem{id inventoryLevel(locationId:$l){quantities(names:["available"]){quantity}}}}}',
        { ids: stale.map(function (m) { return m.item; }), l: SB_LOC_ });
      var neu = {};
      d2.nodes.forEach(function (n) { if (n && n.inventoryLevel) neu[n.id] = n.inventoryLevel.quantities[0].quantity; });
      var nochmal = stale.filter(function (m) { return neu[m.item] != null && neu[m.item] !== m.soll; })
                         .map(function (m) { return { item: m.item, von: neu[m.item], soll: m.soll, k: m.k }; });
      setzen(nochmal).forEach(function (m) { fehler[m.k] = 'Menge geändert während Abgleich – nächster Lauf'; });
    }
    Object.keys(policy).forEach(function (pid) {
      var r = sbGql_('mutation($p:ID!,$v:[ProductVariantsBulkInput!]!){productVariantsBulkUpdate(productId:$p,variants:$v){userErrors{field message}}}',
        { p: pid, v: policy[pid] });
      if (r.productVariantsBulkUpdate.userErrors.length) {
        var msg = 'Regel: ' + r.productVariantsBulkUpdate.userErrors[0].message;
        auftraege.forEach(function (a) { if (a.vs.some(function (v) { return v.pid === pid; })) fehler[a.k] = msg; });
      }
    });

    // 8) Blatt schreiben
    auftraege.forEach(function (a) {
      var r = zeilen[a.i];
      r[7] = a.sync ? a.text : '';
      r[8] = fehler[a.k] ? 'FEHLER: ' + fehler[a.k] : (a.sync ? (a.verfG < Math.min.apply(null, a.vs.map(function (v) { return v.g; })) ? 'AUSVERKAUFT' : 'SYNCHRON') : a.grund);
      r[9] = jetzt;
      r[10] = fehler[a.k] ? 'ERR' : a.stand;
    });
    if (zeilen.length) sh.getRange(2, 1, zeilen.length, SB_KOPF_.length).setValues(zeilen);
    if (voll && !opt.nur) props.setProperty('SB_VOLL_AT', String(Date.now()));
    sbEinstSetzen_('Letzter Shop-Bestand-Abgleich', jetzt);
    log.push('Fehler: ' + Object.keys(fehler).length + (Object.keys(fehler).length ? ' → ' + JSON.stringify(fehler) : ''));
    Logger.log(log.join('\n'));
    return log.join('\n');
  } finally {
    if (!opt.probe) cache.remove('SB_LAUF');
  }
}

/* ---------------- Einrichtung ---------------- */
function shopBestandEinrichten() {
  sbBlatt_(SB_BLATT_, SB_KOPF_, false);
  sbBlatt_(SB_VBLATT_, SB_VKOPF_, true);
  var sh = lagerSS_().getSheetByName('Einstellungen'), v = sh.getRange(1, 1, sh.getLastRow(), 1).getValues(), da = false;
  for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === 'Shop-Bestand-Abgleich') da = true;
  if (!da) sh.appendRow(['Shop-Bestand-Abgleich', 'JA', 'JA = gezählte Öle: Shop-Menge aus dem Lager, bei 0 "Ausverkauft". NEIN = Abgleich angehalten']);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'shopBestandAbgleich') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('shopBestandAbgleich').timeBased().everyMinutes(15).create();
  Logger.log('Shop-Bestand eingerichtet (Trigger alle 15 Minuten).');
}
