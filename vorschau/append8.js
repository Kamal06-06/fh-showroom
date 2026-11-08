
/* ===== Warenkorb im Premium-Stil (fh-cart-luxe, Nov. 2026) ===== */
(function () { try { var m = document.createElement('meta'); m.name = 'color-scheme'; m.content = 'only light'; document.head.appendChild(m); var st = document.createElement('style'); st.id = 'fh-cart-luxe'; st.textContent = "/* Fragrance Hub \u2013 Warenkorb (Drawer) im ruhigen Premium-Stil + sanfte Hinzuf\u00fcgen-Bewegung */\ncart-drawer{--fh-ink:#1c2135;--fh-ivory:#fbf8f3;--fh-gold:#b8924a;--fh-gold-l:#d9bf7a;--fh-gold-soft:#f4ecdc;--fh-line:rgba(28,33,53,.09);--fh-muted:#6e6c67;--fh-ease:cubic-bezier(.22,1,.36,1)}\ncart-drawer .drawer__inner{background:var(--fh-ivory)!important;padding:0!important;width:44rem;max-width:calc(100vw - 2.4rem);border:0!important;box-shadow:-18px 0 50px rgba(28,33,53,.18)!important;transition:transform .45s var(--fh-ease),visibility .45s!important;display:flex!important;flex-direction:column;overflow:hidden}\ncart-drawer .drawer__overlay,cart-drawer .cart-drawer__overlay{transition:opacity .35s ease!important;background:rgba(18,20,28,.38)!important;backdrop-filter:blur(2px)}\n/* Kopf */\ncart-drawer .drawer__header{position:relative;display:flex!important;align-items:center;justify-content:space-between;padding:1.8rem 2rem 1.5rem!important;margin:0!important;border-bottom:1px solid var(--fh-line)}\ncart-drawer .drawer__heading{margin:0!important;font-size:2rem!important;letter-spacing:.01em;color:var(--fh-ink);white-space:nowrap;display:flex;align-items:baseline;gap:.8rem}\ncart-drawer .fh-cnt{font-size:1.35rem;font-family:var(--font-body-family);color:var(--fh-muted);letter-spacing:.02em}\ncart-drawer .drawer__close{position:static!important;width:4rem;height:4rem;border-radius:50%;display:grid;place-items:center;background:#fff!important;border:1px solid var(--fh-line)!important;transition:transform .2s ease,background .2s}\ncart-drawer .drawer__close:hover{transform:rotate(90deg)}\n/* \u201eHinzugef\u00fcgt\" als kurze Einblendung statt Block im Kopf */\ncart-drawer .fh-added{order:3;flex:0 0 100%;margin:1rem 0 0!important;padding:.9rem 1.2rem!important;border-radius:10px!important;background:#eef6f0!important;color:#25603f!important;font-size:1.3rem!important;font-weight:600;overflow:hidden;animation:fh-toast 5.6s var(--fh-ease) forwards}\ncart-drawer .drawer__header{flex-wrap:wrap}\n@keyframes fh-toast{0%{opacity:0;max-height:0;padding-block:0;margin-top:0}8%,85%{opacity:1;max-height:5rem}100%{opacity:0;max-height:0;padding-block:0;margin-top:0}}\n/* Positionen als ruhige Karten */\ncart-drawer cart-drawer-items{flex:1 1 auto;overflow:auto;padding:0 2rem!important;margin:0!important}\ncart-drawer .cart-items thead{display:none!important}\ncart-drawer .cart-items,cart-drawer .cart-items tbody{display:block!important;width:100%}\ncart-drawer .cart-item{display:grid!important;grid-template-columns:8.6rem minmax(0,1fr) auto!important;grid-template-areas:\"m d p\" \"m q q\"!important;gap:.4rem 1.4rem!important;padding:1.8rem 0!important;margin:0!important;border-bottom:1px solid var(--fh-line);border-radius:14px;transition:background-color 1.2s ease}\ncart-drawer .cart-item>td{display:block!important;padding:0!important}\ncart-drawer .cart-item__media{grid-area:m!important;width:8.6rem!important;position:relative}\ncart-drawer .cart-item__image{width:8.6rem!important;height:8.6rem!important;object-fit:cover;border-radius:12px;background:#fff;border:1px solid var(--fh-line)}\ncart-drawer .cart-item__details{grid-area:d!important;min-width:0}\ncart-drawer .cart-item__name{font-size:1.55rem!important;font-weight:600!important;color:var(--fh-ink)!important;text-decoration:none!important;line-height:1.3;display:block;margin-bottom:.3rem}\ncart-drawer .cart-item__details>.product-option:first-of-type{display:none} /* Einzelpreis doppelt \u2013 rechts steht der Zeilenpreis */\ncart-drawer .cart-item__details dl{margin:0;display:flex;flex-wrap:wrap;gap:0 .6rem;font-size:1.3rem;color:var(--fh-muted)}\ncart-drawer .cart-item__details dl .product-option{margin:0!important;display:flex;gap:.3rem;font-size:1.3rem!important;line-height:1.5}\ncart-drawer .cart-item__details dl dd{margin:0}\ncart-drawer .cart-item__details dl dt{opacity:.75}\ncart-drawer .cart-item__totals{grid-area:p!important;text-align:end;justify-self:end}\ncart-drawer .cart-item__totals .price{font-size:1.55rem!important;font-weight:700;color:var(--fh-ink);letter-spacing:.01em;white-space:nowrap}\ncart-drawer .cart-item__totals .unit-price{font-size:1.15rem;color:var(--fh-muted);margin-top:.2rem}\ncart-drawer .cart-item__quantity{grid-area:q!important;margin-top:.6rem}\ncart-drawer .cart-item__quantity-wrapper{display:flex!important;align-items:center;gap:1rem}\ncart-drawer .cart-item .quantity{min-height:3.8rem!important;width:11.6rem!important;border-radius:999px;background:#fff;box-shadow:inset 0 0 0 1px rgba(28,33,53,.16)}\ncart-drawer .cart-item .quantity:before,cart-drawer .cart-item .quantity:after{display:none!important}\ncart-drawer .cart-item .quantity__button{width:3.8rem!important;box-shadow:none!important;background:transparent!important}\ncart-drawer .quantity-popover-container{padding:0!important;border:0!important;box-shadow:none!important;width:auto!important}\ncart-drawer .quantity-popover-container:before,cart-drawer .quantity-popover-container:after,cart-drawer .quantity-popover-container--hover:hover:before{display:none!important}\ncart-drawer .cart-item .quantity__input{font-weight:600;font-size:1.45rem!important}\ncart-drawer .cart-remove-button{width:3.8rem!important;height:3.8rem!important;min-width:0!important;border-radius:50%!important;opacity:.55;transition:opacity .2s,background .2s}\ncart-drawer .cart-remove-button:hover{opacity:1;background:#fff!important}\ncart-drawer .cart-item.fh-new{animation:fh-glow 2.2s ease}\n@keyframes fh-glow{0%{background:var(--fh-gold-soft);box-shadow:0 0 0 .8rem var(--fh-gold-soft)}70%{background:var(--fh-gold-soft);box-shadow:0 0 0 .8rem var(--fh-gold-soft)}100%{background:transparent;box-shadow:0 0 0 .8rem transparent}}\n/* Fu\u00df */\ncart-drawer .drawer__footer{background:#fff!important;border-top:1px solid var(--fh-line)!important;padding:1.4rem 2rem 1.6rem!important;box-shadow:0 -10px 30px rgba(28,33,53,.05)}\ncart-drawer .fh-ship{background:var(--fh-gold-soft)!important;color:var(--fh-ink)!important;border-radius:12px!important;padding:.9rem 1.2rem!important;margin:0 0 1.2rem!important;font-weight:500;font-size:1.25rem!important}\ncart-drawer .fh-ship>div:last-child{background:rgba(184,146,74,.22)!important;height:5px!important;border-radius:99px!important}\ncart-drawer .fh-ship-b{background:linear-gradient(90deg,var(--fh-gold),var(--fh-gold-l))!important;border-radius:99px!important;transition:width .8s var(--fh-ease)}\ncart-drawer details#Details-CartDrawer{display:none!important} /* Hinweise werden im Warenkorb (Seite) angegeben */\ncart-drawer details#Details-CartDrawer summary{padding:.6rem 0!important;font-size:1.35rem;color:var(--fh-muted)}\ncart-drawer .cart-drawer__footer{padding:0!important;border:0!important}\ncart-drawer .totals{display:flex!important;justify-content:space-between;align-items:baseline;margin:.4rem 0 0!important}\ncart-drawer .totals__total{font-size:1.5rem!important;font-family:var(--font-body-family)!important;color:var(--fh-ink);margin:0!important}\ncart-drawer .totals__total-value{font-size:2.2rem!important;font-weight:700;color:var(--fh-ink);margin:0!important;letter-spacing:.01em}\ncart-drawer .tax-note{display:none!important}\ncart-drawer .fh-net{margin:.2rem 0 1.2rem!important;font-size:1.2rem!important;color:var(--fh-muted)!important}\ncart-drawer .cart__ctas{display:block!important;margin:0!important}\ncart-drawer .fh-to-cart{display:flex!important;align-items:center;justify-content:center;gap:1rem;width:100%!important;min-height:5.4rem!important;border-radius:14px!important;background:var(--fh-ink)!important;color:var(--fh-gold-l)!important;font-size:1.65rem!important;letter-spacing:.04em;box-shadow:0 10px 24px rgba(28,33,53,.22);transition:transform .2s ease,box-shadow .2s ease}\ncart-drawer .fh-to-cart:after{display:none!important}\ncart-drawer .fh-to-cart:hover{transform:translateY(-1px);box-shadow:0 14px 30px rgba(28,33,53,.28)}\ncart-drawer .fh-to-cart .fh-arr{transition:transform .25s ease;display:inline-block}\ncart-drawer .fh-to-cart:hover .fh-arr{transform:translateX(4px)}\n[dir=rtl] cart-drawer .fh-to-cart .fh-arr{transform:scaleX(-1)}\ncart-drawer .fh-to-cart-info{margin:.8rem 0 0!important;font-size:1.15rem!important;color:var(--fh-muted)!important;text-align:center}\n/* leerer Warenkorb */\ncart-drawer .cart__empty-text{font-size:2rem!important;color:var(--fh-ink)}\n/* Button \u201eIn den Warenkorb\" \u2013 kurze Best\u00e4tigung */\n.product-form__submit.fh-ok{background:#2f6b4f!important;color:#fff!important;transition:background .3s ease}\n.product-form__submit.fh-ok:after{box-shadow:none!important}\n.product-form__submit .fh-ok-t{display:inline-flex;align-items:center;gap:.6rem;animation:fh-pop .35s var(--fh-ease,ease)}\n@keyframes fh-pop{0%{transform:scale(.85);opacity:0}100%{transform:none;opacity:1}}\n/* Warenkorb-Symbol: kleiner Puls */\n#cart-icon-bubble.fh-bump .cart-count-bubble,#cart-icon-bubble.fh-bump svg{animation:fh-bump .6s cubic-bezier(.22,1,.36,1)}\n@keyframes fh-bump{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}\n@media (max-width:749px){cart-drawer .drawer__inner{width:100%;max-width:100vw}cart-drawer .drawer__header{padding:1.5rem 1.6rem 1.3rem!important}cart-drawer cart-drawer-items{padding:0 1.6rem!important}cart-drawer .drawer__footer{padding:1.4rem 1.6rem calc(1.6rem + env(safe-area-inset-bottom))!important}cart-drawer .cart-item{grid-template-columns:7.6rem minmax(0,1fr) auto!important}cart-drawer .cart-item__media,cart-drawer .cart-item__image{width:7.6rem!important;height:7.6rem!important}cart-drawer .fh-trust{font-size:1.05rem}}\n@media (prefers-reduced-motion:reduce){cart-drawer *,.product-form__submit,#cart-icon-bubble *{animation:none!important;transition:none!important}}\n\n/* Warenkorb-Symbol: Anzahl gut lesbar */\n#cart-icon-bubble .cart-count-bubble{min-width:2.1rem!important;width:auto!important;height:2.1rem!important;padding:0 .5rem!important;border-radius:999px!important;font-size:1.2rem!important;font-weight:700!important;line-height:1!important;background:#b8862f!important;color:#fff!important;-webkit-text-fill-color:#fff!important;border:2px solid #1f2433!important;text-shadow:0 1px 1px rgba(0,0,0,.25)!important;forced-color-adjust:none!important;bottom:.2rem!important;right:-.2rem!important;letter-spacing:0!important}#cart-icon-bubble .cart-count-bubble span[aria-hidden]{font-size:1.2rem!important;width:auto!important}\n\n/* automatischen Dunkelmodus des Handy-Browsers verhindern (machte die Zahl unsichtbar) */\n:root{color-scheme:only light}\n"; (document.head || document.documentElement).appendChild(st); } catch (e) {} })();
/* Fragrance Hub – ruhige Rückmeldung beim Hinzufügen + Warenkorb-Details (ergänzt proben-gramm.js, ändert dessen Logik nicht) */
(function () {
  var LG = (document.documentElement.lang || 'de').slice(0, 2);
  var T = {
    de: { ok: 'Hinzugefügt', items: function (n) { return n === 1 ? '1 Artikel' : n + ' Artikel'; } },
    en: { ok: 'Added', items: function (n) { return n === 1 ? '1 item' : n + ' items'; } },
    ar: { ok: 'تمت الإضافة', items: function (n) { return n === 1 ? 'منتج واحد' : n + ' منتجات'; } }
  }[LG] || null;
  if (!T) T = { ok: 'Hinzugefügt', items: function (n) { return n + ' Artikel'; } };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var count = 0, justAdded = 0, btn = null, quiet = 0, flyImg = null;

  /* Nach „In den Warenkorb" bleibt der Warenkorb zu – das Produkt „fliegt" zum Warenkorb-Symbol */
  if (window.customElements) customElements.whenDefined('cart-drawer').then(function () {
    var C = customElements.get('cart-drawer'), o = C && C.prototype.open;
    if (!o || C.prototype.__fhQuiet) return;
    C.prototype.__fhQuiet = 1;
    C.prototype.open = function () { if (Date.now() < quiet) return; return o.apply(this, arguments); };
  });
  function fly() {
    var to = document.getElementById('cart-icon-bubble'), from = btn;
    if (reduce || !to || !from || !from.getBoundingClientRect) return bump();
    var a = from.getBoundingClientRect(), z = to.getBoundingClientRect(), S = 56;
    var el = document.createElement('div');
    el.style.cssText = 'position:fixed;z-index:2147483000;pointer-events:none;width:' + S + 'px;height:' + S + 'px;border-radius:50%;overflow:hidden;' +
      'left:' + (a.left + a.width / 2 - S / 2) + 'px;top:' + (a.top + a.height / 2 - S / 2) + 'px;background:#f4ecdc;box-shadow:0 8px 24px rgba(28,33,53,.28);border:2px solid #fff';
    if (flyImg) { var im = document.createElement('img'); im.src = flyImg; im.style.cssText = 'width:100%;height:100%;object-fit:cover'; el.appendChild(im); }
    document.body.appendChild(el);
    var dx = z.left + z.width / 2 - (a.left + a.width / 2), dy = Math.max(8, z.top + z.height / 2) - (a.top + a.height / 2);
    var an = el.animate([
      { transform: 'translate(0,0) scale(1)', opacity: 1 },
      { transform: 'translate(' + dx * 0.5 + 'px,' + (dy * 0.5 - 60) + 'px) scale(.8)', opacity: 1, offset: .55 },
      { transform: 'translate(' + dx + 'px,' + dy + 'px) scale(.18)', opacity: .6 }
    ], { duration: 750, easing: 'cubic-bezier(.45,0,.2,1)' });
    an.onfinish = function () { el.remove(); bump(); };
  }

  function decorate() {
    var d = document.querySelector('cart-drawer'); if (!d) return;
    var h = d.querySelector('.drawer__heading');
    if (h) {
      var c = h.querySelector('.fh-cnt');
      if (!c) { c = document.createElement('span'); c.className = 'fh-cnt'; h.appendChild(c); }
      var txt = count ? '· ' + T.items(count) : '';
      if (c.textContent !== txt) c.textContent = txt;
    }
    var a = d.querySelector('.fh-to-cart');
    if (a && !a.querySelector('.fh-arr')) { var s = document.createElement('span'); s.className = 'fh-arr'; s.setAttribute('aria-hidden', 'true'); s.textContent = '→'; a.appendChild(s); }
    if (justAdded && Date.now() - justAdded < 1500) {
      var first = d.querySelector('.cart-item');
      if (first && !first.classList.contains('fh-new')) { first.classList.add('fh-new'); setTimeout(function () { first.classList.remove('fh-new'); }, 2300); }
    }
  }

  function readCount() {
    fetch('/cart.js', { headers: { Accept: 'application/json' } }).then(function (r) { return r.json(); }).then(function (c) {
      var n = 0; if (window.fhCartCount) n = window.fhCartCount(c); else (c.items || []).forEach(function (it) { n += /-1G$/i.test(it.sku || '') ? 1 : it.quantity; });
      count = n; decorate();
    }).catch(function () {});
  }

  /* Knopf „In den Warenkorb": kurzer, ruhiger Bestätigungszustand */
  document.addEventListener('submit', function (e) {
    var f = e.target; if (!f || !f.matches || !f.matches('form[action*="/cart/add"]')) return;
    btn = f.querySelector('.product-form__submit') || (f.id && document.querySelector('[form="' + f.id + '"].product-form__submit'));
    quiet = Date.now() + 6000;
    var root = f.closest('quick-add-modal, product-info, section') || document, im = root.querySelector('.product__media img, .product-media-container img, img');
    flyImg = im ? (im.currentSrc || im.src) : null;
  }, true);
  function confirmBtn() {
    var b = btn; if (!b) return;
    var span = b.querySelector('span:not(.loading__spinner):not(.visually-hidden)'); if (!span) return;
    var old = span.innerHTML;
    setTimeout(function () {
      b.classList.add('fh-ok');
      span.innerHTML = '<span class="fh-ok-t"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' + T.ok + '</span>';
      setTimeout(function () { b.classList.remove('fh-ok'); span.innerHTML = old; }, 1800);
    }, 80);
  }
  function bump() {
    if (reduce) return;
    var ic = document.getElementById('cart-icon-bubble'); if (!ic) return;
    ic.classList.remove('fh-bump'); void ic.offsetWidth; ic.classList.add('fh-bump');
    setTimeout(function () { ic.classList.remove('fh-bump'); }, 700);
  }

  document.addEventListener('DOMContentLoaded', function () {
    readCount();
    var tm; new MutationObserver(function () { clearTimeout(tm); tm = setTimeout(decorate, 40); })
      .observe(document.body, { childList: true, subtree: true });
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, function (ev) {
        if (ev && ev.source === 'product-form') { justAdded = Date.now(); confirmBtn(); fly(); setTimeout(function () { btn = null; quiet = 0; }, 1500); }
        setTimeout(readCount, 250);
      });
    }
  });
})();

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
      if (!g[k]) { g[k] = { k: k, lines: [], name: p._name || p['Flakon-Set'] || 'Flakon-Set', sets: +p._sets || 0, p: p }; order.push(k); }
      g[k].lines.push({ it: it, i: i + 1 });
    });
    return order.map(function (k) {
      var x = g[k];
      if (x.lines.length < 2) return null;
      x.total = x.lines.reduce(function (a, l) { return a + l.it.final_line_price; }, 0);
      /* Rollen sprachunabhängig über Artikelnummer/Handle (Titel sind übersetzt) */
      var isSp = function (l) { return /^EASY/i.test(l.it.sku || '') || /spruehkopf|spruhkopf/i.test(l.it.handle || ''); };
      var isCap = function (l) { return /kappe|parfuemkappe|parfumkappe/i.test(l.it.handle || '') || /^(TY|KP-)/i.test(l.it.sku || ''); };
      var fl = x.lines.filter(function (l) { return !isSp(l) && !isCap(l); })[0] || x.lines[0], rest = x.lines.filter(function (l) { return l !== fl; });
      var sps = rest.filter(isSp), caps = rest.filter(function (l) { return !isSp(l) && isCap(l); });
      var nm = function (l) { var o = (l.it.options_with_values || [])[0]; return (o && o.value) || (l.it.variant_title || '').replace(/^Default Title$/, '') || l.it.product_title; };
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
