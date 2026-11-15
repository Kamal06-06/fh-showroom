@echo off
title FH Druck - Neustart
rem Startet das Druckprogramm neu (alte Instanzen beendet es selbst)
start "FH Druck" powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\FH-Druck\druck.ps1"
