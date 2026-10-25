/* Druck-Warteschlange (liegt im Apps-Script-Projekt in der Datei mit srApi/srDruckOrdner_) – hier als Kopie zur Nachverfolgung */
function srDruck_(name, b64) {
  var n = String(name || 'Etiketten.pdf').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ß/g, 'ss')
            .replace(/[^A-Za-z0-9 ._-]/g, '-').slice(0, 80);
  if (!/\.pdf$/i.test(n)) n += '.pdf';
  b64 = String(b64 || '');
  var p = PropertiesService.getScriptProperties(), c = CacheService.getScriptCache();
  // schneller Weg (Druck-PC online): Auftrag im Zwischenspeicher, der Druck-PC wartet schon darauf (srDruckHolen_) → druckt in 1–2 Sekunden
  if (Date.now() - (+p.getProperty('SR_DRUCK_PC') || 0) < 60000 && b64.length <= 1800000) {
    var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6), teile = {}, k = 0;
    for (var i = 0; i < b64.length; i += 95000) teile['SRJ_' + id + '_' + (k++)] = b64.slice(i, i + 95000);
    c.putAll(teile, 21600);
    p.setProperty('SRJQ_' + id, JSON.stringify({ n: n, k: k, t: Date.now() }));
    c.put('SR_NEU', String(Date.now()), 21600);
    return 'c' + id;
  }
  // Druck-PC aus / sehr große Datei: wie bisher als Datei – wird beim nächsten Einschalten gedruckt
  var f = srDruckOrdner_().createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'application/pdf', n));
  p.setProperty('SR_DRUCK', String(Date.now()));
  c.put('SR_NEU', String(Date.now()), 21600);
  return f.getId();
}
/** Mini-PC holt neue Druckaufträge (älteste zuerst). Wartet bis zu 15 s auf neue Aufträge (Long-Polling) → sofortiger Druck */
function srDruckHolen_(immer) {
  var p = PropertiesService.getScriptProperties(), c = CacheService.getScriptCache(), ende = Date.now() + 15000, erst = true;
  p.setProperty('SR_DRUCK_PC', String(Date.now()));
  while (true) {
    if (erst || c.get('SR_NEU')) {
      c.remove('SR_NEU');
      var out = srDruckSammeln_(p, c, immer);
      if (out.length) return out;
    }
    erst = false;
    if (Date.now() > ende) return [];
    Utilities.sleep(500);
  }
}
function srDruckSammeln_(p, c, mitDrive) {
  var alleP = p.getProperties(), out = [];
  // 1) DHL-Etiketten (klein, direkt als Eigenschaft) und Aufträge im Zwischenspeicher – nach Zeit sortiert
  var keys = Object.keys(alleP).filter(function (k) { return k.indexOf('SRQ_') === 0 || k.indexOf('SRJQ_') === 0; })
    .sort(function (a, b) { return a.replace(/^SRJ?Q_/, '').localeCompare(b.replace(/^SRJ?Q_/, '')); });
  keys.slice(0, 5).forEach(function (k) {
    try {
      var j = JSON.parse(alleP[k]);
      if (k.indexOf('SRQ_') === 0) out.push({ id: k, name: j.n, b64: j.b });
      else {
        var id = k.slice(5), names = []; for (var i = 0; i < j.k; i++) names.push('SRJ_' + id + '_' + i);
        var got = c.getAll(names), b64 = names.map(function (x) { return got[x] || ''; });
        if (b64.every(function (x) { return x; })) { out.push({ id: k, name: j.n, b64: b64.join('') }); c.removeAll(names); }
      }
    } catch (e) {}
    p.deleteProperty(k);
  });
  if (keys.length > 5) c.put('SR_NEU', '1', 21600);
  // 2) ältere Aufträge als Datei (Druck-PC war aus)
  if (out.length < 5 && (mitDrive || p.getProperty('SR_DRUCK'))) {
    var it = srDruckOrdner_().getFiles(), alle = [];
    while (it.hasNext()) alle.push(it.next());
    alle.sort(function (x, y) { return x.getDateCreated() - y.getDateCreated(); });
    var take = Math.min(alle.length, 5 - out.length);
    alle.slice(0, take).forEach(function (f) { out.push({ id: f.getId(), name: f.getName(), b64: Utilities.base64Encode(f.getBlob().getBytes()) }); f.setTrashed(true); });
    if (alle.length <= take) p.deleteProperty('SR_DRUCK'); else c.put('SR_NEU', '1', 21600);
  }
  return out;
}
