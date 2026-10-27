@echo off
rem Double-click or run "start-server.cmd --new" etc. See start-server.ps1 for the options.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-server.ps1" %*
if errorlevel 1 pause
