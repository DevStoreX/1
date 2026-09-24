# Forja3D — imagen única con la interfaz web, la API, el agente y el servidor MCP.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/agent/package.json packages/agent/
COPY apps/server/package.json apps/server/
COPY apps/mcp/package.json apps/mcp/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-slim
# ffmpeg solo hace falta para la cámara de Bambu X1/H2D (RTSP): docker build --build-arg WITH_FFMPEG=true
ARG WITH_FFMPEG=false
RUN if [ "$WITH_FFMPEG" = "true" ]; then apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*; fi
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787 \
    FORJA_DATA_DIR=/data
COPY --from=build /app /app
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]
