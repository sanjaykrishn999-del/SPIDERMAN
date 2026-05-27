@echo off
title Dark Empire Bot Dashboard
color 0B
echo ============================================
echo   DARK EMPIRE BOTS - Dashboard Launcher
echo ============================================
echo.

:: Go to the bot folder
cd /d "%~dp0"

:: Check if node_modules exists
if not exist node_modules (
    echo [INFO] Installing dependencies...
    call npm install
)

:: Start the server
echo [INFO] Starting dashboard server...
echo [INFO] Open http://localhost:3000 in your browser.
echo.
node server.js
pause
