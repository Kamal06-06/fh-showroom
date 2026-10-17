# Fragrance Hub - Etiketten-Drucker (Mini-PC im Lager)
# Holt alle 3 Sekunden neue CLP-Etiketten aus der Showroom-App und druckt sie auf der Epson ColorWorks.
$ErrorActionPreference = 'Continue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$URL  = 'https://script.google.com/macros/s/AKfycbzU9YIR7tzx1VBzVAVNni93eBBBwGphyzTErrAUOveD2YmvAmiQO81QkyzVcUB5FAUd/exec?app=sr'
$DIR  = Join-Path $env:USERPROFILE 'FH-Druck'
$DONE = Join-Path $DIR 'gedruckt'
$SUM  = Join-Path $DIR 'SumatraPDF.exe'
$PINF = Join-Path $DIR 'pin.txt'
$SUMURL = 'https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip'
New-Item -ItemType Directory -Force $DONE | Out-Null
$Host.UI.RawUI.WindowTitle = 'FH Druck - Epson ColorWorks (Fenster offen lassen)'

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
  try { $r = Api 'check' ''; if ($r.val -eq $true) { Set-Content $PINF $script:PIN; break } } catch {}
  Write-Host 'PIN falsch oder keine Internetverbindung - bitte nochmal.' -ForegroundColor Red
  if (Test-Path $PINF) { Remove-Item $PINF }
  Start-Sleep 2
}

# 3) Epson-Drucker finden
function Drucker {
  $p = Get-Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -match 'C6000|C6500|ColorWorks' } | Select-Object -First 1
  if ($p) { return $p.Name } else { return $null }
}
$DRUCKER = Drucker
if (-not $DRUCKER) { Write-Host 'WARNUNG: Kein Epson ColorWorks Drucker gefunden - bitte Epson-Treiber installieren.' -ForegroundColor Yellow }
else { Write-Host "Drucker: $DRUCKER" -ForegroundColor Green }
Write-Host 'Bereit. Etiketten aus der App werden automatisch gedruckt. Dieses Fenster offen lassen.' -ForegroundColor Green

$n = 0
while ($true) {
  try {
    $r = Api 'druckholen' $(if ($n % 20 -eq 0) { '1' } else { '' })
    if ($r.err) { Write-Host "Fehler: $($r.err)" -ForegroundColor Red }
    elseif ($r.val) {
      if (-not $DRUCKER) { $DRUCKER = Drucker }
      foreach ($j in @($r.val)) {
        $f = Join-Path $DONE ((Get-Date -Format 'yyMMdd-HHmmss') + '-' + $j.name)
        [IO.File]::WriteAllBytes($f, [Convert]::FromBase64String($j.b64))
        if ($DRUCKER) {
          & $SUM -print-to $DRUCKER -print-settings 'fit' -silent $f | Out-Null
          Write-Host "$(Get-Date -Format HH:mm:ss)  gedruckt: $($j.name)" -ForegroundColor Green
        } else { Write-Host "Kein Drucker - Datei gespeichert: $f" -ForegroundColor Yellow }
      }
    }
  } catch { Write-Host "$(Get-Date -Format HH:mm:ss)  keine Verbindung ..." -ForegroundColor DarkGray }
  # alte Dateien (älter als 30 Tage) aufräumen
  if ($n % 1200 -eq 0) { Get-ChildItem $DONE -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -ErrorAction SilentlyContinue }
  $n++
  Start-Sleep -Seconds 3
}
