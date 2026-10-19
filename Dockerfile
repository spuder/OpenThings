# OpenThings: the web app plus the sync server, REST API and MCP endpoint, in one Bun process.
# Data (one SQLite file) lives in /data: mount a volume there.

FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Bundle the server into one file, so the runtime image needs no node_modules.
FROM --platform=$BUILDPLATFORM oven/bun:1-alpine AS server
WORKDIR /app
COPY --from=web /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
COPY server ./server
RUN bun build server/index.ts --target=bun --outfile=dist-server/index.js

FROM oven/bun:1-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 DATA_DIR=/data STATIC_DIR=/app/public
COPY --from=web /app/dist ./public
COPY --from=server /app/dist-server/index.js ./server.js
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/api/health >/dev/null || exit 1
CMD ["bun", "server.js"]
