/* Fragrance Hub – ruhige Rückmeldung beim Hinzufügen + Warenkorb-Details (ergänzt proben-gramm.js, ändert dessen Logik nicht) */
(function () {
  var LG = (document.documentElement.lang || 'de').slice(0, 2);
  var T = {
    de: { ok: 'Hinzugefügt', items: function (n) { return n === 1 ? '1 Artikel' : n + ' Artikel'; }, t1: 'Sichere Zahlung', t2: 'Versand am selben Werktag', t3: 'Persönlicher Service' },
    en: { ok: 'Added', items: function (n) { return n === 1 ? '1 item' : n + ' items'; }, t1: 'Secure payment', t2: 'Same-day dispatch', t3: 'Personal service' },
    ar: { ok: 'تمت الإضافة', items: function (n) { return n === 1 ? 'منتج واحد' : n + ' منتجات'; }, t1: 'دفع آمن', t2: 'شحن في نفس يوم العمل', t3: 'خدمة شخصية' }
  }[LG] || null;
  if (!T) T = { ok: 'Hinzugefügt', items: function (n) { return n + ' Artikel'; }, t1: 'Sichere Zahlung', t2: 'Versand am selben Werktag', t3: 'Persönlicher Service' };
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  var ic = {
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4.5" y="10.5" width="15" height="10" rx="2"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/></svg>',
    truck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M2.5 6.5h11v10h-11zM13.5 10h4l3 3.2v3.3h-7"/><circle cx="6.5" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 5.5h16v10H9l-5 4z"/></svg>'
  };
  var count = 0, justAdded = 0, btn = null;

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
    var info = d.querySelector('.fh-to-cart-info');
    if (info && !d.querySelector('.fh-trust')) {
      var t = document.createElement('div'); t.className = 'fh-trust';
      t.innerHTML = '<span>' + ic.lock + T.t1 + '</span><span>' + ic.truck + T.t2 + '</span><span>' + ic.chat + T.t3 + '</span>';
      info.parentNode.insertBefore(t, info.nextSibling);
    }
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
  }, true);
  function confirmBtn() {
    var b = btn; btn = null; if (!b) return;
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

  (function () {
    readCount();
    var tm; new MutationObserver(function () { clearTimeout(tm); tm = setTimeout(decorate, 40); })
      .observe(document.body, { childList: true, subtree: true });
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, function (ev) {
        if (ev && ev.source === 'product-form') { justAdded = Date.now(); confirmBtn(); bump(); }
        setTimeout(readCount, 250);
      });
    }
  })();
})();
