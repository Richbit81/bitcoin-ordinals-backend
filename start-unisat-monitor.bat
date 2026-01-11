@echo off
echo ========================================
echo UniSat API Monitor
echo ========================================
echo.
echo Starte Monitoring-Fenster...
echo.

cd /d "%~dp0"
node monitor-unisat.js

pause



