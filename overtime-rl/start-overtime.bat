@echo off
title OvertimeRL Analytics Server
echo ========================================================
echo        Starting OvertimeRL Standalone Application
echo ========================================================
echo.

:: Navigate to this folder
cd /d "%~dp0"

:: Build assets if dist folder is missing
if not exist "dist\index.html" (
    echo [OvertimeRL] Building web frontend bundle...
    call npm.cmd run build
)

echo [OvertimeRL] Launching browser on http://localhost:49200 ...
start "" "http://localhost:49200"

echo [OvertimeRL] Starting backend server on port 49200...
echo (Keep this terminal window open while playing or browsing)
echo.
node --experimental-strip-types src/server/main.ts

pause
