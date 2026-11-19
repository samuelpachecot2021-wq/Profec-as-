#!/usr/bin/env bash
# PROFECÍA STUDIO AI — lanzador para Mac y Linux (doble clic o: bash iniciar-mac-linux.sh)
cd "$(dirname "$0")" || exit 1
command -v node >/dev/null || { echo "Falta Node.js: descárguelo de https://nodejs.org (versión LTS)."; read -r; exit 1; }
command -v ffmpeg >/dev/null || { echo "Falta FFmpeg. Mac: brew install ffmpeg · Ubuntu: sudo apt install ffmpeg"; read -r; exit 1; }
echo "Comprobando componentes (la primera vez tarda unos minutos)…"; npm install --no-audit --no-fund || exit 1
echo "Preparando la aplicación (un minuto)…"; npm run build || exit 1
echo "PROFECÍA STUDIO AI funcionando en http://localhost:3000 (no cierre esta ventana)"
( sleep 3; (command -v open >/dev/null && open http://localhost:3000) || (command -v xdg-open >/dev/null && xdg-open http://localhost:3000) ) &
npm run start
