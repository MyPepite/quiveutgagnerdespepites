@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js n'est pas installe. Telechargez-le sur https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b
)
node server.js
pause
