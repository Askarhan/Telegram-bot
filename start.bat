@echo off
echo =======================================
echo    ANNUR DIAMONDS Bot v2.0 Launcher
echo =======================================
echo.
echo Checking Node.js...
node --version
echo.
echo Checking npm packages...
npm list --depth=0 2>nul
echo.
echo Starting bot...
echo Press Ctrl+C to stop
echo.
npm start