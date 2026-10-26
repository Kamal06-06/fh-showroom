/**
 * Grundpreis.gs – Grundpreis (€ / 1 kg) für alle Duftöl-Varianten aus der Gewichtsangabe (6 g, 100 g, 1 Kg …)
 * 1. GRUNDPREIS_AENDERN = false → nur Vorschau im Blatt "Grundpreis"
 * 2. true → in Shopify setzen (bei "Zeit abgelaufen" einfach erneut ausführen)
 */
var GRUNDPREIS_AENDERN = false;

function grundpreisSetzen() {
  var start = Date.now(), cursor = null, proProdukt = {}, zeilen = [], schon = 0;
  do {
    var d = shopifyGraphQL('query($c: String) { productVariants(first: 250, after: $c) { pageInfo { hasNextPage endCursor } ' +
      'nodes { id title sku price showUnitPrice unitPriceMeasurement { quantityValue quantityUnit } product { id title } } } }',
      { c: cursor }).productVariants;
    d.nodes.forEach(function (v) {
      if (ET_KEIN_OEL.test(v.product.title + ' ' + v.title)) return;               // Zubehör
      var m = String(v.title).match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
      if (!m) return;                                                              // kein Gewicht
      var menge = parseFloat(m[1].replace(',', '.')), einheit = /kg/i.test(m[2]) ? 'KG' : 'G';
      var gramm = einheit === 'KG' ? menge * 1000 : menge;
      var um = v.unitPriceMeasurement;
      if (v.showUnitPrice && um && Number(um.quantityValue) === menge && um.quantityUnit === einheit) { schon++; return; }
      var proKg = Number(v.price) / gramm * 1000;
      zeilen.push([v.product.title, v.title, v.sku, Number(v.price), proKg.toFixed(2).replace('.', ',') + ' € / 1 kg']);
      (proProdukt[v.product.id] = proProdukt[v.product.id] || []).push({ id: v.id, showUnitPrice: true,
        unitPriceMeasurement: { quantityValue: menge, quantityUnit: einheit, referenceValue: 1, referenceUnit: 'KG' } });
    });
    cursor = d.pageInfo.hasNextPage ? d.pageInfo.endCursor : null;
  } while (cursor);

  var ss = openCodesSpreadsheet();
  var sh = ss.getSheetByName('Grundpreis') || ss.insertSheet('Grundpreis');
  sh.clear();
  sh.getRange(1, 1, 1, 5).setValues([['Produkt', 'Variante', 'SKU', 'Preis €', 'Grundpreis']]).setFontWeight('bold');
  if (zeilen.length) sh.getRange(2, 1, zeilen.length, 5).setValues(zeilen);
  sh.setFrozenRows(1);

  var fertig = 0, fehler = [], abgebrochen = false;
  if (GRUNDPREIS_AENDERN) {
    var ids = Object.keys(proProdukt);
    for (var i = 0; i < ids.length; i++) {
      if (Date.now() - start > 5 * 60 * 1000) { abgebrochen = true; break; }
      var r = shopifyGraphQL('mutation($p: ID!, $v: [ProductVariantsBulkInput!]!) { productVariantsBulkUpdate(productId: $p, variants: $v) { ' +
        'userErrors { field message } } }', { p: ids[i], v: proProdukt[ids[i]] }).productVariantsBulkUpdate;
      if (r.userErrors && r.userErrors.length) fehler.push(r.userErrors[0].message); else fertig += proProdukt[ids[i]].length;
    }
  }
  var text = GRUNDPREIS_AENDERN
    ? '⚖️ Grundpreis gesetzt: ' + fertig + ' Varianten' + (abgebrochen ? '\n⏳ Zeit abgelaufen – bitte grundpreisSetzen erneut ausführen' : '\n✅ fertig') +
      '\nBereits vorhanden: ' + schon + (fehler.length ? '\n❌ ' + fehler.slice(0, 3).join('\n❌ ') : '')
    : '👀 VORSCHAU Grundpreis – nichts geändert\nZu setzen: ' + zeilen.length + ' Varianten\nBereits vorhanden: ' + schon + '\nDetails: Blatt "Grundpreis"';
  Logger.log(text);
  if (typeof etTelegram_ === 'function') etTelegram_(text, null);
}