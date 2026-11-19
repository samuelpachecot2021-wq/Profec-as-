#!/usr/bin/env bash
# ───────────────────────────────────────────────────────────────
# PROFECÍA STUDIO AI — instalación en un servidor Ubuntu propio
# (Oracle Cloud Always Free, Hetzner, DigitalOcean, etc.)
# Uso, dentro de la carpeta del proyecto en el servidor:
#   sudo bash deploy/instalar-servidor.sh
# ───────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker >/dev/null; then
  echo "Instalando Docker…"
  curl -fsSL https://get.docker.com | sh
fi

if [ ! -f .env ]; then
  read -rp "Elija su nombre de usuario para entrar a la app: " U
  while true; do
    read -rsp "Elija una contraseña (mínimo 10 caracteres): " P; echo
    [ ${#P} -ge 10 ] && break; echo "Demasiado corta."
  done
  IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
  DOMAIN="${IP//./-}.sslip.io"
  read -rp "Dirección web [${DOMAIN}] (Enter para aceptar): " D; DOMAIN=${D:-$DOMAIN}
  umask 077
  cat > .env <<ENV
ADMIN_USER=${U}
ADMIN_PASSWORD=${P}
DOMAIN=${DOMAIN}
MAX_CONCURRENT_JOBS=2
ENV
fi
set -a; . ./.env; set +a

# Abrir los puertos web en el cortafuegos del sistema (Oracle los bloquea por defecto)
if command -v iptables >/dev/null; then
  iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp --dport 80 -j ACCEPT || true
  iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || iptables -I INPUT 6 -p tcp --dport 443 -j ACCEPT || true
  command -v netfilter-persistent >/dev/null && netfilter-persistent save || true
fi

mkdir -p datos caddy-data
docker compose up -d --build
echo
echo "✅ PROFECÍA STUDIO AI está en marcha."
echo "   Abra en su teléfono:  https://${DOMAIN}"
echo "   Usuario: ${ADMIN_USER}"
echo "   (El certificado HTTPS puede tardar 1–2 minutos la primera vez.)"
echo "   Para actualizar en el futuro:  git pull && sudo docker compose up -d --build"
