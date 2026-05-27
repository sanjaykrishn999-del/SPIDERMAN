@echo off
title Discord Audio Bots — Self Start
color 0A
echo ============================================
echo   DARK EMPIRE AUDIO BOTS — Auto Launcher
echo ============================================
echo.

:: Go to the bot folder
cd /d "%~dp0"

:: Check Node is installed
where node >nul 2>&1 || (echo [ERROR] Node.js not found. Install from https://nodejs.org & pause & exit /b 1)

:: Check PM2 is installed; install if missing
where pm2 >nul 2>&1 || (
  echo [INFO] Installing PM2 globally...
  call npm install -g pm2
)

:: Stop any existing PM2 bots cleanly
echo [INFO] Stopping previous instances...
call pm2 delete ecosystem.config.js >nul 2>&1

:: Start all 10 bots via PM2
echo [INFO] Starting all 10 bots...
call pm2 start ecosystem.config.js

:: Save PM2 list so it restarts on reboot
call pm2 save

echo.
echo [OK] All bots started! Check status with:  pm2 status
echo [OK] View logs with:                        pm2 logs
echo.
pause
