#!/bin/sh
# Container entrypoint — optionally applies pending Prisma migrations, then
# starts the Next.js standalone server (logs to stdout/stderr for Docker/
# Coolify log collection).
set -e

if [ "$MIGRATE_ON_START" != "false" ]; then
  echo "[entrypoint] applying database migrations (prisma migrate deploy)…"
  node node_modules/prisma/build/index.js migrate deploy
  echo "[entrypoint] migrations applied."
fi

exec "$@"
