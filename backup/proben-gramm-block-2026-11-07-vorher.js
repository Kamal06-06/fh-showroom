
/* ===== Warenkorb im Premium-Stil (fh-cart-luxe, Nov. 2026) ===== */
(function () { try { var st = document.createElement('style'); st.id = 'fh-cart-luxe'; st.textContent = "/* Fragrance Hub \u2013 Warenkorb (Drawer) im ruhigen Premium-Stil + sanfte Hinzuf\u00fcgen-Bewegung */\ncart-drawer{--fh-ink:#1c2135;--fh-ivory:#fbf8f3;--fh-gold:#b8924a;--fh-gold-l:#d9bf7a;--fh-gold-soft:#f4ecdc;--fh-line:rgba(28,33,53,.09);--fh-muted:#6e6c67;--fh-ease:cubic-bezier(.22,1,.36,1)}\ncart-drawer .drawer__inner{background:var(--fh-ivory)!important;padding:0!important;width:44rem;max-width:calc(100vw - 2.4rem);border:0!important;box-shadow:-18px 0 50px rgba(28,33,53,.18)!important;transition:transform .45s var(--fh-ease),visibility .45s!important;display:flex!important;flex-direction:column;overflow:hidden}\ncart-drawer .drawer__overlay,cart-drawer .cart-drawer__overlay{transition:opacity .35s ease!important;background:rgba(18,20,28,.38)!important;backdrop-filter:blur(2px)}\n/* Kopf */\ncart-drawer .drawer__header{position:relative;display:flex!important;align-items:center;justify-content:space-between;padding:1.8rem 2rem 1.5rem!important;margin:0!important;border-bottom:1px solid var(--fh-line)}\ncart-drawer .drawer__heading{margin:0!important;font-size:2rem!important;letter-spacing:.01em;color:var(--fh-ink);white-space:nowrap;display:flex;align-items:baseline;gap:.8rem}\ncart-drawer .fh-cnt{font-size:1.35rem;font-family:var(--font-body-family);color:var(--fh-muted);letter-spacing:.02em}\ncart-drawer .drawer__close{position:static!important;width:4rem;height:4rem;border-radius:50%;display:grid;place-items:center;background:#fff!important;border:1px solid var(--fh-line)!important;transition:transform .2s ease,background .2s}\ncart-drawer .drawer__close:hover{transform:rotate(90deg)}\n/* \u201eHinzugef\u00fcgt\" als kurze Einblendung statt Block im Kopf */\ncart-drawer .fh-added{order:3;flex:0 0 100%;margin:1rem 0 0!important;padding:.9rem 1.2rem!important;border-radius:10px!important;background:#eef6f0!important;color:#25603f!important;font-size:1.3rem!important;font-weight:600;overflow:hidden;animation:fh-toast 5.6s var(--fh-ease) forwards}\ncart-drawer .drawer__header{flex-wrap:wrap}\n@keyframes fh-toast{0%{opacity:0;max-height:0;padding-block:0;margin-top:0}8%,85%{opacity:1;max-height:5rem}100%{opacity:0;max-height:0;padding-block:0;margin-top:0}}\n/* Positionen als ruhige Karten */\ncart-drawer cart-drawer-items{flex:1 1 auto;overflow:auto;padding:0 2rem!important;margin:0!important}\ncart-drawer .cart-items thead{display:none!important}\ncart-drawer .cart-items,cart-drawer .cart-items tbody{display:block!important;width:100%}\ncart-drawer .cart-item{display:grid!important;grid-template-columns:8.6rem minmax(0,1fr) auto!important;grid-template-areas:\"m d p\" \"m q q\"!important;gap:.4rem 1.4rem!important;padding:1.8rem 0!important;margin:0!important;border-bottom:1px solid var(--fh-line);border-radius:14px;transition:background-color 1.2s ease}\ncart-drawer .cart-item>td{display:block!important;padding:0!important}\ncart-drawer .cart-item__media{grid-area:m!important;width:8.6rem!important;position:relative}\ncart-drawer .cart-item__image{width:8.6rem!important;height:8.6rem!important;object-fit:cover;border-radius:12px;background:#fff;border:1px solid var(--fh-line)}\ncart-drawer .cart-item__details{grid-area:d!important;min-width:0}\ncart-drawer .cart-item__name{font-size:1.55rem!important;font-weight:600!important;color:var(--fh-ink)!important;text-decoration:none!important;line-height:1.3;display:block;margin-bottom:.3rem}\ncart-drawer .cart-item__details>.product-option:first-of-type{display:none} /* Einzelpreis doppelt \u2013 rechts steht der Zeilenpreis */\ncart-drawer .cart-item__details dl{margin:0;display:flex;flex-wrap:wrap;gap:0 .6rem;font-size:1.3rem;color:var(--fh-muted)}\ncart-drawer .cart-item__details dl .product-option{margin:0!important;display:flex;gap:.3rem;font-size:1.3rem!important;line-height:1.5}\ncart-drawer .cart-item__details dl dd{margin:0}\ncart-drawer .cart-item__details dl dt{opacity:.75}\ncart-drawer .cart-item__totals{grid-area:p!important;text-align:end;justify-self:end}\ncart-drawer .cart-item__totals .price{font-size:1.55rem!important;font-weight:700;color:var(--fh-ink);letter-spacing:.01em;white-space:nowrap}\ncart-drawer .cart-item__totals .unit-price{font-size:1.15rem;color:var(--fh-muted);margin-top:.2rem}\ncart-drawer .cart-item__quantity{grid-area:q!important;margin-top:.6rem}\ncart-drawer .cart-item__quantity-wrapper{display:flex!important;align-items:center;gap:1rem}\ncart-drawer .cart-item .quantity{min-height:3.8rem!important;width:11.6rem!important;border-radius:999px;background:#fff;box-shadow:inset 0 0 0 1px rgba(28,33,53,.16)}\ncart-drawer .cart-item .quantity:before,cart-drawer .cart-item .quantity:after{display:none!important}\ncart-drawer .cart-item .quantity__button{width:3.8rem!important;box-shadow:none!important;background:transparent!important}\ncart-drawer .quantity-popover-container{padding:0!important;border:0!important;box-shadow:none!important;width:auto!important}\ncart-drawer .quantity-popover-container:before,cart-drawer .quantity-popover-container:after,cart-drawer .quantity-popover-container--hover:hover:before{display:none!important}\ncart-drawer .cart-item .quantity__input{font-weight:600;font-size:1.45rem!important}\ncart-drawer .cart-remove-button{width:3.8rem!important;height:3.8rem!important;min-width:0!important;border-radius:50%!important;opacity:.55;transition:opacity .2s,background .2s}\ncart-drawer .cart-remove-button:hover{opacity:1;background:#fff!important}\ncart-drawer .cart-item.fh-new{animation:fh-glow 2.2s ease}\n@keyframes fh-glow{0%{background:var(--fh-gold-soft);box-shadow:0 0 0 .8rem var(--fh-gold-soft)}70%{background:var(--fh-gold-soft);box-shadow:0 0 0 .8rem var(--fh-gold-soft)}100%{background:transparent;box-shadow:0 0 0 .8rem transparent}}\n/* Fu\u00df */\ncart-drawer .drawer__footer{background:#fff!important;border-top:1px solid var(--fh-line)!important;padding:1.4rem 2rem 1.6rem!important;box-shadow:0 -10px 30px rgba(28,33,53,.05)}\ncart-drawer .fh-ship{background:var(--fh-gold-soft)!important;color:var(--fh-ink)!important;border-radius:12px!important;padding:.9rem 1.2rem!important;margin:0 0 1.2rem!important;font-weight:500;font-size:1.25rem!important}\ncart-drawer .fh-ship>div:last-child{background:rgba(184,146,74,.22)!important;height:5px!important;border-radius:99px!important}\ncart-drawer .fh-ship-b{background:linear-gradient(90deg,var(--fh-gold),var(--fh-gold-l))!important;border-radius:99px!important;transition:width .8s var(--fh-ease)}\ncart-drawer details#Details-CartDrawer{display:none!important} /* Hinweise werden im Warenkorb (Seite) angegeben */\ncart-drawer details#Details-CartDrawer summary{padding:.6rem 0!important;font-size:1.35rem;color:var(--fh-muted)}\ncart-drawer .cart-drawer__footer{padding:0!important;border:0!important}\ncart-drawer .totals{display:flex!important;justify-content:space-between;align-items:baseline;margin:.4rem 0 0!important}\ncart-drawer .totals__total{font-size:1.5rem!important;font-family:var(--font-body-family)!important;color:var(--fh-ink);margin:0!important}\ncart-drawer .totals__total-value{font-size:2.2rem!important;font-weight:700;color:var(--fh-ink);margin:0!important;letter-spacing:.01em}\ncart-drawer .tax-note{display:none!important}\ncart-drawer .fh-net{margin:.2rem 0 1.2rem!important;font-size:1.2rem!important;color:var(--fh-muted)!important}\ncart-drawer .cart__ctas{display:block!important;margin:0!important}\ncart-drawer .fh-to-cart{display:flex!important;align-items:center;justify-content:center;gap:1rem;width:100%!important;min-height:5.4rem!important;border-radius:14px!important;background:var(--fh-ink)!important;color:var(--fh-gold-l)!important;font-size:1.65rem!important;letter-spacing:.04em;box-shadow:0 10px 24px rgba(28,33,53,.22);transition:transform .2s ease,box-shadow .2s ease}\ncart-drawer .fh-to-cart:after{display:none!important}\ncart-drawer .fh-to-cart:hover{transform:translateY(-1px);box-shadow:0 14px 30px rgba(28,33,53,.28)}\ncart-drawer .fh-to-cart .fh-arr{transition:transform .25s ease;display:inline-block}\ncart-drawer .fh-to-cart:hover .fh-arr{transform:translateX(4px)}\n[dir=rtl] cart-drawer .fh-to-cart .fh-arr{transform:scaleX(-1)}\ncart-drawer .fh-to-cart-info{margin:.8rem 0 0!important;font-size:1.15rem!important;color:var(--fh-muted)!important;text-align:center}\n/* leerer Warenkorb */\ncart-drawer .cart__empty-text{font-size:2rem!important;color:var(--fh-ink)}\n/* Button \u201eIn den Warenkorb\" \u2013 kurze Best\u00e4tigung */\n.product-form__submit.fh-ok{background:#2f6b4f!important;color:#fff!important;transition:background .3s ease}\n.product-form__submit.fh-ok:after{box-shadow:none!important}\n.product-form__submit .fh-ok-t{display:inline-flex;align-items:center;gap:.6rem;animation:fh-pop .35s var(--fh-ease,ease)}\n@keyframes fh-pop{0%{transform:scale(.85);opacity:0}100%{transform:none;opacity:1}}\n/* Warenkorb-Symbol: kleiner Puls */\n#cart-icon-bubble.fh-bump .cart-count-bubble,#cart-icon-bubble.fh-bump svg{animation:fh-bump .6s cubic-bezier(.22,1,.36,1)}\n@keyframes fh-bump{0%{transform:scale(1)}35%{transform:scale(1.28)}100%{transform:scale(1)}}\n@media (max-width:749px){cart-drawer .drawer__inner{width:100%;max-width:100vw}cart-drawer .drawer__header{padding:1.5rem 1.6rem 1.3rem!important}cart-drawer cart-drawer-items{padding:0 1.6rem!important}cart-drawer .drawer__footer{padding:1.4rem 1.6rem calc(1.6rem + env(safe-area-inset-bottom))!important}cart-drawer .cart-item{grid-template-columns:7.6rem minmax(0,1fr) auto!important}cart-drawer .cart-item__media,cart-drawer .cart-item__image{width:7.6rem!important;height:7.6rem!important}cart-drawer .fh-trust{font-size:1.05rem}}\n@media (prefers-reduced-motion:reduce){cart-drawer *,.product-form__submit,#cart-icon-bubble *{animation:none!important;transition:none!important}}\n"; (document.head || document.documentElement).appendChild(st); } catch (e) {} })();
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
      var n = 0; (c.items || []).forEach(function (it) { n += /-1G$/i.test(it.sku || '') ? 1 : it.quantity; });
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
