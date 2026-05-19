@echo off
echo Vionna Dashboard opstarten...
cd /d "%~dp0\backend"

set APPDATA=%APPDATA%
set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm

C:\Users\venek\AppData\Local\Python\pythoncore-3.14-64\python.exe -m pip install -r requirements.txt -q

echo.
echo Dashboard beschikbaar op: http://localhost:5000
echo Sluit dit venster om te stoppen.
echo.

start http://localhost:5000
C:\Users\venek\AppData\Local\Python\pythoncore-3.14-64\python.exe server.py
pause
