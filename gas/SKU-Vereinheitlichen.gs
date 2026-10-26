/**
 * SKU-Vereinheitlichen.gs – korrigiert vertauschte SKUs im Shop: "…-SH-PQ-aac" → "…-PQ-SH-aac"
 * 1. Mit SKU_AENDERN = false ausführen → nur Vorschau im Blatt "SKU-Änderungen"
 * 2. Vorschau prüfen, dann SKU_AENDERN = true setzen, speichern, erneut ausführen → Änderung in Shopify
 */
   var SKU_AENDERN = false;

function skuVereinheitlichen() {
  var ss = openCodesSpreadsheet();
  var s1 = {};
  ss.getSheetByName('Sheet1').getDataRange().getValues().slice(1).forEach(function (r) {
    var k = String(r[3] || '').trim().toUpperCase();
    if (k) s1[k] = true;
  });

  var zeilen = [], proProdukt = {}, cursor = null;
  do {
    var d = shopifyGraphQL('query($c: String) { productVariants(first: 250, after: $c) { ' +
      'pageInfo { hasNextPage endCursor } nodes { id sku product { id title } } } }', { c: cursor }).productVariants;
    d.nodes.forEach(function (v) {
      var alt = String(v.sku || '').trim();
      var m = alt.match(/^(.*?)-SH-PQ(-.+)?$/i);
      if (!m) return;
      var neu = m[1] + '-PQ-SH' + (m[2] || '');
      var ok = !!s1[(m[1] + '-PQ-SH').toUpperCase()];
      zeilen.push([v.product.title, alt, neu, ok ? (SKU_AENDERN ? 'geändert' : 'bereit') : '⚠️ ' + m[1] + '-PQ-SH nicht in Sheet1 – nicht geändert']);
      if (ok && SKU_AENDERN) (proProdukt[v.product.id] = proProdukt[v.product.id] || []).push({ id: v.id, inventoryItem: { sku: neu } });
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor);

  var fehler = [];
  Object.keys(proProdukt).forEach(function (pid) {
    var r = shopifyGraphQL('mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { ' +
      'userErrors { field message } } }', { p: pid, v: proProdukt[pid] }).productVariantsBulkUpdate;
    if (r.userErrors && r.userErrors.length) fehler.push(pid + ': ' + r.userErrors.map(function (e) { return e.message; }).join(', '));
  });

  var sh = ss.getSheetByName('SKU-Änderungen') || ss.insertSheet('SKU-Änderungen');
  sh.clear();
  var kopf = ['Produkt', 'SKU alt', 'SKU neu', 'Status'];
  sh.getRange(1, 1, 1, 4).setValues([kopf]).setFontWeight('bold');
  if (zeilen.length) sh.getRange(2, 1, zeilen.length, 4).setValues(zeilen);
  sh.setFrozenRows(1);
  sh.autoResizeColumns(1, 4);

  var bereit = zeilen.filter(function (z) { return z[3] === 'bereit' || z[3] === 'geändert'; }).length;
  var text = (SKU_AENDERN ? '✏️ SKUs geändert: ' : '👀 VORSCHAU – nichts geändert. Bereit zum Ändern: ') + bereit +
    '\n⚠️ nicht änderbar: ' + (zeilen.length - bereit) + (fehler.length ? '\n❌ Fehler:\n- ' + fehler.join('\n- ') : '') +
    '\nDetails: Blatt "SKU-Änderungen"';
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}