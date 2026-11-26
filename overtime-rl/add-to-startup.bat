@echo off
setlocal
cd /d "%~dp0"
echo ========================================================
echo  OvertimeRL - Add to Windows System Tray Startup
echo ========================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ws = New-Object -ComObject WScript.Shell; " ^
  "$targetLnk = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup\OvertimeRL.lnk'; " ^
  "$s = $ws.CreateShortcut($targetLnk); " ^
  "$s.TargetPath = 'wscript.exe'; " ^
  "$s.Arguments = '\"' + (Join-Path '%~dp0' 'OvertimeRL.vbs') + '\"'; " ^
  "$s.WorkingDirectory = '%~dp0'; " ^
  "$s.IconLocation = (Join-Path '%~dp0' 'overtime.ico'); " ^
  "$s.Description = 'OvertimeRL Rocket League Analytics Tray Companion'; " ^
  "$s.Save(); " ^
  "Write-Host 'Success: OvertimeRL shortcut created in Startup: ' $targetLnk -ForegroundColor Green;"

echo.
echo OvertimeRL will now start minimized in your hidden taskbar icons when Windows boots,
echo exactly like Grindlog.
echo.
pause
