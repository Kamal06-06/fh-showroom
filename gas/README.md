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
