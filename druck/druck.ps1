# Fragrance Hub - Etiketten-Drucker (Mini-PC im Lager)
# Holt alle 3 Sekunden neue Druckauftraege aus der Showroom-App: CLP-Etiketten -> Epson ColorWorks, Angebot/Packliste (A4-...) -> Brother A4, DHL-Versandetiketten (Z-...) -> Zebra, Etiketten 40x30 (P-...) -> Phomemo.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$URL  = 'https://script.google.com/macros/s/AKfycbzU9YIR7tzx1VBzVAVNni93eBBBwGphyzTErrAUOveD2YmvAmiQO81QkyzVcUB5FAUd/exec?app=sr'
$DIR  = Join-Path $env:USERPROFILE 'FH-Druck'
$DONE = Join-Path $DIR 'gedruckt'
$SUM  = Join-Path $DIR 'SumatraPDF.exe'
$PINF = Join-Path $DIR 'pin.txt'
$SUMURL = 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip'
New-Item -ItemType Directory -Force $DONE | Out-Null
# Nur EIN Druckprogramm gleichzeitig - aeltere Instanzen beenden (sonst druckt eine alte Version mit)
Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*FH-Druck\druck.ps1*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$Host.UI.RawUI.WindowTitle = 'FH Druck - Epson ColorWorks (Fenster offen lassen)'

# Rohdaten (RAW) direkt an einen Drucker schicken - fuer Phomemo: das App-Bild geht 1:1 an die Etikettenmaschine, ohne Windows-Skalierung
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
public class FhRaw {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public class DI { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool OpenPrinter(string n, out IntPtr h, IntPtr d);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool ClosePrinter(IntPtr h);
  [DllImport("winspool.drv", CharSet=CharSet.Unicode, SetLastError=true)] static extern int StartDocPrinter(IntPtr h, int l, [In] DI di);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndDocPrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool StartPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool EndPagePrinter(IntPtr h);
  [DllImport("winspool.drv", SetLastError=true)] static extern bool WritePrinter(IntPtr h, byte[] b, int n, out int w);
  public static bool Send(string printer, byte[] data, string name) {
    IntPtr h; if (!OpenPrinter(printer, out h, IntPtr.Zero)) return false;
    var di = new DI { pDocName = name, pDataType = "RAW" }; bool ok = false;
    if (StartDocPrinter(h, 1, di) > 0) { if (StartPagePrinter(h)) { int w; ok = WritePrinter(h, data, data.Length, out w); EndPagePrinter(h); } EndDocPrinter(h); }
    ClosePrinter(h); return ok;
  }
}
"@

# Zebra GK420t direkt ueber USB (ohne Windows-Treiber, ohne Admin): PDF -> Bild (Windows.Data.Pdf) -> ZPL-Grafik -> USB
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @"
using System; using System.Text; using System.Drawing; using System.Drawing.Imaging; using System.Runtime.InteropServices; using System.Collections.Generic; using Microsoft.Win32.SafeHandles;
public class FhZebra {
  [StructLayout(LayoutKind.Sequential)] struct DID { public int cbSize; public Guid g; public int Flags; public IntPtr Reserved; }
  [DllImport("setupapi.dll", SetLastError=true)] static extern IntPtr SetupDiGetClassDevs(ref Guid g, IntPtr e, IntPtr h, int f);
  [DllImport("setupapi.dll", SetLastError=true)] static extern bool SetupDiEnumDeviceInterfaces(IntPtr s, IntPtr d, ref Guid g, int i, ref DID di);
  [DllImport("setupapi.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr s, ref DID di, IntPtr buf, int size, out int req, IntPtr dev);
  [DllImport("setupapi.dll")] static extern bool SetupDiDestroyDeviceInfoList(IntPtr s);
  [DllImport("kernel32.dll", SetLastError=true, CharSet=CharSet.Unicode)] static extern SafeFileHandle CreateFile(string n, uint a, uint s, IntPtr sa, uint c, uint f, IntPtr t);
  // USB-Pfad des ersten Zebra-Druckers (Hersteller-ID 0A5F)
  public static string Pfad() {
    Guid g = new Guid("28d78fad-5a12-11d1-ae5b-0000f803a8c2"); string r = null;
    IntPtr s = SetupDiGetClassDevs(ref g, IntPtr.Zero, IntPtr.Zero, 0x12);
    DID di = new DID(); di.cbSize = Marshal.SizeOf(di);
    for (int i = 0; r == null && SetupDiEnumDeviceInterfaces(s, IntPtr.Zero, ref g, i, ref di); i++) {
      int req; SetupDiGetDeviceInterfaceDetail(s, ref di, IntPtr.Zero, 0, out req, IntPtr.Zero);
      IntPtr buf = Marshal.AllocHGlobal(req); Marshal.WriteInt32(buf, IntPtr.Size == 8 ? 8 : 6);
      if (SetupDiGetDeviceInterfaceDetail(s, ref di, buf, req, out req, IntPtr.Zero)) { string p = Marshal.PtrToStringUni(new IntPtr(buf.ToInt64() + 4)); if (p.ToLower().Contains("vid_0a5f")) r = p; }
      Marshal.FreeHGlobal(buf);
    }
    SetupDiDestroyDeviceInfoList(s); return r;
  }
  public static bool Senden(string pfad, byte[] daten) {
    using (SafeFileHandle h = CreateFile(pfad, 0x40000000, 3, IntPtr.Zero, 3, 0, IntPtr.Zero)) {
      if (h.IsInvalid) return false;
      using (var fs = new System.IO.FileStream(h, System.IO.FileAccess.Write, 65536)) { fs.Write(daten, 0, daten.Length); fs.Flush(); }
      return true;
    }
  }
  // Bild -> ZPL (^GFA, 1 Bit). maxW = Druckbreite in Punkten (GK420t: 832 = 104 mm bei 8 Punkten/mm)
  public static string Zpl(Bitmap src, int maxW, int maxH, int schwelle) {
    if (src.Width > src.Height) src.RotateFlip(RotateFlipType.Rotate90FlipNone);
    // passt in Breite UND Länge des Etiketts (z. B. DHL Express 4 x 8 Zoll auf 103 x 199 mm)
    double k = Math.Min(1.0, Math.Min((double)maxW / src.Width, (double)maxH / src.Height));
    int w = (int)Math.Round(src.Width * k), h = (int)Math.Round(src.Height * k);
    using (var bmp = new Bitmap(w, h, PixelFormat.Format24bppRgb)) {
      using (var g = Graphics.FromImage(bmp)) { g.Clear(Color.White); g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.NearestNeighbor; g.DrawImage(src, 0, 0, w, h); }
      int bpr = (w + 7) / 8; var d = bmp.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
      byte[] px = new byte[d.Stride * h]; Marshal.Copy(d.Scan0, px, 0, px.Length); bmp.UnlockBits(d);
      var sb = new StringBuilder(bpr * h * 2 + 200); const string HX = "0123456789ABCDEF";
      for (int y = 0; y < h; y++) for (int xb = 0; xb < bpr; xb++) {
        int b = 0;
        for (int bit = 0; bit < 8; bit++) { int x = xb * 8 + bit; if (x >= w) break; int o = y * d.Stride + x * 3;
          if ((px[o + 2] * 299 + px[o + 1] * 587 + px[o] * 114) / 1000 < schwelle) b |= 0x80 >> bit; }
        sb.Append(HX[b >> 4]).Append(HX[b & 15]);
      }
      int links = Math.Max(0, (maxW - w) / 2);
      return "^XA^PW" + maxW + "^LL" + h + "^LH0,0^FO" + links + ",0^GFA," + (bpr * h) + "," + (bpr * h) + "," + bpr + "," + sb.ToString() + "^FS^XZ";
    }
  }
}
"@

# PDF-Seiten mit dem in Windows eingebauten PDF-Renderer in Bilder umwandeln (kein Zusatzprogramm noetig)
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Data.Pdf.PdfDocument, Windows.Data.Pdf, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.InMemoryRandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$script:AsTaskOp  = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$script:AsTaskAct = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' } | Select-Object -First 1
function WartenOp($op, [Type]$typ) { $t = $script:AsTaskOp.MakeGenericMethod($typ).Invoke($null, @($op)); [void]$t.Wait(60000); return $t.Result }
function WartenAkt($op) { $t = $script:AsTaskAct.Invoke($null, @($op)); [void]$t.Wait(60000) }
# PDF -> ZPL (jede Seite ein Etikett), 8 Punkte/mm = 203 dpi
function PdfZuZpl($datei) {
  $f = WartenOp ([Windows.Storage.StorageFile]::GetFileFromPathAsync($datei)) ([Windows.Storage.StorageFile])
  $doc = WartenOp ([Windows.Data.Pdf.PdfDocument]::LoadFromFileAsync($f)) ([Windows.Data.Pdf.PdfDocument])
  $zpl = New-Object Text.StringBuilder
  for ($i = 0; $i -lt $doc.PageCount; $i++) {
    $pg = $doc.GetPage($i)
    $opt = New-Object Windows.Data.Pdf.PdfPageRenderOptions
    $opt.DestinationWidth  = [uint32][math]::Round($pg.Size.Width  * 203.2 / 96)
    $opt.DestinationHeight = [uint32][math]::Round($pg.Size.Height * 203.2 / 96)
    $ms = New-Object Windows.Storage.Streams.InMemoryRandomAccessStream
    WartenAkt ($pg.RenderToStreamAsync($ms, $opt))
    $st = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($ms.GetInputStreamAt(0))
    $bmp = New-Object System.Drawing.Bitmap($st)
    [void]$zpl.Append([FhZebra]::Zpl($bmp, 832, 1600, 140))
    $bmp.Dispose(); $st.Dispose(); $ms.Dispose(); $pg.Dispose()
  }
  return $zpl.ToString()
}
# DHL-Etikett (PDF) auf die Zebra drucken: zuerst direkt per USB, sonst ueber einen Windows-Zebra-Treiber (falls installiert)
function ZebraDruck($datei, $name) {
  $usb = [FhZebra]::Pfad()
  if ($usb) {
    try {
      $daten = [Text.Encoding]::ASCII.GetBytes((PdfZuZpl $datei))
      if ([FhZebra]::Senden($usb, $daten)) { Write-Host "$(Get-Date -Format HH:mm:ss)  gedruckt auf Zebra (USB): $name" -ForegroundColor Green; return $true }
      Write-Host "Zebra (USB) nicht erreichbar: $name" -ForegroundColor Red
    } catch { Write-Host "Zebra-Fehler: $($_.Exception.Message)" -ForegroundColor Red }
  }
  $q = DruckerZ
  if ($q) { & $SUM -print-to $q -print-settings 'fit,portrait' -silent $datei | Out-Null; Write-Host "$(Get-Date -Format HH:mm:ss)  gedruckt auf ${q}: $name" -ForegroundColor Green; return $true }
  Write-Host "Keine Zebra gefunden (USB-Kabel?) - Datei gespeichert: $datei" -ForegroundColor Yellow; return $false
}

function Api($action, $a) {
  $body = @{ pin = $script:PIN; action = $action; a = $a } | ConvertTo-Json -Compress
  return Invoke-RestMethod -Uri $URL -Method Post -Body $body -ContentType 'text/plain; charset=utf-8' -TimeoutSec 60
}

# 1) SumatraPDF (kostenlos) zum stillen Drucken
if (-not (Test-Path $SUM)) {
  Write-Host 'Lade SumatraPDF (kostenlos) ...'
  $zip = Join-Path $DIR 'sumatra.zip'
  Invoke-WebRequest $SUMURL -OutFile $zip -UseBasicParsing
  Expand-Archive $zip -DestinationPath $DIR -Force
  Remove-Item $zip
  $exe = Get-ChildItem $DIR -Filter 'SumatraPDF*.exe' | Select-Object -First 1
  if ($exe -and $exe.FullName -ne $SUM) { Move-Item $exe.FullName $SUM -Force }
}

# 2) Zugangscode (PIN der Showroom-App) einmal eingeben
while ($true) {
  if (Test-Path $PINF) { $script:PIN = (Get-Content $PINF -Raw).Trim() }
  else { $script:PIN = (Read-Host 'Zugangscode (PIN) der Showroom-App eingeben').Trim() }
  $r = $null
  try { $r = Api 'check' '' } catch {}
  # Server antwortet je nach Version mit true oder {ok:true,...}
  if ($r -and ($r.val -eq $true -or $r.val.ok -eq $true)) { Set-Content $PINF $script:PIN; break }
  # Nur bei klarer Antwort "PIN falsch" neu fragen. Keine Verbindung (z. B. WLAN nach dem Einschalten noch nicht da) -> gespeicherte PIN behalten und warten.
  if ($r -and "$($r.err)" -notmatch 'zu viele|gesperrt' -and ($r.val -eq $false -or "$($r.err)" -match 'pin|code|zugang')) {
    Write-Host 'PIN falsch - bitte nochmal.' -ForegroundColor Red
    if (Test-Path $PINF) { Remove-Item $PINF }
    Start-Sleep 2
  } elseif ($r -and "$($r.err)" -match 'zu viele|gesperrt') {
    Write-Host 'App wegen Fehlversuchen gesperrt - warte 10 Minuten.' -ForegroundColor Yellow
    Start-Sleep -Seconds 600
  } else {
    Write-Host 'Warte auf Internetverbindung ...' -ForegroundColor DarkGray
    if (-not (Test-Path $PINF) -and $script:PIN) { Set-Content $PINF $script:PIN }
    Start-Sleep 10
  }
}

# 3) Epson-Drucker finden
function Drucker {
  $p = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'C6000|C6500|ColorWorks' } | Select-Object -First 1
  if ($p) { return $p.Name } else { return $null }
}
# A4-Drucker (Brother) fuer Angebot / Packliste - Dateiname beginnt mit "A4-"
function DruckerA4 {
  $p = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Brother|MFC-J6957' } | Select-Object -First 1
  if ($p) { return $p.Name } else { return $null }
}
$DRUCKER = Drucker
if (-not $DRUCKER) { Write-Host 'WARNUNG: Kein Epson ColorWorks Drucker gefunden - bitte Epson-Treiber installieren.' -ForegroundColor Yellow }
else { Write-Host "Drucker: $DRUCKER" -ForegroundColor Green }
# Phomemo M110 (40 x 30) - Dateiname beginnt mit "P-"
function DruckerP {
  $p = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Phomemo|M110' } | Select-Object -First 1
  if ($p) { return $p.Name } else { return $null }
}
$DRUCKERP = DruckerP
if (-not $DRUCKERP) { Write-Host 'Hinweis: Kein Phomemo-Drucker (40 x 30) gefunden.' -ForegroundColor DarkGray }
else { Write-Host "Phomemo-Drucker: $DRUCKERP" -ForegroundColor Green }
$DRUCKERA4 = DruckerA4
# Zebra GK420t (DHL-Versandetiketten 103 x 199 / 103 x 150) - Dateiname beginnt mit "Z-". Normal direkt per USB (FhZebra), Windows-Treiber nur als Ersatz
function DruckerZ {
  $p = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'Zebra|ZDesigner|GK420' } | Select-Object -First 1
  if ($p) { return $p.Name } else { return $null }
}
$DRUCKERZ = DruckerZ
if ([FhZebra]::Pfad()) { Write-Host 'Zebra-Drucker (DHL-Etiketten): direkt per USB' -ForegroundColor Green }
elseif ($DRUCKERZ) { Write-Host "Zebra-Drucker: $DRUCKERZ" -ForegroundColor Green }
else { Write-Host 'Hinweis: Kein Zebra-Drucker (DHL-Etiketten) gefunden.' -ForegroundColor DarkGray }
if (-not $DRUCKERA4) { Write-Host 'WARNUNG: Kein A4-Drucker (Brother) gefunden.' -ForegroundColor Yellow }
else { Write-Host "A4-Drucker: $DRUCKERA4" -ForegroundColor Green }
Write-Host 'Bereit. Etiketten und A4-Dokumente aus der App werden automatisch gedruckt. Dieses Fenster offen lassen.' -ForegroundColor Green

$n = 0
while ($true) {
  # Testordner: PDF in FH-Druck\test legen -> wird wie ein App-Auftrag gedruckt (Name bestimmt den Drucker: A4-..., P-..., sonst Epson)
  $TEST = Join-Path $DIR 'test'; New-Item -ItemType Directory -Force $TEST | Out-Null
  foreach ($t in @(Get-ChildItem $TEST -File -Filter *.pdf -ErrorAction SilentlyContinue)) {
    if (-not $DRUCKERP) { $DRUCKERP = DruckerP }
    if (-not $DRUCKERZ) { $DRUCKERZ = DruckerZ }
    if ($t.Name -like 'A4-*') { $z = $DRUCKERA4; $o = 'fit' } elseif ($t.Name -like 'Z-*') { $z = $DRUCKERZ; $o = 'fit,portrait' } elseif ($t.Name -like 'P-*') { $z = $DRUCKERP; $o = $(if ($t.Name -match '__(.+)\.pdf$') { $Matches[1] -replace '_',',' } else { 'noscale,landscape' }) } else { $z = $DRUCKER; $o = 'fit,landscape' }
    if ($t.Name -like 'Z-*') { [void](ZebraDruck $t.FullName $t.Name) }
    elseif ($z) { & $SUM -print-to $z -print-settings $o -silent $t.FullName | Out-Null; Write-Host "$(Get-Date -Format HH:mm:ss)  Test gedruckt auf ${z} ($o): $($t.Name)" -ForegroundColor Cyan }
    Remove-Item $t.FullName -ErrorAction SilentlyContinue
  }
  try {
    $r = Api 'druckholen' $(if ($n % 20 -eq 0) { '1' } else { '' })
    if ($r.err) {
      Write-Host "Fehler: $($r.err)" -ForegroundColor Red
      # PIN falsch oder Sperre wegen Fehlversuchen: nicht alle 3 s weiter probieren (sonst bleibt die App fuer alle gesperrt).
      # 10 Minuten warten und die PIN aus pin.txt neu lesen (dort kann eine neue PIN eingetragen werden).
      if ("$($r.err)" -match 'pin|code|zugang|zu viele|gesperrt') {
        Write-Host 'PIN falsch/gesperrt - warte 10 Minuten. Neue PIN in pin.txt eintragen.' -ForegroundColor Yellow
        Start-Sleep -Seconds 600
        if (Test-Path $PINF) { $script:PIN = (Get-Content $PINF -Raw).Trim() }
      }
    }
    elseif ($r.val) {
      if (-not $DRUCKER) { $DRUCKER = Drucker }
      if (-not $DRUCKERA4) { $DRUCKERA4 = DruckerA4 }
      if (-not $DRUCKERP) { $DRUCKERP = DruckerP }
      if (-not $DRUCKERZ) { $DRUCKERZ = DruckerZ }
      foreach ($j in @($r.val)) {
        $f = Join-Path $DONE ((Get-Date -Format 'yyMMdd-HHmmss') + '-' + $j.name)
        [IO.File]::WriteAllBytes($f, [Convert]::FromBase64String($j.b64))
        # Etiketten 102x51 brauchen 'landscape', sonst dreht SumatraPDF sie um 90 Grad und verkleinert sie
        if ($j.name -like 'A4-*') { $ziel = $DRUCKERA4; $opt = 'fit' }
        elseif ($j.name -like 'Z-*') { $ziel = $DRUCKERZ; $opt = 'fit,portrait' }  # DHL-Versandetikett -> Zebra
        elseif ($j.name -like 'P-*') { $ziel = $DRUCKERP; $opt = 'noscale,landscape' }  # Phomemo-Treiber skaliert sonst falsch: 1:1 drucken
        else { $ziel = $DRUCKER; $opt = 'fit,landscape' }
        if ($j.name -like 'Z-*') { [void](ZebraDruck $f $j.name) }
        elseif ($ziel -and $j.name -match '\.bin(\.pdf)?$') {  # Server haengt .pdf an den Namen an
          if ([FhRaw]::Send($ziel, [IO.File]::ReadAllBytes($f), $j.name)) { Write-Host "$(Get-Date -Format HH:mm:ss)  gedruckt auf ${ziel}: $($j.name)" -ForegroundColor Green }
          else { Write-Host "Fehler beim Senden an ${ziel}: $($j.name)" -ForegroundColor Red }
        } elseif ($ziel) {
          & $SUM -print-to $ziel -print-settings $opt -silent $f | Out-Null
          Write-Host "$(Get-Date -Format HH:mm:ss)  gedruckt auf ${ziel}: $($j.name)" -ForegroundColor Green
        } else { Write-Host "Kein passender Drucker - Datei gespeichert: $f" -ForegroundColor Yellow }
      }
    }
  } catch { Write-Host "$(Get-Date -Format HH:mm:ss)  keine Verbindung ..." -ForegroundColor DarkGray }
  # alte Dateien (älter als 30 Tage) aufräumen
  if ($n % 1200 -eq 0) { Get-ChildItem $DONE -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -ErrorAction SilentlyContinue }
  $n++
  Start-Sleep -Seconds 3
}
