# Tahap 1: pasang dependensi (termasuk build better-sqlite3 bila tidak ada prebuilt) + build CSS
FROM node:22-slim AS build
WORKDIR /app
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build:css \
 && npm prune --omit=dev

# Tahap 2: image akhir, tanpa kompilator, berjalan sebagai pengguna non-root
FROM node:22-slim
ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/data \
    TZ=Asia/Jakarta
WORKDIR /app
COPY --from=build --chown=node:node /app /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
