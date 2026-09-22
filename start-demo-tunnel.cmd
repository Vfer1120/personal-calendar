@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-demo-tunnel.ps1"
if errorlevel 1 pause
echo.
pause
