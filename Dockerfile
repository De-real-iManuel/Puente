# ── Stage 1: build ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

# Install pnpm
RUN corepack enable && corepack prepare pnpm@10.28.2 --activate

WORKDIR /app

# Copy workspace manifests and lockfile first for layer caching
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY .npmrc ./ 2>/dev/null || true

# Copy every package.json so pnpm can hoist correctly before source arrives
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/puente/package.json     ./artifacts/puente/
COPY artifacts/agent-signer/package.json ./artifacts/agent-signer/
COPY lib/db/package.json               ./lib/db/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-spec/package.json         ./lib/api-spec/
COPY lib/api-zod/package.json          ./lib/api-zod/
COPY scripts/package.json              ./scripts/

# Install all dependencies (frozen)
RUN pnpm install --frozen-lockfile

# Copy all source
COPY . .

# Build frontend + API server
RUN pnpm build:puente

# ── Stage 2: runtime ─────────────────────────────────────────────────────────
FROM node:22-slim AS runtime

WORKDIR /app

# Copy only what the server needs at runtime
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/puente/dist/public ./artifacts/puente/dist/public
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=builder /app/lib/db/node_modules ./lib/db/node_modules 2>/dev/null || true
COPY --from=builder /app/lib/db/src ./lib/db/src
COPY --from=builder /app/lib/db/package.json ./lib/db/
COPY --from=builder /app/lib/api-zod/src ./lib/api-zod/src 2>/dev/null || true
COPY --from=builder /app/lib/api-zod/package.json ./lib/api-zod/
COPY --from=builder /app/package.json ./

# Data directory for the file store
RUN mkdir -p .data && chmod 700 .data

ENV NODE_ENV=production
ENV DATA_DIR=/app/.data
EXPOSE 3001

CMD ["node", "artifacts/api-server/dist/index.mjs"]
