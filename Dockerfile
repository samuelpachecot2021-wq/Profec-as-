# ───────────────────────────────────────────────────────────────
# PROFECÍA STUDIO AI — servidor en la nube con FFmpeg y voces libres
# Base: Ubuntu 24.04 (FFmpeg 6.1 con libass) + Node.js 22
# ───────────────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS node

FROM ubuntu:24.04 AS base
ENV DEBIAN_FRONTEND=noninteractive
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

FROM base AS build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build && npm prune --omit=dev

FROM base AS run
# FFmpeg (render), fuentes, eSpeak + MBROLA (voz local de respaldo) y Python para Piper
RUN apt-get update && apt-get install -y --no-install-recommends software-properties-common \
    && add-apt-repository -y multiverse \
    && apt-get update && apt-get install -y --no-install-recommends \
       ffmpeg fonts-dejavu-core espeak-ng python3 python3-venv ca-certificates tini \
    && (apt-get install -y --no-install-recommends mbrola mbrola-es2 || echo "MBROLA no disponible") \
    && apt-get purge -y software-properties-common && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Piper: voz neuronal masculina en español latino, gratuita y sin límites, dentro del servidor
RUN python3 -m venv /opt/piper/venv \
    && /opt/piper/venv/bin/pip install --no-cache-dir piper-tts \
    && ln -s /opt/piper/venv/bin/piper /usr/local/bin/piper \
    && mkdir -p /opt/piper/voices \
    && (cd /opt/piper/voices && /opt/piper/venv/bin/python -m piper.download_voices es_MX-ald-medium \
        || echo "AVISO: no se pudo descargar la voz Piper; se usará la voz en línea gratuita")

WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PROFECIA_DATA_DIR=/data \
    PIPER_VOICES_DIR=/opt/piper/voices \
    PORT=3000
COPY --from=build /app/package.json /app/package-lock.json /app/next.config.mjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/assets ./assets
RUN mkdir -p /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec node_modules/.bin/next start -H 0.0.0.0 -p ${PORT:-3000}"]
