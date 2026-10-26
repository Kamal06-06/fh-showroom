/* =====================================================================
   Superchat.gs – Timo (KI-Agent) pausieren, wenn ein Mitarbeiter manuell antwortet
   Ablauf: Superchat-Webhook (message_outbound / conversation_done) → doPost
   • Nachricht von einem Menschen (from.name leer) → Automation "Timo stoppen" starten + Timer merken
   • Nachricht von Timo / API oder Unterhaltung erledigt → Timer löschen
   • scPauseLauf (jede Minute): SC.pauseMin Minuten nach der letzten manuellen Nachricht
     → Unterhaltung auf "done" → beim nächsten Kundenschreiben übernimmt Timo wieder
   Einmalig: scEinrichten()
   ===================================================================== */
var SC = {
  api: 'https://api.superchat.com/v1.0',
  stopHook: 'https://webhooks.superchat.cloud/v1/automations/Y9FqZhQsZJij73jGeZmBv',
  pauseMin: 10,
  token: 'fh-sc-7k2p9xq4',
  webapp: 'https://script.google.com/macros/s/AKfycbzU9YIR7tzx1VBzVAVNni93eBBBwGphyzTErrAUOveD2YmvAmiQO81QkyzVcUB5FAUd/exec'
};
var SC_KEY_TEMP = ''; // API-Key liegt in den Script-Eigenschaften (SUPERCHAT_API_KEY)

function scProps_() { return PropertiesService.getScriptProperties(); }
function scApi_(path, method, body) {
  var r = UrlFetchApp.fetch(SC.api + path, {
    method: method || 'get', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'X-API-KEY': scProps_().getProperty('SUPERCHAT_API_KEY') },
    payload: body ? JSON.stringify(body) : undefined
  });
  var t = r.getContentText();
  try { return { code: r.getResponseCode(), data: JSON.parse(t) }; } catch (e) { return { code: r.getResponseCode(), data: t }; }
}

/** Webhook-Empfang von Superchat */
function doPost(e) {
  if (e && e.parameter && e.parameter.app === 'sr') return srDoPost_(e);   // Showroom-App (Showroom.gs)
  if (e && e.parameter && e.parameter.form === 'zert') {   // Seite "Zertifikate anfordern" → B2BRegistrierung.gs
    var zRes = 'error';
    try { zRes = zertAnfrage_(e.parameter); } catch (zErr) { Logger.log('Zert: ' + zErr); }
    return ContentService.createTextOutput(zRes);
  }
  if (e && e.parameter && e.parameter.form === 'b2b') {   // Seite "Geschäftskunde werden" → B2BRegistrierung.gs
    var b2bRes = 'error';
    try { b2bRegistrierung_(e.parameter); b2bRes = 'ok'; } catch (b2bErr) { Logger.log('B2B: ' + b2bErr); }
    return ContentService.createTextOutput(b2bRes);
  }
  try {
    if (!e || !e.parameter || e.parameter.k !== SC.token) return ContentService.createTextOutput('forbidden');
    var raw = (e.postData && e.postData.contents) || '{}';
    scProps_().setProperty('SC_LAST_EVENT', raw.slice(0, 3000));
    scEreignis_(JSON.parse(raw));
  } catch (err) { scProps_().setProperty('SC_LAST_ERROR', String(err)); }
  return ContentService.createTextOutput('ok');
}

function scEreignis_(ev) {
  var typ = String(ev.event || ev.type || '');
  var m = ev.data || ev.message || ev.payload || ev;
  var conv = m.conversation_id || (m.conversation && m.conversation.id) || ev.conversation_id || (ev.conversation && ev.conversation.id) || m.id;
  if (!conv) return;
  var key = 'SC_PAUSE_' + conv;
  if (/conversation_done/.test(typ)) { scProps_().deleteProperty(key); return; }
  if (!/message_outbound/.test(typ)) return;
  var from = m.from || {};
  var mensch = !from.name;                      // Timo = Automationsname, API = "Superchat API", Mitarbeiter = null
  if (!mensch) { scProps_().deleteProperty(key); return; }
  var to = (m.to && m.to[0]) || {};
  var phone = String(to.identifier || ''), contact = String(to.contact_id || '');
  if (!/^\+?\d{6,}$/.test(phone)) phone = '';
  scProps_().setProperty(key, String(Date.now()));
  var r = UrlFetchApp.fetch(SC.stopHook, { method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ event: 'manual_reply', phone: phone, contact_id: contact, conversation_id: conv }) });
  scProps_().setProperty('SC_LAST_STOP', conv + ' ' + phone + ' → ' + r.getResponseCode());
}

/** Jede Minute: abgelaufene Pausen → Unterhaltung erledigt (Timo übernimmt beim nächsten Kundenschreiben) */
function scPauseLauf() {
  var p = scProps_(), all = p.getProperties(), now = Date.now();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('SC_PAUSE_') !== 0) return;
    if (now - Number(all[k]) < SC.pauseMin * 60000) return;
    var conv = k.slice(9);
    var r = scApi_('/conversations/' + conv, 'patch', { status: 'done' });
    p.deleteProperty(k);
    if (r.code >= 300) p.setProperty('SC_LAST_ERROR', 'done ' + conv + ': ' + r.code + ' ' + JSON.stringify(r.data).slice(0, 300));
  });
}

/** Einmalig: API-Key speichern, Superchat-Webhook anlegen, Minuten-Trigger */
function scEinrichten() {
  if (SC_KEY_TEMP) scProps_().setProperty('SUPERCHAT_API_KEY', SC_KEY_TEMP);
  var alt = scApi_('/webhooks');
  Logger.log('vorhandene Webhooks: ' + JSON.stringify(alt.data).slice(0, 800));
  var r = scApi_('/webhooks', 'post', { target_url: SC.webapp + '?k=' + SC.token,
    events: [{ type: 'message_outbound' }, { type: 'conversation_done' }] });
  Logger.log('Webhook: ' + r.code + ' ' + JSON.stringify(r.data).slice(0, 800));
  if (r.data && r.data.id) scProps_().setProperty('SUPERCHAT_WEBHOOK_ID', r.data.id);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'scPauseLauf') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('scPauseLauf').timeBased().everyMinutes(1).create();
  return r.data;
}
function scStatus() {
  var p = scProps_().getProperties(), o = {};
  Object.keys(p).forEach(function (k) { if (k.indexOf('SC_') === 0 || k.indexOf('SUPERCHAT_WEBHOOK') === 0) o[k] = p[k]; });
  Logger.log(JSON.stringify(o, null, 1)); return o;
}
