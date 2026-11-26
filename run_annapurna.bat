@echo off
rem Opens the Annapurna Circuit 2027 site locally at http://localhost:8765/
rem (the live copy is on GitHub Pages; this is for trying changes before they go up).
cd /d "%~dp0"
start "" "http://localhost:8765/"
python -m http.server 8765 --bind 127.0.0.1
if errorlevel 1 (
  echo.
  echo Could not start the local server. Is Python installed and on PATH?
)
pause
