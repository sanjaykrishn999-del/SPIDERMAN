@echo off
title Setup PM2 Windows Auto-Start
color 0B
cd /d "%~dp0"
echo ============================================
echo   SETUP: Bots auto-start on Windows boot
echo ============================================
echo.

:: Make sure PM2 is saved with current bot list
call pm2 save

:: Install pm2-windows-startup
echo [INFO] Installing pm2-windows-startup...
call npm install -g pm2-windows-startup

:: Register PM2 as a Windows startup item
echo [INFO] Registering PM2 to run on Windows startup...
call pm2-startup install

echo.
echo [OK] Done! Your bots will now auto-start when Windows boots.
echo [OK] To remove auto-start, run:  pm2-startup uninstall
echo.
pause
