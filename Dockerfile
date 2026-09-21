# syntax=docker/dockerfile:1
# ============================================================================
# NPL MIS Portal (Drona Logitech Centralized MIS) — production web image.
#
# Multi-stage build:
#   deps    — install dependencies with Bun (respects bun.lock)
#   build   — prisma generate + next build (standalone output)
#   runtime — minimal Node.js image running the standalone server on 0.0.0.0:3000
#
# The Prisma CLI is carried into the runtime image so the entrypoint can run
# `prisma migrate deploy` before the server starts (disable with
# MIGRATE_ON_START=false for zero-downtime multi-replica setups, and run
# migrations as an explicit deploy step instead).
#
# No secrets, no .env, no SQLite database, and no development artifacts are
# baked into the image — all configuration arrives via environment variables
# (Coolify).
# ============================================================================

# ---------- Stage 1: dependencies ----------
FROM oven/bun:1 AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# ---------- Stage 2: production dependencies ----------
FROM oven/bun:1 AS prod-deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# ---------- Stage 3: build ----------
FROM oven/bun:1 AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Placeholder connection string — Prisma clients are constructed during
# build-time analysis but never connect. The real DATABASE_URL is injected
# at runtime by Coolify.
ENV DATABASE_URL="postgresql://build:build@127.0.0.1:5432/build"
ENV NEXT_TELEMETRY_DISABLED=1
# NEXT_PUBLIC_DEMO_LOGIN is intentionally NOT set: production builds must not
# advertise demo credentials on the login screen.
RUN bunx prisma generate
RUN bun run build

# ---------- Stage 4: runtime ----------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV MIGRATE_ON_START=true

# Prisma's generated Debian engine requires the OpenSSL libraries at runtime.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

# non-root runtime user
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m nextjs

# standalone Next.js server (already contains its pruned node_modules)
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public

# Complete production dependency tree for the standalone server, Prisma Client,
# and the Prisma CLI used by the startup migration.
COPY --from=prod-deps --chown=nextjs:nodejs /app/node_modules ./node_modules
# Preserve the Prisma Client generated during the build after installing the
# production dependency tree.
COPY --from=build --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma

# Prisma schema + migrations (for `migrate deploy` at start)
COPY --from=build --chown=nextjs:nodejs /app/prisma ./prisma

# First-admin bootstrap (plain-node script; runs inside the container with:
#   ADMIN_EMAIL=… ADMIN_INITIAL_PASSWORD=… node scripts/create-admin.mjs )
# hash-wasm is bundled into the Next.js server chunks by the build tracer, so
# it is copied explicitly for this standalone script to import.
COPY --from=build --chown=nextjs:nodejs /app/scripts/create-admin.mjs ./scripts/create-admin.mjs
# Production configuration preflight (zero-dependency, never prints secrets):
#   node scripts/preflight-prod.mjs
COPY --from=build --chown=nextjs:nodejs /app/scripts/preflight-prod.mjs ./scripts/preflight-prod.mjs

# Production-safe MIS field registry migration
COPY --from=build --chown=nextjs:nodejs /app/scripts/migrate-mis-field-registry.ts ./scripts/migrate-mis-field-registry.ts

COPY --chown=nextjs:nodejs docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "server.js"]
