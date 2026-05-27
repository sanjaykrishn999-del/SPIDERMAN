@echo off
title Restarting Discord Audio Bots
color 0E
cd /d "%~dp0"
echo [INFO] Restarting all bots...
call pm2 restart ecosystem.config.js
echo [OK] All bots restarted.
pause
