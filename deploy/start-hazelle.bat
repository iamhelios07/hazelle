@echo off
rem The Windows start: the release zip holds node\node.exe, app\ (the image's /app) and this file; data\ appears beside.
cd /d "%~dp0"
node\node.exe app\dist\server\launch.js
pause
