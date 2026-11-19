@echo off
chcp 65001 >nul
title PROFECIA STUDIO AI
cd /d "%~dp0"
where node >nul 2>nul || (echo Falta Node.js. Descarguelo de https://nodejs.org e instale la version LTS. & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo Falta FFmpeg. Abra PowerShell y escriba:  winget install Gyan.FFmpeg   y vuelva a abrir este archivo. & pause & exit /b 1)
echo Comprobando componentes (la primera vez tarda unos minutos)... & call npm install --no-audit --no-fund || (pause & exit /b 1)
echo Preparando la aplicacion (un minuto)... & call npm run build || (pause & exit /b 1)
echo.
echo  PROFECIA STUDIO AI esta funcionando. No cierre esta ventana.
echo  Se abrira el navegador en http://localhost:3000
start "" http://localhost:3000
call npm run start
pause
