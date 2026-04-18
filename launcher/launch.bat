@echo off
REM Claude Sessions Viewer — single double-click launcher.
REM First run: creates venv and installs deps (shows console).
REM Subsequent runs: starts server hidden and opens browser.

setlocal
set "ROOT=%~dp0.."
set "BACKEND=%ROOT%\backend"
set "VENV=%ROOT%\.venv"
set "PORT=8765"
set "URL=http://127.0.0.1:%PORT%/"

REM -- ensure python exists
where python >nul 2>nul
if errorlevel 1 (
  echo [!] Python not found on PATH. Install Python 3.10+ from https://python.org and re-run.
  pause
  exit /b 1
)

REM -- one-time setup
if not exist "%VENV%\Scripts\python.exe" (
  echo [*] First run: creating virtualenv and installing dependencies...
  python -m venv "%VENV%" || goto :fail
  "%VENV%\Scripts\python.exe" -m pip install --upgrade pip >nul
  "%VENV%\Scripts\python.exe" -m pip install -r "%BACKEND%\requirements.txt" || goto :fail
  echo [*] Setup complete.
)

REM -- check if already running on port; if so, just open the browser
powershell -NoProfile -Command "try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { exit 1 }"
if %errorlevel%==0 (
  start "" "%URL%"
  exit /b 0
)

REM -- start server detached (hidden console) and open browser
start "" "%VENV%\Scripts\pythonw.exe" -m uvicorn app:app --app-dir "%BACKEND%" --host 127.0.0.1 --port %PORT%

REM -- wait briefly for server to be ready
powershell -NoProfile -Command "1..20 | %% { try { $c = New-Object Net.Sockets.TcpClient('127.0.0.1', %PORT%); $c.Close(); exit 0 } catch { Start-Sleep -Milliseconds 250 } }; exit 1"

start "" "%URL%"
exit /b 0

:fail
echo [!] Setup failed.
pause
exit /b 1
