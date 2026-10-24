/* =====================================================================
   Lexware.gs – Rechnungsentwurf in Lexware Office aus einem Showroom-Auftrag
   Aufruf aus der App: srApi(pin, 'lex_draft', JSON-Payload)
   Der API-Schlüssel liegt in den Skripteigenschaften unter LEXWARE_API_KEY
   (Lexware Office → Einstellungen → Erweiterungen → Öffentliche API).
   Es wird nur ein ENTWURF angelegt (nichts wird versendet oder gebucht).
   Keine Angebotsnummer (AP-…) in der Rechnung.
   ===================================================================== */

var LEX_API_ = 'https://api.lexware.io/v1';

function lexKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('LEXWARE_API_KEY');
  if (!k) throw new Error('LEXWARE_KEY_FEHLT');
  return k;
}

function lexFetch_(method, path, body) {
  var opt = { method: method, muteHttpExceptions: true,
              headers: { Authorization: 'Bearer ' + lexKey_(), Accept: 'application/json' } };
  if (body) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(body); }
  for (var i = 0; i < 3; i++) {
    var r = UrlFetchApp.fetch(LEX_API_ + path, opt), code = r.getResponseCode(), txt = r.getContentText();
    if (code === 429) { Utilities.sleep(1200); continue; }          // max. 2 Anfragen/Sekunde
    if (code >= 300) throw new Error('Lexware ' + code + ': ' + txt.slice(0, 400));
    return txt ? JSON.parse(txt) : {};
  }
  throw new Error('Lexware: zu viele Anfragen, bitte gleich nochmal');
}

/* Kunde in Lexware per Name suchen; genau ein Treffer → Kontakt verknüpfen */
function lexKontakt_(name) {
  name = String(name || '').trim();
  if (name.length < 3) return null;
  try {
    var r = lexFetch_('get', '/contacts?customer=true&size=25&name=' + encodeURIComponent(name));
    var hits = (r.content || []).filter(function (c) {
      var n = c.company ? c.company.name : ((c.person && ((c.person.firstName || '') + ' ' + (c.person.lastName || '')).trim()) || '');
      return String(n || '').trim().toLowerCase() === name.toLowerCase();
    });
    return hits.length === 1 ? hits[0].id : null;
  } catch (e) { Logger.log('lexKontakt_ ' + e.message); return null; }
}

/* Leistungsdatum: ein Auftrag → Lieferdatum; Sammelrechnung → Leistungszeitraum vom ersten bis zum letzten Auftrag */
function lexLiefer_(p, datum, tz) {
  var iso = function (s) { var d = /^\d{4}-\d{2}-\d{2}$/.test(s || '') ? new Date(s + 'T12:00:00') : null; return d ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'00:00:00.000XXX") : null; };
  var f = iso(p.shipFrom), t = iso(p.shipTo);
  if (f && t && p.shipFrom !== p.shipTo) return { shippingDate: f, shippingEndDate: t, shippingType: 'deliveryperiod' };
  return { shippingDate: f || datum, shippingType: 'delivery' };
}

function lexEntwurf_(p) {
  if (!SR_ADMIN) throw new Error('NUR_INHABER');
  if (!p || !p.lineItems || !p.lineItems.length) throw new Error('Keine Positionen');
  var d = new Date(), tz = Session.getScriptTimeZone();
  var datum = Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss.SSSXXX");
  var cid = lexKontakt_(p.name);
  var adr = cid ? { contactId: cid } : {
    name: String(p.name || 'Kunde').slice(0, 255),
    street: p.street || undefined, zip: p.zip || undefined, city: p.city || undefined,
    countryCode: (p.country && p.country !== 'XX') ? p.country : 'DE'
  };
  var body = {
    voucherDate: datum,
    address: adr,
    lineItems: p.lineItems.map(function (li) {
      var o = { type: 'custom', name: String(li.name || '').slice(0, 255), quantity: Math.round(Number(li.quantity) * 10000) / 10000,
                unitName: li.unitName || 'Stück',
                unitPrice: { currency: 'EUR', netAmount: Math.round(Number(li.netAmount) * 10000) / 10000, taxRatePercentage: 19 } };
      if (li.description) o.description = String(li.description).slice(0, 1000);
      if (li.discountPercentage) o.discountPercentage = Math.round(Number(li.discountPercentage) * 100) / 100;
      return o;
    }),
    totalPrice: { currency: 'EUR' },
    taxConditions: { taxType: 'net' },
    shippingConditions: lexLiefer_(p, datum, tz),
    title: 'Rechnung'
  };
  if (p.totalDiscountAbsolute > 0) body.totalPrice.totalDiscountAbsolute = Math.round(p.totalDiscountAbsolute * 100) / 100;
  if (p.remark) body.remark = String(p.remark).slice(0, 2000);
  var r = lexFetch_('post', '/invoices', body);       // ohne ?finalize=true → Entwurf
  return { id: r.id, kontakt: !!cid, url: 'https://app.lexoffice.de/permalink/invoices/edit/' + r.id };
}
