/* =====================================================================
   Bestseller.gs – automatische Bestseller-Kollektion
   Jede Woche: Verkäufe der letzten BS.tage auswerten (bezahlte, nicht
   stornierte, keine Test-Bestellungen), die BS.anzahl meistverkauften
   Duftöle mit dem Tag "Bestseller" versehen, alle anderen entfernen.
   Öle mit Tag "Bestseller-fix" bleiben immer drin.
   Einmalig: bestsellerEinrichten()   Manuell: bestsellerAktualisieren()
   ===================================================================== */
var BS = { tage: 90, anzahl: 24, tag: 'Bestseller', fix: 'Bestseller-fix', typ: 'Fragrance Oil', kollektion: 'gid://shopify/Collection/706147844479' };

function bsStamm_(sku) { var m = String(sku || '').toUpperCase().match(/^(.*?-SH)(?:-|$)/); return m ? m[1] : ''; }

/** Verkaufszahlen je Öl (Stammcode) der letzten BS.tage: {code: {orders, kg, pid, title}} */
function bsVerkaeufe_() {
  var seit = new Date(Date.now() - BS.tage * 86400000).toISOString().slice(0, 10);
  var q = 'financial_status:paid -status:cancelled created_at:>=' + seit;
  var cursor = null, stat = {};
  do {
    var d = shopifyGraphQL('query($q:String!,$c:String){ orders(first:100, after:$c, query:$q, sortKey:CREATED_AT){ pageInfo{hasNextPage endCursor} nodes{ id test cancelledAt lineItems(first:100){ nodes{ sku quantity variantTitle product{ id title productType } } } } } }', { q: q, c: cursor });
    d.orders.nodes.forEach(function (o) {
      if (o.test || o.cancelledAt) return;
      var seen = {};
      (o.lineItems.nodes || []).forEach(function (li) {
        var p = li.product; if (!p || p.productType !== BS.typ) return;
        var code = bsStamm_(li.sku); if (!code) return;
        var m = String(li.variantTitle || '').match(/(\d+(?:[.,]\d+)?)\s*(kg|g)\b/i);
        var kg = m ? parseFloat(m[1].replace(',', '.')) * (m[2].toLowerCase() === 'kg' ? 1 : 0.001) : 0;
        var s = stat[code] || (stat[code] = { orders: 0, kg: 0, pid: p.id, title: p.title });
        s.kg += kg * (Number(li.quantity) || 0);
        if (!seen[code]) { seen[code] = 1; s.orders++; }
      });
    });
    cursor = d.orders.pageInfo.hasNextPage ? d.orders.pageInfo.endCursor : null;
  } while (cursor);
  return stat;
}

/** Produkte mit einem Tag: [{id, title}] */
function bsProdukteMitTag_(tag) {
  var cursor = null, out = [];
  do {
    var d = shopifyGraphQL('query($q:String!,$c:String){ products(first:100, after:$c, query:$q){ pageInfo{hasNextPage endCursor} nodes{ id title } } }', { q: 'tag:' + tag, c: cursor });
    out = out.concat(d.products.nodes); cursor = d.products.pageInfo.hasNextPage ? d.products.pageInfo.endCursor : null;
  } while (cursor);
  return out;
}
function bsTag_(mutation, id, tag) {
  var d = shopifyGraphQL('mutation($id:ID!,$t:[String!]!){ ' + mutation + '(id:$id, tags:$t){ userErrors{ message } } }', { id: id, t: [tag] });
  var e = d[mutation].userErrors; if (e && e.length) throw new Error(e[0].message);
}

function bestsellerAktualisieren() {
  var stat = bsVerkaeufe_();
  var fix = bsProdukteMitTag_(BS.fix), fixIds = {}; fix.forEach(function (p) { fixIds[p.id] = p.title; });
  var rang = Object.keys(stat).map(function (c) { return { code: c, s: stat[c] }; })
    .filter(function (x) { return !fixIds[x.s.pid]; })
    .sort(function (a, b) { return (b.s.orders - a.s.orders) || (b.s.kg - a.s.kg); });
  var neu = {}; Object.keys(fixIds).forEach(function (id) { neu[id] = fixIds[id]; });
  var frei = Math.max(0, BS.anzahl - Object.keys(fixIds).length), n = 0;
  for (var i = 0; i < rang.length && n < frei; i++) { if (!neu[rang[i].s.pid]) { neu[rang[i].s.pid] = rang[i].s.title; n++; } }

  var alt = bsProdukteMitTag_(BS.tag), altIds = {}; alt.forEach(function (p) { altIds[p.id] = p.title; });
  var rein = [], raus = [];
  Object.keys(neu).forEach(function (id) { if (!altIds[id]) { bsTag_('tagsAdd', id, BS.tag); rein.push(neu[id]); } });
  Object.keys(altIds).forEach(function (id) { if (!neu[id]) { bsTag_('tagsRemove', id, BS.tag); raus.push(altIds[id]); } });

  // Reihenfolge in der Kollektion = Rangfolge (Kollektion steht auf 'Manuell')
  try {
    var order = Object.keys(fixIds).concat(rang.filter(function (x) { return neu[x.s.pid] && !fixIds[x.s.pid]; }).map(function (x) { return x.s.pid; }));
    var moves = order.map(function (id, i) { return { id: id, newPosition: String(i) }; });
    var r = shopifyGraphQL('mutation($id:ID!,$m:[MoveInput!]!){ collectionReorderProducts(id:$id, moves:$m){ job{ id } userErrors{ message } } }', { id: BS.kollektion, m: moves });
    if (r.collectionReorderProducts.userErrors.length) Logger.log('Sortierung: ' + r.collectionReorderProducts.userErrors[0].message);
  } catch (e) { Logger.log('Sortierung fehlgeschlagen: ' + e.message); }

  var top = rang.slice(0, 10).map(function (x, i) { return (i + 1) + '. ' + x.s.title + ' (' + x.s.orders + ' Best., ' + Math.round(x.s.kg * 100) / 100 + ' kg)'; }).join('\n');
  var text = '⭐ Bestseller aktualisiert (' + BS.tage + ' Tage, ' + Object.keys(neu).length + ' Öle)\n' +
    (rein.length ? '\n➕ Neu: ' + rein.join(', ') : '') + (raus.length ? '\n➖ Raus: ' + raus.join(', ') : '') +
    (!rein.length && !raus.length ? '\nKeine Änderung.' : '') + '\n\nTop 10:\n' + top;
  Logger.log(text);
  try { if (typeof lagerWhatsApp_ === 'function') lagerWhatsApp_(text); } catch (e) {}
  return { rein: rein, raus: raus, anzahl: Object.keys(neu).length };
}

function bestsellerEinrichten() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'bestsellerAktualisieren') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('bestsellerAktualisieren').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(7).create();
  return bestsellerAktualisieren();
}

