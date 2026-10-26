/**
 * Speicher.gs – Zertifikate platzsparend teilen (Fragrance Hub Germany)
 *
 * Jede Zertifikatsdatei liegt nur EINMAL im Ordner "_Zertifikate-Bibliothek (nicht löschen)".
 * Die Bestellordner ("Bestellung B-Nr:…") enthalten nur Verknüpfungen darauf → kein zusätzlicher Speicher.
 * Alte Links aus bereits verschickten E-Mails funktionieren weiter.
 *
 * speicherAufraeumen(): einmal starten – wandelt alle alten Kopien in Verknüpfungen um
 * (läuft automatisch in Etappen weiter, bis alles erledigt ist).
 */

const ZB_NAME = '_Zertifikate-Bibliothek (nicht löschen)';

function zertBibliothek_() {
  const root = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.SEND_FOLDER_NAME);
  const lib = getOrCreateFolder(root, ZB_NAME);
  try {
    if (lib.getSharingAccess() !== DriveApp.Access.ANYONE_WITH_LINK)
      lib.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (e) {}
  return lib;
}

/** Zeitstempel der aktuellen Werksdatei (Verknüpfungen werden aufgelöst). */
function zbStand_(src) {
  try {
    let f = src;
    if (f.getMimeType() === MimeType.SHORTCUT) f = DriveApp.getFileById(f.getTargetId());
    return f.getLastUpdated().getTime();
  } catch (e) { return 0; }
}

/** Liefert die Bibliotheksdatei für diesen Namen – neu angelegt nur, wenn noch keine da ist oder das Werk sie aktualisiert hat. */
function zertBibliothekDatei_(lib, blob, src) {
  const name = blob.getName();
  let best = null;
  const it = lib.getFilesByName(name);
  while (it.hasNext()) { const f = it.next(); if (!best || f.getDateCreated() > best.getDateCreated()) best = f; }
  const srcT = src ? zbStand_(src) : 0;
  if (best && best.getDateCreated().getTime() >= srcT) return best;
  if (best) {   // neue Werksversion: alte Datei behält ihre Links, bekommt nur einen anderen Namen
    const d = Utilities.formatDate(best.getDateCreated(), 'Europe/Berlin', 'yyyyMMdd');
    best.setName(name.replace(/(\.[a-z0-9]+)$/i, '_Stand-' + d + '$1'));
  }
  const f = lib.createFile(blob);
  try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  return f;
}

function zertVerknuepfung_(targetId, folder, name) {
  const sc = DriveApp.createShortcut(targetId);
  sc.moveTo(folder);
  if (name) sc.setName(name);
  return sc;
}

/** Einmalig: alte Kopien in den Bestellordnern → eine Datei in der Bibliothek + Verknüpfungen. Doppelte Kopien kommen in den Papierkorb. */
function speicherAufraeumen() {
  const t0 = Date.now();
  const props = PropertiesService.getScriptProperties();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'speicherAufraeumen')
    .forEach(t => ScriptApp.deleteTrigger(t));

  const root = getOrCreateFolder(DriveApp.getRootFolder(), CONFIG.SEND_FOLDER_NAME);
  const lib = zertBibliothek_();
  const libId = lib.getId();
  const cache = {};
  let verschoben = 0, ersetzt = 0, fertig = true;

  const ordner = root.getFolders();
  outer:
  while (ordner.hasNext()) {
    const folder = ordner.next();
    if (folder.getId() === libId) continue;
    const files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      if (Date.now() - t0 > 290000) { fertig = false; break outer; }
      const f = files.next();
      const name = f.getName();
      let ziel = cache[name];
      if (!ziel) {
        const it = lib.getFilesByName(name);
        if (it.hasNext()) ziel = cache[name] = it.next().getId();
      }
      if (!ziel) {
        f.moveTo(lib);
        try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
        ziel = cache[name] = f.getId();
        verschoben++;
      } else {
        f.setTrashed(true);
        ersetzt++;
      }
      zertVerknuepfung_(ziel, folder, name);
    }
  }

  const sum = JSON.parse(props.getProperty('SPEICHER_STAT') || '{"v":0,"e":0}');
  sum.v += verschoben; sum.e += ersetzt;
  props.setProperty('SPEICHER_STAT', JSON.stringify(sum));

  if (!fertig) {
    ScriptApp.newTrigger('speicherAufraeumen').timeBased().after(60 * 1000).create();
    Logger.log('Etappe: ' + verschoben + ' in Bibliothek, ' + ersetzt + ' Kopien ersetzt – geht in 1 Min. weiter.');
  } else {
    props.deleteProperty('SPEICHER_STAT');
    const msg = 'Speicher aufgeräumt: ' + sum.v + ' Zertifikate in der Bibliothek, ' + sum.e +
      ' doppelte Kopien durch Verknüpfungen ersetzt (liegen im Papierkorb). Alle Kunden-Links funktionieren weiter.';
    Logger.log(msg);
    try { MailApp.sendEmail(CONFIG.OWNER_EMAIL, 'Zertifikate: Speicher aufgeräumt', msg + '\n\nTipp: Papierkorb in Google Drive leeren, damit der Platz sofort frei wird.'); } catch (e) {}
  }
}
