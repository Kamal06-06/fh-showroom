/* Fragrance Hub – Proben als Varianten „Probe 6 g“ … „Probe 15 g“
   Jede Probe = 1 Artikel (Menge = Anzahl Fläschchen). Auf der Produktseite wird statt
   10 einzelner Knöpfe ein Feld „Probe (6–15 g)“ mit Gramm-Zähler gezeigt. */
(function () {
  var RX = /^\s*Probe\s+(\d+)\s*g\s*$/i, MIN = 6, MAX = 15;
  var LG = (document.documentElement.lang || 'de').slice(0, 2);
  var DICT = {
    de: { pill: 'Probe (6–15 g)', grams: 'Gramm je Fläschchen', bottles: 'Anzahl Fläschchen', hint: 'Wählen Sie 6–15 g pro Fläschchen. Jedes Fläschchen zählt als 1 Artikel.' },
    en: { pill: 'Sample (6–15 g)', grams: 'Grams per bottle', bottles: 'Number of bottles', hint: 'Choose 6–15 g per bottle. Each bottle counts as 1 item.' },
    ar: { pill: 'عينة (6–15 غ)', grams: 'الغرامات لكل عبوة', bottles: 'عدد العبوات', hint: 'اختر 6–15 غ لكل عبوة. كل عبوة تُحسب قطعة واحدة.' }
  };
  var T = DICT[LG] || DICT.de;

  function grams(v) { var m = RX.exec(v || ''); return m ? parseInt(m[1], 10) : 0; }
  function setLabelText(label, txt) {
    if (!label) return;
    var main = label.querySelector('.fh-vp-main');
    if (main) { setT(main, txt); return; }
    for (var i = 0; i < label.childNodes.length; i++) {
      var n = label.childNodes[i];
      if (n.nodeType === 3 && n.textContent.trim()) { if (n.textContent.trim() !== txt) n.textContent = txt; return; }
    }
    if (label.dataset.fhPill !== '1') { label.insertBefore(document.createTextNode(txt), label.firstChild); }
  }
  function setT(el, s) { if (el && el.textContent !== s) el.textContent = s; }
  function show(el, on) { if (!el) return; var cur = el.style.getPropertyValue('display'); if (on) { if (cur) el.style.removeProperty('display'); } else if (cur !== 'none') el.style.setProperty('display', 'none', 'important'); }

  function stepper(anchor, g, onStep) {
    var root = anchor.parentNode;
    var box = root.querySelector(':scope > .fh-pv-step');
    if (!box) {
      box = document.createElement('div');
      box.className = 'fh-pv-step';
      box.style.cssText = 'display:flex;align-items:center;gap:1rem;flex-wrap:wrap;margin:1rem 0 1.4rem;font-size:1.4rem;color:#1c2135;';
      box.innerHTML = '<span class="fh-pv-l"></span>' +
        '<span style="display:inline-flex;align-items:center;border:1px solid rgba(28,33,53,.35);border-radius:6px">' +
        '<button type="button" data-d="-1" aria-label="-1 g" style="width:3.8rem;height:3.8rem;border:0;background:none;font-size:1.8rem;cursor:pointer">−</button>' +
        '<span class="fh-pv-n" style="min-width:4.6rem;text-align:center;font-weight:600"></span>' +
        '<button type="button" data-d="1" aria-label="+1 g" style="width:3.8rem;height:3.8rem;border:0;background:none;font-size:1.8rem;cursor:pointer">+</button></span>' +
        '<span class="fh-pv-h" style="flex-basis:100%;font-size:1.25rem;color:#5b5a57"></span>';
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    setT(box.querySelector('.fh-pv-l'), T.grams);
    setT(box.querySelector('.fh-pv-n'), g + ' g');
    setT(box.querySelector('.fh-pv-h'), T.hint);
    box.onclick = function (e) {
      var b = e.target.closest('button[data-d]'); if (!b) return;
      var n = Math.min(MAX, Math.max(MIN, g + Number(b.dataset.d)));
      if (n !== g) onStep(n);
    };
    return box;
  }
  function removeStepper(anchor) {
    var b = anchor.parentNode && anchor.parentNode.querySelector(':scope > .fh-pv-step');
    if (b) b.remove();
  }

  function qtyLabel(scope, on) {
    var root = scope.closest('product-info, quick-add-modal, .shopify-section, section') || document;
    var qty = root.querySelector('input.quantity__input[name="quantity"]');
    if (!qty) return;
    var label = root.querySelector('label[for="' + qty.id + '"]');
    if (!label) return;
    var sp = label.querySelector(':scope > span:not(.quantity__rules-cart)') || label;
    if (on) {
      if (!label.dataset.fhPvOrig) label.dataset.fhPvOrig = sp.textContent;
      if (sp.textContent !== T.bottles) sp.textContent = T.bottles;
    } else if (label.dataset.fhPvOrig) {
      sp.textContent = label.dataset.fhPvOrig; delete label.dataset.fhPvOrig;
    }
  }

  function enhanceRadios() {
    document.querySelectorAll('variant-selects fieldset').forEach(function (fs) {
      var radios = Array.prototype.filter.call(fs.querySelectorAll('input[type="radio"]'), function (r) { return grams(r.value); });
      if (radios.length < 2) return;
      var checked = radios.filter(function (r) { return r.checked; })[0];
      var visible = checked || radios[0];
      radios.forEach(function (r) {
        var lab = fs.querySelector('label[for="' + r.id + '"]');
        show(lab, r === visible);
        if (r === visible) { setLabelText(lab, T.pill); if (lab) lab.dataset.fhPill = '1'; }
      });
      if (checked) {
        var g = grams(checked.value);
        stepper(fs, g, function (n) {
          var target = radios.filter(function (r) { return grams(r.value) === n; })[0];
          if (target) target.click();
        });
      } else removeStepper(fs);
      qtyLabel(fs, !!checked);
    });
  }

  function enhanceSelects() {
    document.querySelectorAll('variant-selects select').forEach(function (sel) {
      var opts = Array.prototype.filter.call(sel.options, function (o) { return grams(o.value); });
      if (opts.length < 2) return;
      var cur = grams(sel.value);
      var visible = opts.filter(function (o) { return o.value === sel.value; })[0] || opts[0];
      opts.forEach(function (o) {
        var hide = o !== visible;
        if (o.hidden !== hide) o.hidden = hide;
        if (o === visible && o.textContent !== T.pill) o.textContent = T.pill;
      });
      var wrap = sel.closest('.select') || sel;
      if (cur) {
        stepper(wrap, cur, function (n) {
          var t = opts.filter(function (o) { return grams(o.value) === n; })[0];
          if (t) { sel.value = t.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
        });
      } else removeStepper(wrap);
      qtyLabel(sel, !!cur);
    });
  }

  var t;
  function run() { clearTimeout(t); t = setTimeout(function () { enhanceRadios(); enhanceSelects(); }, 40); }
  document.addEventListener('DOMContentLoaded', function () {
    run();
    new MutationObserver(run).observe(document.body, { childList: true, subtree: true });
    document.addEventListener('change', run, true);
  });
})();
