@echo off
echo Vionna Dashboard opstarten...
cd /d "%~dp0\backend"

set APPDATA=%APPDATA%
set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm

rem Local dev has no DROPLET_TOKEN_SECRET, so the auth gate is fail-closed for
rem remote calls; DEV_LOCAL=1 marks this as a trusted local run so the dashboard
rem keeps working here without a token. NEVER set this on the droplet.
set DEV_LOCAL=1

C:\Users\venek\AppData\Local\Python\pythoncore-3.14-64\python.exe -m pip install -r requirements.txt -q

echo.
echo Dashboard beschikbaar op: http://localhost:5000
echo Sluit dit venster om te stoppen.
echo.

start http://localhost:5000
C:\Users\venek\AppData\Local\Python\pythoncore-3.14-64\python.exe server.py
pause
