@echo off
rem The Windows start: the release zip holds node\node.exe, app\ (the image's /app) and this file; data\ appears beside.
rem An update (app\update.ps1) replaces node\ and app\ but never this file, which cmd reads by offset while it runs.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File app\update.ps1
node\node.exe app\dist\server\launch.js
pause
