@echo off
title Fragrance Hub - Etiketten-Drucker einrichten
set "D=%USERPROFILE%\FH-Druck"
if not exist "%D%" mkdir "%D%"
echo Lade das Druckprogramm ...
powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol='Tls12'; Invoke-WebRequest 'https://kamal06-06.github.io/fh-showroom/druck/druck.ps1' -OutFile '%D%\druck.ps1' -UseBasicParsing"
if not exist "%D%\druck.ps1" ( echo FEHLER: keine Internetverbindung. & pause & exit /b 1 )
rem Autostart: startet automatisch bei jedem Einschalten des PCs
(
echo @echo off
echo start "FH Druck" /min powershell -NoProfile -ExecutionPolicy Bypass -File "%D%\druck.ps1"
) > "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\FH-Druck.cmd"
echo Fertig eingerichtet. Startet ab jetzt automatisch mit Windows.
powershell -NoProfile -ExecutionPolicy Bypass -File "%D%\druck.ps1"
