@echo off
title Vionna Frontend Dev Server
echo Starting Vionna Next.js frontend...
echo.

cd /d "%~dp0frontend"
if errorlevel 1 (
    echo [ERROR] Could not find folder: %~dp0frontend
    echo Make sure start-frontend.bat is in the same folder as the 'frontend' subfolder.
    pause
    exit /b 1
)

set "PATH=%PATH%;C:\Program Files\nodejs;%APPDATA%\npm"

where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found in PATH.
    echo Install Node.js from https://nodejs.org/ or check installation.
    pause
    exit /b 1
)

if not exist "node_modules\" (
    echo Installing dependencies for the first time, this takes ~30 seconds...
    echo.
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed. See messages above.
        pause
        exit /b 1
    )
)

echo.
echo ==========================================================
echo  Frontend dev server starting on http://localhost:3000
echo  Sluit dit venster om te stoppen.
echo ==========================================================
echo.

call npm run dev

echo.
echo Server stopped.
pause
