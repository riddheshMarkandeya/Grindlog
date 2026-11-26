@echo off
title OvertimeRL Companion Server
cd /d "%~dp0"
echo ========================================================
echo       OVERTIMERL - FotMob Analytics for Rocket League
echo ========================================================
echo Connecting to Grindlog telemetry on :49100 ...
echo Starting OvertimeRL Web UI on http://127.0.0.1:49200 ...
start http://127.0.0.1:49200
node --experimental-strip-types src/server/main.ts
pause
