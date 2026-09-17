# syntax=docker/dockerfile:1
# ============================================================================
# Realtime notification service (Socket.IO) — separate Coolify application.
#
# Exposes:
#   REALTIME_PORT       (default 3003) — Socket.IO, routed by the Coolify
#                                       proxy to the realtime domain.
#   REALTIME_ADMIN_PORT (default 3004) — internal /emit endpoint. Bind to
#                                       0.0.0.0 via REALTIME_ADMIN_BIND so the
#                                       web app can reach it over the private
#                                       Coolify network — and make sure this
#                                       port is NOT published publicly.
#
# Required environment (production):
#   REALTIME_SECRET         shared secret the web app uses to POST /emit
#   REALTIME_ALLOWED_ORIGIN the web app's public origin (CORS allowlist)
# ============================================================================
FROM oven/bun:1-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY mini-services/realtime/package.json mini-services/realtime/bun.lock ./
RUN bun install --frozen-lockfile --production

COPY mini-services/realtime/index.ts ./index.ts

# non-root user
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g nodejs -m realtime
USER realtime

EXPOSE 3003 3004
CMD ["bun", "index.ts"]
