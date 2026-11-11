# FH-Druck – Druck-PC im Lager (Mini-PC)

Einrichten: `FH-Druck-einrichten.cmd` ausführen (fragt einmal die PIN der Showroom-App). Neustart: `FH-Druck-neu-starten.cmd`.

`druck.ps1` holt alle 3 s Druckaufträge aus der App und verteilt sie nach Dateiname:

| Dateiname | Drucker | SumatraPDF-Option |
|---|---|---|
| `A4-…` (Angebot, Packliste) | Brother MFC-J6957DW | `fit` |
| `P-…` (Etiketten 40 × 30) | Phomemo M110S (USB) | `noscale,landscape` |
| `Z-…` (DHL-Versandetikett 103 × 199) | Zebra GK420t (USB) | – (direkt per USB als ZPL, ohne Treiber) |
| `K-…` (farbige Proben-Etiketten 51 × 30, je Etikett eine Seite) | Epson ColorWorks CW-C4000e (USB) | `fit,landscape` |
| `R-…` (Regal-Etiketten 102 × 30, je Etikett ein Auftrag) | Epson, Warteschlange „FH Regal 102x30“ | `fit,landscape` |
| alles andere (CLP 102 × 51) | Epson ColorWorks CW-C6000Ae | `fit,landscape` |

**Nichts Altes drucken:** Aufträge, die nach 5 Minuten nicht gedruckt sind, werden verworfen – in der App, auf dem Server und in den Windows-Warteschlangen (Brother, Epson C6000, Epson C4000, Phomemo; ein laufender Auftrag bekommt 15 Minuten; Regal-Warteschlange ausgenommen).

Testordner: PDF in `%USERPROFILE%\FH-Druck\test` legen → wird sofort gedruckt (Name bestimmt den Drucker).

## Treibereinstellungen in Windows (nicht in Git – bei Neuinstallation wieder setzen)

**Epson CW-C6000Ae** (Druckeinstellungen + Standardwerte): Media Definition „FH 102x51“ – Breite 102, Länge 51 mm, Gap 3 mm, Die-cut Label (Gap), Coating *Synthetic* (PP-Folie); Media Detection: Internal (Roll), Gap detection.

**Epson Warteschlange „FH Regal 102x30“** (wird von `druck.ps1` angelegt): in deren Druckeinstellungen + Standardwerten die Media Definition „FH Regal 102x30 Endlos“ wählen, Schnitt nach jedem Etikett. Rolle 102 × 30 einlegen, bevor gedruckt wird.

**Epson CW-C4000e** (USB, Druckeinstellungen + Standardwerte): Media Definition „fh proben 51x30 endlos“ – Endlosrolle, Breite 51, Länge 30 mm, Coating *Synthetic* (Epson PP Matte 7113426), Schnitt nach jedem Etikett, Tinte MK. `druck.ps1` erkennt sie am Namen/Treiber „C4000“ (wird nie mit der C6000 verwechselt).

**Phomemo M110S** (Treiber „QY_Printer Driver“, Druckeinstellungen + Standardwerte → Seite einrichten): Papiergattung „50 x 70mm“ auf **Breite 40, Höhe 30 mm** geändert (nur diese Größe sieht Windows), Gattung *Etikett mit Lücken*, Drucken-Abweichung **Horizontal 8 mm**, Vertikal 0. Immer am selben USB-Anschluss lassen.

**Brother MFC-J6957DW**: über Netzwerk hinzugefügt, Standard A4.

**Zebra GK420t**: braucht **keinen Windows-Treiber**. `druck.ps1` findet sie über USB (Hersteller-ID 0A5F), wandelt das DHL-PDF mit dem in Windows eingebauten PDF-Renderer in ein Bild (8 Punkte/mm) und schickt es als ZPL direkt an den Drucker. Rolle 103 × 199 mm (Etikettenlänge im Drucker 1616 Punkte). Nur falls USB nicht geht, wird ein installierter Zebra-/ZDesigner-Treiber über SumatraPDF benutzt.

Mini-PC: Claude-App im Autostart, Standby/Ruhezustand „Nie“, Anmeldung ohne Passwort.
