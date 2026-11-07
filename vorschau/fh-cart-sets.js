/* Fragrance Hub – Flakon-Sets im Warenkorb (Drawer + Warenkorbseite) als EINE Position anzeigen.
   Flakon, Sprühkopf und Kappe(n) bleiben einzelne Warenkorbzeilen (Artikelnummern, Lager, Kasse) –
   sie werden nur gemeinsam dargestellt: Anzahl Sets, Preis je Set, Summe, Bestandteile zum Aufklappen. */
(function () {
  var LG = (document.documentElement.lang || 'de').slice(0, 2);
  var TX = {
    de: { sets: 'Sets', per: 'je Set', parts: 'Bestandteile', hide: 'Bestandteile ausblenden', rm: 'Set entfernen', mixed: 'Kappen gemischt', edit: 'Neues Set zusammenstellen' },
    en: { sets: 'sets', per: 'per set', parts: 'Components', hide: 'Hide components', rm: 'Remove set', mixed: 'Mixed caps', edit: 'Configure another set' },
    ar: { sets: 'طقم', per: 'للطقم', parts: 'المكوّنات', hide: 'إخفاء المكوّنات', rm: 'حذف الطقم', mixed: 'أغطية مختلطة', edit: 'تركيب طقم جديد' }
  }[LG] || null;
  if (!TX) TX = { sets: 'Sets', per: 'je Set', parts: 'Bestandteile', hide: 'Bestandteile ausblenden', rm: 'Set entfernen', mixed: 'Kappen gemischt', edit: 'Neues Set zusammenstellen' };
  var fmt = function (c) { return (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }); };
  var cart = null, open = {}, busy = false, t;

  if (!document.getElementById('fh-sets-css')) {
    var st = document.createElement('style'); st.id = 'fh-sets-css';
    st.textContent =
      '.fh-set td{padding:0!important;border:0!important}' +
      '.fh-set-c{border:1.5px solid #d9bf7a;border-radius:14px;background:#fffdf8;padding:14px 14px 12px;margin:12px 0 4px}' +
      '.fh-set-h{display:flex;gap:12px;align-items:center}.fh-set-h img{width:64px;height:64px;object-fit:cover;border-radius:10px;background:#fff;border:1px solid rgba(28,33,53,.08)}' +
      '.fh-set-t{flex:1;min-width:0}.fh-set-t b{display:block;font-size:1.5rem;color:#1c2135}.fh-set-t small{display:block;font-size:1.25rem;color:#6e6c67;line-height:1.4}' +
      '.fh-set-p{display:flex;justify-content:space-between;align-items:baseline;margin-top:10px;font-size:1.35rem;color:#1c2135}.fh-set-p b{font-size:1.6rem}' +
      '.fh-set-a{display:flex;gap:14px;margin-top:8px;font-size:1.25rem}.fh-set-a button{background:none;border:0;padding:0;color:#1c2135;text-decoration:underline;text-underline-offset:3px;cursor:pointer;font:inherit}.fh-set-a button.rm{color:#a3460f}' +
      'tr.fh-set-part{display:none!important}tr.fh-set-part.fh-show{display:table-row!important}cart-drawer tr.fh-set-part.fh-show{display:grid!important}' +
      'tr.fh-set-part.fh-show{background:#fbf8f1}';
    document.head.appendChild(st);
  }

  function groups(c) {
    var g = {}, order = [];
    (c.items || []).forEach(function (it, i) {
      var p = it.properties || {}, k = p._set || p['Flakon-Set'];
      if (!k) return;
      if (!g[k]) { g[k] = { k: k, lines: [], name: p['Flakon-Set'] || 'Flakon-Set', sets: +p._sets || 0 }; order.push(k); }
      g[k].lines.push({ it: it, i: i + 1 });
    });
    return order.map(function (k) {
      var x = g[k];
      if (x.lines.length < 2) return null;
      if (!x.sets) x.sets = Math.min.apply(null, x.lines.slice(1).map(function (l) { return l.it.quantity; }));
      x.total = x.lines.reduce(function (a, l) { return a + l.it.final_line_price; }, 0);
      var sp = x.lines.filter(function (l) { return /spr(ü|u)hkopf/i.test(l.it.product_title); })[0];
      var caps = x.lines.filter(function (l) { return /kappe/i.test(l.it.product_title); });
      var nm = function (l) { return (l.it.variant_title || '').replace(/^Default Title$/, '') || l.it.product_title.replace(/^Parf(ü|u)mkappe\s*/i, ''); };
      x.desc = [sp ? 'Sprühkopf ' + nm(sp) : '', caps.length > 1 ? TX.mixed + ': ' + caps.map(function (l) { return nm(l) + ' ×' + l.it.quantity; }).join(', ') : caps.length ? 'Kappe ' + nm(caps[0]) : ''].filter(Boolean).join(' · ');
      x.img = (x.lines[0].it.image || '');
      return x;
    }).filter(Boolean);
  }

  function rowsIn(root, i) { var r = root.querySelector('#CartDrawer-Item-' + i + ', #CartItem-' + i); return r; }

  function paint() {
    if (!cart) return;
    var gs = groups(cart);
    [document.querySelector('cart-drawer'), document.querySelector('cart-items:not(cart-drawer-items)'), document.querySelector('#main-cart-items')].forEach(function (root) {
      if (!root) return;
      root.querySelectorAll('tr.fh-set').forEach(function (x) { x.remove(); });
      root.querySelectorAll('tr.fh-set-part').forEach(function (x) { x.classList.remove('fh-set-part', 'fh-show'); });
      gs.forEach(function (g) {
        var first = rowsIn(root, g.lines[0].i); if (!first) return;
        g.lines.forEach(function (l) { var r = rowsIn(root, l.i); if (r) { r.classList.add('fh-set-part'); r.classList.toggle('fh-show', !!open[g.k]); } });
        var tr = document.createElement('tr'); tr.className = 'fh-set';
        var td = document.createElement('td'); td.colSpan = 5; tr.appendChild(td);
        var c = document.createElement('div'); c.className = 'fh-set-c'; td.appendChild(c);
        c.innerHTML = '<div class="fh-set-h">' + (g.img ? '<img src="' + g.img + (g.img.indexOf('?') > -1 ? '&' : '?') + 'width=160" alt="">' : '') +
          '<div class="fh-set-t"><b></b><small></small></div></div>' +
          '<div class="fh-set-p"><span></span><b></b></div><div class="fh-set-a"><button type="button" class="tg"></button><button type="button" class="rm"></button></div>';
        c.querySelector('.fh-set-t b').textContent = g.name;
        c.querySelector('.fh-set-t small').textContent = g.desc;
        c.querySelector('.fh-set-p span').textContent = g.sets.toLocaleString('de-DE') + ' ' + TX.sets + ' × ' + fmt(Math.round(g.total / g.sets)) + ' ' + TX.per;
        c.querySelector('.fh-set-p b').textContent = fmt(g.total);
        var tg = c.querySelector('.tg'); tg.textContent = open[g.k] ? TX.hide : TX.parts + ' (' + g.lines.length + ')';
        tg.onclick = function () { open[g.k] = !open[g.k]; paint(); };
        var rm = c.querySelector('.rm'); rm.textContent = TX.rm;
        rm.onclick = function () {
          if (busy) return; busy = true; rm.disabled = true;
          var u = {}; g.lines.forEach(function (l) { u[l.it.key] = 0; });
          fetch('/cart/update.js', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ updates: u }) })
            .then(function () { location.reload(); }).catch(function () { busy = false; rm.disabled = false; });
        };
        first.parentNode.insertBefore(tr, first);
      });
    });
  }

  function load() { fetch('/cart.js', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (c) { cart = c; paint(); }).catch(function () {}); }
  function own(m) { var ns = [].slice.call(m.addedNodes).concat([].slice.call(m.removedNodes)); return ns.length && ns.every(function (n) { return n.nodeType === 1 && n.classList && n.classList.contains('fh-set'); }) || (m.target.closest && m.target.closest('.fh-set')); }
  function start() {
    load();
    new MutationObserver(function (ms) {
      for (var i = 0; i < ms.length; i++) if (!own(ms[i])) { clearTimeout(t); t = setTimeout(paint, 80); return; }
    }).observe(document.body, { childList: true, subtree: true });
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') subscribe(PUB_SUB_EVENTS.cartUpdate, function () { setTimeout(load, 300); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
