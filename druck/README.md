# FH-Druck – Druck-PC im Lager (Mini-PC)

Einrichten: `FH-Druck-einrichten.cmd` ausführen (fragt einmal die PIN der Showroom-App). Neustart: `FH-Druck-neu-starten.cmd`.

`druck.ps1` holt alle 3 s Druckaufträge aus der App und verteilt sie nach Dateiname:

| Dateiname | Drucker | SumatraPDF-Option |
|---|---|---|
| `A4-…` (Angebot, Packliste) | Brother MFC-J6957DW | `fit` |
| `P-…` (Etiketten 40 × 30) | Phomemo M110S (USB) | `noscale,landscape` |
| `Z-…` (DHL-Versandetikett 103 × 199) | Zebra GK420t (USB) | – (direkt per USB als ZPL, ohne Treiber) |
| alles andere (CLP 102 × 51) | Epson ColorWorks CW-C6000Ae | `fit,landscape` |

Testordner: PDF in `%USERPROFILE%\FH-Druck\test` legen → wird sofort gedruckt (Name bestimmt den Drucker).

## Treibereinstellungen in Windows (nicht in Git – bei Neuinstallation wieder setzen)

**Epson CW-C6000Ae** (Druckeinstellungen + Standardwerte): Media Definition „FH 102x51“ – Breite 102, Länge 51 mm, Gap 3 mm, Die-cut Label (Gap), Coating *Synthetic* (PP-Folie); Media Detection: Internal (Roll), Gap detection.

**Phomemo M110S** (Treiber „QY_Printer Driver“, Druckeinstellungen + Standardwerte → Seite einrichten): Papiergattung „50 x 70mm“ auf **Breite 40, Höhe 30 mm** geändert (nur diese Größe sieht Windows), Gattung *Etikett mit Lücken*, Drucken-Abweichung **Horizontal 8 mm**, Vertikal 0. Immer am selben USB-Anschluss lassen.

**Brother MFC-J6957DW**: über Netzwerk hinzugefügt, Standard A4.

**Zebra GK420t**: braucht **keinen Windows-Treiber**. `druck.ps1` findet sie über USB (Hersteller-ID 0A5F), wandelt das DHL-PDF mit dem in Windows eingebauten PDF-Renderer in ein Bild (8 Punkte/mm) und schickt es als ZPL direkt an den Drucker. Rolle 103 × 199 mm (Etikettenlänge im Drucker 1616 Punkte). Nur falls USB nicht geht, wird ein installierter Zebra-/ZDesigner-Treiber über SumatraPDF benutzt.

Mini-PC: Claude-App im Autostart, Standby/Ruhezustand „Nie“, Anmeldung ohne Passwort.
