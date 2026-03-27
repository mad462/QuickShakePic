@echo off
cd /d "%~dp0"
start "QuickShakePic Server" cmd /k node server.js
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:5173/"
