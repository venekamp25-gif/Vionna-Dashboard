@echo off
echo Vionna Dashboard opstarten...
cd /d "%~dp0\backend"

set APPDATA=%APPDATA%
set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm

rem Local dev has no DROPLET_TOKEN_SECRET, so the auth gate is fail-closed for
rem remote calls; DEV_LOCAL=1 marks this as a trusted local run so the dashboard
rem keeps working here without a token. NEVER set this on the droplet.
set DEV_LOCAL=1

rem Works on any machine: prefer the Python launcher (py -3), fall back to
rem whatever "python" is on PATH. Install Python 3.12+ from python.org if neither
rem exists (tick "Add python.exe to PATH" in the installer).
set "PY=python"
where py >nul 2>&1 && set "PY=py -3"

if not exist .env (
    echo.
    echo [FOUT] backend\.env ontbreekt. Kopieer backend\.env.example naar backend\.env
    echo        en vul je eigen waarden in. Zie CLAUDE.md, "Working here as a second developer".
    echo.
    pause
    exit /b 1
)

%PY% -m pip install -r requirements.txt -q

echo.
echo Dashboard beschikbaar op: http://localhost:5000
echo Sluit dit venster om te stoppen.
echo.

start http://localhost:5000
%PY% server.py
pause
