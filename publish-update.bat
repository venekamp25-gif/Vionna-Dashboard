@echo off
cd /d "%~dp0"

:: Read current version
set /p VERSION=<version.txt
echo Current version: %VERSION%

:: Split version into parts
for /f "tokens=1,2,3 delims=." %%a in ("%VERSION%") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)

:: Increment patch version
set /a PATCH=%PATCH%+1
set NEW_VERSION=%MAJOR%.%MINOR%.%PATCH%

:: Write new version
echo %NEW_VERSION%> version.txt
echo Updated version: %NEW_VERSION%

:: Git commit and push
git add -A
git commit -m "Update v%NEW_VERSION%"
git push

echo.
echo Done! Version %NEW_VERSION% is live.
echo The lister will see the update banner next time they open the dashboard.
echo.
pause
