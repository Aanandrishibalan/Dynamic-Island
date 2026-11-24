@echo off
REM Builds the installer AND the portable exe into .\dist  (needs Node.js 18+ from nodejs.org, run on Windows)
cd /d "%~dp0"

REM electron-builder downloads helper tools (NSIS, winCodeSign) and moves them into a cache folder. On some PCs antivirus
REM blocks that move ("rename ... Access is denied") and leaves a half-built cache. Use a fresh cache inside this project
REM and delete any broken one first.
set ELECTRON_BUILDER_CACHE=%~dp0.eb-cache
if exist "%~dp0.eb-cache" rmdir /s /q "%~dp0.eb-cache"
if exist "%~dp0dist" rmdir /s /q "%~dp0dist"
if exist "%LOCALAPPDATA%\electron-builder\Cache\nsis" rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\nsis"
if exist "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign" rmdir /s /q "%LOCALAPPDATA%\electron-builder\Cache\winCodeSign"

call npm install || goto :err
REM unpack the installer tools directly into the cache (avoids the blocked rename)
node build\prefetch-tools.js
call npm run dist || goto :err
echo.
echo Done. Files are in %cd%\dist
explorer dist
exit /b 0
:err
echo.
echo Build failed. If the error says "Access is denied" while moving a cache folder, add this project folder to
echo Windows Security ^> Virus ^& threat protection ^> Exclusions, close other terminals, and run this file again
echo (right-click ^> Run as administrator).
pause
