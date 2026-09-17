#!/bin/bash
# portal-keepalive.sh — keeps the sandbox PostgreSQL instance, the realtime
# mini-service AND the production MIS portal alive.
#
# The sandbox sweeps the agent shell's descendant tree at command
# boundaries, which would otherwise leave the user-facing portal 502-ing
# between agent commands (and reap the watchdog itself). The fix, proven
# empirically (2026-09-12): EVERY long-lived process — this watchdog AND
# the services it spawns — must be double-forked via `setsid --fork` so it
# is reparented to PID 1 immediately and escapes the descendant sweep.
#
# Managed services (all configuration sourced FRESH from .env on spawn —
# the standalone server does not load .env files itself):
#   • PostgreSQL     — user-space install at /home/z/pg, cluster /home/z/pgdata
#   • Realtime       — mini-services/realtime (Socket.IO :3003, admin :3004)
#   • Web (Next.js)  — .next/standalone/server.js on :3000
#
# It steps aside if ANY process is already serving :3000 (e.g. a
# platform-managed dev server), so it never duels with the platform.
cd /home/z/my-project || exit 1

PG_BIN=/home/z/pg/bin
PGDATA=/home/z/pgdata

pg_is_up() {
  "$PG_BIN/pg_ctl" -D "$PGDATA" status >/dev/null 2>&1
}

ensure_postgres() {
  if ! pg_is_up; then
    echo "[keepalive] postgres down — starting $(date -u +%H:%M:%S)"
    "$PG_BIN/pg_ctl" -D "$PGDATA" -l /home/z/pg/pg.log -o "-h 127.0.0.1 -p 5432 -k /tmp" start >/dev/null 2>&1
    for _ in $(seq 1 30); do
      pg_is_up && break
      sleep 0.5
    done
  fi
}

port_up() {
  ss -tln 2>/dev/null | grep -q ":$1 "
}

ensure_realtime() {
  if ! port_up 3003; then
    echo "[keepalive] realtime :3003 dark — starting $(date -u +%H:%M:%S)"
    setsid --fork nohup bash -c \
      'set -a; . /home/z/my-project/.env; set +a; cd /home/z/my-project/mini-services/realtime && exec bun --hot index.ts' \
      >> /tmp/rt.log 2>&1 < /dev/null
    sleep 3
  fi
}

echo "[keepalive] started $(date -u +%H:%M:%S) (pid $$)"
while true; do
  ensure_postgres
  ensure_realtime
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 http://localhost:3000/api/auth/me 2>/dev/null)
  if [ "$code" = "000" ]; then
    echo "[keepalive] :3000 dark (code $code) — starting production server $(date -u +%H:%M:%S)"
    setsid --fork nohup env NODE_ENV=production PORT=3000 \
      bash -c 'set -a; . /home/z/my-project/.env; set +a; exec bun /home/z/my-project/.next/standalone/server.js' \
      >> /home/z/my-project/server.log 2>&1 < /dev/null
    sleep 8
  else
    sleep 10
  fi
done
