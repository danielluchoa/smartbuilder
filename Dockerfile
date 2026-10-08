# SmartBuilder — production image.
#
# Stage 1 builds the React client (static files). Stage 2 is the runtime:
# the Bun server (app/server/src/index.ts) serving the client and the
# /actions RPC endpoint, backed by MySQL (see docker-compose.yml).
#
# Build context is this bundle's root:
#   docker build -t smartbuilder .
# (docker compose up --build does exactly this.)

# ---------- stage 1: build the client ----------
FROM oven/bun:1.3 AS client-build
WORKDIR /app
# Install first (better layer caching). The @hatch/space-sdk dependency is
# a local stand-in under app/shims, so copy it before installing.
COPY app/package.json ./
COPY app/shims ./shims
RUN bun install
COPY app/client ./client
RUN bun run build:client

# ---------- stage 2: runtime ----------
FROM oven/bun:1.3-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    CLIENT_DIST=/app/client/dist
COPY app/package.json ./
COPY app/shims ./shims
RUN bun install --production
COPY app/server ./server
COPY --from=client-build /app/client/dist ./client/dist
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD bun -e "const r = await fetch('http://127.0.0.1:3000/healthz'); process.exit(r.ok ? 0 : 1)"
CMD ["bun", "server/src/index.ts"]
