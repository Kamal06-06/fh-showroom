/* Fragrance Hub – Flakon-Sets im Warenkorb (Drawer + Warenkorbseite) als EINE Position anzeigen.
   Flakon, Sprühkopf und Kappe(n) bleiben einzelne Warenkorbzeilen (Artikelnummern, Lager, Kasse) –
   sie werden nur gemeinsam dargestellt: Anzahl Sets, Preis je Set, Summe, Bestandteile zum Aufklappen.
   Links der Set-Teile führen zur echten Produktseite (nicht zu den internen „(im Set)"-Artikeln). */
(function () {
  var LG = (document.documentElement.lang || 'de').slice(0, 2);
  var ALL = {
    de: { sets: 'Sets', per: 'je Set', parts: 'Bestandteile', hide: 'Bestandteile ausblenden', rm: 'Set entfernen', mixedCap: 'Kappen gemischt', mixedSpr: 'Sprühköpfe gemischt', spr: 'Sprühkopf', cap: 'Kappe', edit: 'Set ändern' },
    en: { sets: 'sets', per: 'per set', parts: 'Components', hide: 'Hide components', rm: 'Remove set', mixedCap: 'Mixed caps', mixedSpr: 'Mixed spray heads', spr: 'Spray head', cap: 'Cap', edit: 'Change set' },
    ar: { sets: 'طقم', per: 'للطقم', parts: 'المكوّنات', hide: 'إخفاء المكوّنات', rm: 'حذف الطقم', mixedCap: 'أغطية مختلطة', mixedSpr: 'بخاخات مختلطة', spr: 'بخاخ', cap: 'غطاء', edit: 'تعديل الطقم' }
  };
  var TX = ALL[LG] || ALL.de;
  var ROOT = (window.Shopify && Shopify.routes && Shopify.routes.root) || '/';
  var fmt = function (c) { return (c / 100).toLocaleString(LG === 'en' ? 'en-IE' : 'de-DE', { style: 'currency', currency: 'EUR' }); };
  var cart = null, open = {}, busy = false, t;
  /* interne Set-Artikel → echte Produktseite (nach Artikelnummer) */
  var LINK = [['TY2107', 'parfumkappe-polo'], ['TY2374', 'parfumkappe-ribbed'], ['KP-WCB', 'parfumkappe-holz'], ['TY2346', 'parfumkappe-eckig'], ['TY2343', 'parfumkappe-kugel'], ['TY2248', 'parfumkappe-kugel'],
    ['TY2302', 'parfumkappe-atlas'], ['EASY15-SI', 'spruhkopf-fea-15'], ['EASY15-GO', 'parfum-spruhkopf-fea-15-gold'], ['EASY15-SW', 'parfum-spruhkopf-fea-15-schwarz']];

  if (!document.getElementById('fh-sets-css')) {
    var st = document.createElement('style'); st.id = 'fh-sets-css';
    st.textContent =
      '.fh-set td{padding:0!important;border:0!important}' +
      '.fh-set-c{border:1.5px solid #d9bf7a;border-radius:14px;background:#fffdf8;padding:14px 14px 12px;margin:12px 0 4px}' +
      '.fh-set-h{display:flex;gap:12px;align-items:center}.fh-set-h img{width:96px;height:96px;flex:0 0 96px;object-fit:contain;border-radius:10px;background:#fff;border:1px solid rgba(28,33,53,.08)}' +
      '.fh-set-t{flex:1;min-width:0}.fh-set-t a{display:block;font-size:1.5rem;font-weight:700;color:#1c2135;text-decoration:none}.fh-set-t a:hover{text-decoration:underline}.fh-set-t small{display:block;font-size:1.25rem;color:#6e6c67;line-height:1.45;margin-top:2px}' +
      '.fh-set-p{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-top:10px;font-size:1.35rem;color:#1c2135}.fh-set-p b{font-size:1.6rem;white-space:nowrap}' +
      '.fh-set-a{display:flex;flex-wrap:wrap;gap:6px 16px;margin-top:8px;font-size:1.25rem}.fh-set-a button,.fh-set-a a{background:none;border:0;padding:0;color:#1c2135;text-decoration:underline;text-underline-offset:3px;cursor:pointer;font:inherit}.fh-set-a button.rm{color:#a3460f}' +
      'tr.fh-set-part:not(.fh-show){display:none!important}tr.fh-set-part.fh-show{background:#fbf8f1}';
    document.head.appendChild(st);
  }

  function linkFor(it) {
    if (!/^set-/.test(it.handle || '')) return null;
    var sku = String(it.sku || '').toUpperCase();
    for (var i = 0; i < LINK.length; i++) if (sku.indexOf(LINK[i][0]) === 0) return ROOT + 'products/' + LINK[i][1];
    return null;
  }
  function cfgUrl(p) { return ROOT + 'pages/flakon-konfigurator' + (p && p._m ? '?m=' + encodeURIComponent(p._m) + (p._ml ? '&ml=' + encodeURIComponent(p._ml) : '') : ''); }

  function groups(c) {
    var g = {}, order = [];
    (c.items || []).forEach(function (it, i) {
      var p = it.properties || {}, k = p._set || p['Flakon-Set'];
      if (!k) return;
      if (!g[k]) { g[k] = { k: k, lines: [], name: p['Flakon-Set'] || 'Flakon-Set', sets: +p._sets || 0, p: p }; order.push(k); }
      g[k].lines.push({ it: it, i: i + 1 });
    });
    return order.map(function (k) {
      var x = g[k];
      if (x.lines.length < 2) return null;
      x.total = x.lines.reduce(function (a, l) { return a + l.it.final_line_price; }, 0);
      var isFl = function (l) { return /flakon/i.test(l.it.product_title); }, fl = x.lines.filter(isFl)[0] || x.lines[0], rest = x.lines.filter(function (l) { return l !== fl; });
      var sps = rest.filter(function (l) { return /spr(ü|u)hkopf/i.test(l.it.product_title); });
      var caps = rest.filter(function (l) { return /kappe/i.test(l.it.product_title); });
      var nm = function (l) { return (l.it.variant_title || '').replace(/^Default Title$/, '') || l.it.product_title.replace(/^Parf(ü|u)mkappe\s*/i, ''); };
      var part = function (list, one, many) { return list.length > 1 ? many + ': ' + list.map(function (l) { return nm(l) + ' ×' + l.it.quantity; }).join(', ') : list.length ? one + ' ' + nm(list[0]) : ''; };
      x.desc = [part(sps, TX.spr, TX.mixedSpr), part(caps, TX.cap, TX.mixedCap)].filter(Boolean).join(' · ');
      if (!x.sets) x.sets = Math.max.apply(null, rest.map(function (l) { return l.it.quantity; }).concat([1]));
      x.img = ''; try { x.img = localStorage.getItem('fhSetImg:' + x.k) || ''; } catch (e) {}
      if (!x.img) x.img = fl.it.image || '';
      x.url = cfgUrl(x.p);
      x.lines.sort(function (a, b) { return (a === fl ? -1 : 0) - (b === fl ? -1 : 0); });
      return x;
    }).filter(Boolean);
  }

  function rowsIn(root, i) { return root.querySelector('#CartDrawer-Item-' + i + ', #CartItem-' + i); }

  function paint() {
    if (!cart) return;
    var gs = groups(cart);
    /* Links der internen Set-Artikel überall im Warenkorb auf die echte Produktseite lenken */
    (cart.items || []).forEach(function (it, i) {
      var url = linkFor(it) || (/^set-/.test(it.handle || '') && (it.properties || {})._set ? cfgUrl(it.properties) : null); if (!url) return;
      document.querySelectorAll('#CartDrawer-Item-' + (i + 1) + ' a[href*="/products/"], #CartItem-' + (i + 1) + ' a[href*="/products/"]').forEach(function (a) { if (a.getAttribute('href') !== url) a.setAttribute('href', url); });
    });
    [document.querySelector('cart-drawer'), document.querySelector('cart-items:not(cart-drawer-items)'), document.querySelector('#main-cart-items')].forEach(function (root) {
      if (!root) return;
      root.querySelectorAll('tr.fh-set').forEach(function (x) { x.remove(); });
      root.querySelectorAll('tr.fh-set-part').forEach(function (x) { x.classList.remove('fh-set-part', 'fh-show'); });
      gs.forEach(function (g) {
        var rws = g.lines.map(function (l) { return rowsIn(root, l.i); }).filter(Boolean); if (!rws.length) return;
        var first = rws.reduce(function (a, b) { return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING ? b : a; });
        rws.forEach(function (r) { r.classList.add('fh-set-part'); r.classList.toggle('fh-show', !!open[g.k]); });
        var tr = document.createElement('tr'); tr.className = 'fh-set';
        var td = document.createElement('td'); td.colSpan = 5; tr.appendChild(td);
        var c = document.createElement('div'); c.className = 'fh-set-c'; td.appendChild(c);
        c.innerHTML = '<div class="fh-set-h">' + (g.img ? '<a class="im"><img src="' + (g.img.indexOf('data:') === 0 ? g.img : g.img + (g.img.indexOf('?') > -1 ? '&' : '?') + 'width=200') + '" alt=""></a>' : '') +
          '<div class="fh-set-t"><a class="nm"></a><small></small></div></div>' +
          '<div class="fh-set-p"><span></span><b></b></div><div class="fh-set-a"><button type="button" class="tg"></button><a class="ed"></a><button type="button" class="rm"></button></div>';
        c.querySelectorAll('a.nm, a.im, a.ed').forEach(function (a) { a.href = g.url; });
        c.querySelector('.fh-set-t a').textContent = g.name;
        c.querySelector('.fh-set-t small').textContent = g.desc;
        c.querySelector('.fh-set-p span').textContent = g.sets.toLocaleString('de-DE') + ' ' + TX.sets + ' × ' + fmt(Math.round(g.total / g.sets)) + ' ' + TX.per;
        c.querySelector('.fh-set-p b').textContent = fmt(g.total);
        c.querySelector('a.ed').textContent = TX.edit;
        var tg = c.querySelector('.tg'); tg.textContent = open[g.k] ? TX.hide : TX.parts + ' (' + g.lines.length + ')';
        tg.onclick = function () { open[g.k] = !open[g.k]; paint(); };
        var rm = c.querySelector('.rm'); rm.textContent = TX.rm;
        rm.onclick = function () {
          if (busy) return; busy = true; rm.disabled = true;
          var u = {}; g.lines.forEach(function (l) { u[l.it.key] = 0; });
          fetch(ROOT + 'cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ updates: u }) })
            .then(function () { location.reload(); }).catch(function () { busy = false; rm.disabled = false; });
        };
        first.parentNode.insertBefore(tr, first);
      });
    });
  }

  /* Artikelzahl: ein Set zählt als Anzahl Sets (nicht Flakon + Sprühkopf + Kappe einzeln) */
  window.fhCartCount = function (c) { var n = 0, seen = {}; (c.items || []).forEach(function (it) { var p = it.properties || {}; if (p._set) { if (!seen[p._set]) { seen[p._set] = 1; n += +p._sets || it.quantity; } return; } n += /-1G$/i.test(it.sku || '') ? 1 : it.quantity; }); return n; };
  function bubble() { if (!cart) return; var n = window.fhCartCount(cart); document.querySelectorAll('#cart-icon-bubble .cart-count-bubble span[aria-hidden="true"]').forEach(function (el) { if (/^\d+$/.test(el.textContent.trim()) && el.textContent !== String(n)) el.textContent = String(n); }); }
  function load() { fetch(ROOT + 'cart.js', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (c) { cart = c; paint(); bubble(); }).catch(function () {}); }
  function own(m) { if (m.type === 'attributes') return true; var ns = [].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes)); return ns.length && ns.every(function (n) { return n.nodeType === 1 && n.classList && n.classList.contains('fh-set'); }) || (m.target.closest && m.target.closest('.fh-set')); }
  function start() {
    load();
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) if (!own(ms[i])) { clearTimeout(t); t = setTimeout(function () { paint(); bubble(); }, 80); return; }
    }).observe(document.body, { childList: true, subtree: true });
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') subscribe(PUB_SUB_EVENTS.cartUpdate, function () { setTimeout(load, 300); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
