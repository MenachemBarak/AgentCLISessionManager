@echo off
REM Creates a Desktop shortcut pointing to launch.bat.
setlocal
set "TARGET=%~dp0launch.bat"
set "DESKTOP=%USERPROFILE%\Desktop"
set "LINK=%DESKTOP%\Claude Sessions.lnk"

powershell -NoProfile -Command ^
  "$s = (New-Object -ComObject WScript.Shell).CreateShortcut('%LINK%'); ^
   $s.TargetPath = '%TARGET%'; ^
   $s.WorkingDirectory = '%~dp0'; ^
   $s.WindowStyle = 7; ^
   $s.IconLocation = '%SystemRoot%\System32\SHELL32.dll,43'; ^
   $s.Description = 'Claude Sessions Viewer'; ^
   $s.Save()"

echo [*] Created: %LINK%
echo     Double-click the Desktop icon to launch.
pause
