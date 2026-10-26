# Apps-Script-Ergänzungen (Projekt „Zertifikate-Versand“)

**Lexware.gs** – neue Datei im Apps-Script-Projekt anlegen (Inhalt aus `Lexware.gs`).

In `Lagerplaetze.gs` → `srApi` → im `switch` diese Zeile ergänzen:

```js
      case 'lex_draft': return { val: lexEntwurf_(JSON.parse(a)) };
```

Skripteigenschaft `LEXWARE_API_KEY` = API-Schlüssel aus Lexware Office
(Einstellungen → Erweiterungen → Öffentliche API).

Danach: Bereitstellen → Bereitstellungen verwalten → Web-App bearbeiten → Version „Neue Version“ → Bereitstellen
(die /exec-URL bleibt gleich).

## Echtzeit.gs (Okt. 2026)
Firebase-Projekt `fragrance-hub-app` (Spark, kostenlos): Firestore = Live-Daten der App (lists, customers, cash),
Sitzungen (sessions/{uid}) nach gültigem Passwort, Push über Firebase Cloud Messaging (tokens/{uid}),
Signale meta/shop (neue Shopify-Bestellung) und meta/chat (neue Chat-Nachricht).
Im Projekt "Zertifikate-Versand": srDoPost_ / srAdd_ / srUpdate_ / srDel_ (Showroom.gs) und etTelegramBefehle (CLP-Etikett.gs) rufen Echtzeit.gs auf.
appsscript.json braucht zusätzlich die Scopes datastore + firebase.messaging.
