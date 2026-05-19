@echo off
echo Starting Vionna Next.js frontend...
cd /d "%~dp0\frontend"

set PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm

if not exist "node_modules" (
    echo Installing dependencies (one-time, takes ~30 seconds)...
    call npm install
)

echo.
echo Frontend dev server starting on http://localhost:3000
echo Sluit dit venster om te stoppen.
echo.

call npm run dev
pause
