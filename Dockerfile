# Stage 1: Build frontend & backend bundles
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

# Stage 2: Lightweight production runtime
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    MYARTIFACT_HOME=/data \
    MYARTIFACT_HOST=0.0.0.0 \
    MYARTIFACT_PORT=4173

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/cloud/migrations ./dist/migrations

RUN mkdir -p /data/artifacts /data/dropzone

VOLUME ["/data"]
EXPOSE 4173

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4173/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "dist/cli/cli.js", "serve", "--host", "0.0.0.0", "--port", "4173", "--data-dir", "/data"]
