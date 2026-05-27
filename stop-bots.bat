@echo off
title Stopping Discord Audio Bots
color 0C
cd /d "%~dp0"
echo [INFO] Stopping all bots...
call pm2 stop ecosystem.config.js
echo [OK] All bots stopped.
pause
