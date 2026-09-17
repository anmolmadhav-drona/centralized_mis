#!/bin/bash
# with-prod-server.sh — start the PRODUCTION standalone server (+ realtime),
# wait for readiness, run the given command, then tear down — all inside ONE
# bash invocation (the sandbox reaps detached processes between commands, so
# server and test must share a single command lifetime).
#
# Usage: [COOKIE_SECURE=false] bash scripts/with-prod-server.sh <command...>
#   COOKIE_SECURE=false lets the session cookie work over plain http so the
#   browser E2E can log in against the production build locally.
cd /home/z/my-project || exit 1

# ---- pre-flight: clear any stale server on :3000 ----
if ss -tln 2>/dev/null | grep -q ":3000 "; then
  echo "[with-prod] stale server on :3000 — killing it first"
  pkill -f "standalone/server.js" 2>/dev/null
  pkill -f "next-server" 2>/dev/null
  for i in $(seq 1 15); do
    ss -tln 2>/dev/null | grep -q ":3000 " || break
    sleep 1
  done
  if ss -tln 2>/dev/null | grep -q ":3000 "; then
    echo "FATAL: cannot free port 3000"
    exit 1
  fi
fi

# realtime mini-service (socket.io :3003) — start only if not already running
RT_OWNED=0
if ! ss -tln 2>/dev/null | grep -q ":3003 "; then
  (cd mini-services/realtime && exec setsid nohup bun --hot index.ts >/tmp/rt.log 2>&1 < /dev/null) &
  RT_OWNED=1
  sleep 2
fi

# production standalone server (sources .env like portal-keepalive.sh — the
# standalone server does not load .env files itself)
setsid nohup env NODE_ENV=production PORT=3000 \
  COOKIE_SECURE="${COOKIE_SECURE:-}" \
  bash -c 'set -a; [ -f /home/z/my-project/.env ] && . /home/z/my-project/.env; set +a; exec bun /home/z/my-project/.next/standalone/server.js' \
  > server.log 2>&1 < /dev/null &
NEXT_PID=$!

# wait for readiness
code=000; ready=""
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/api/auth/me 2>/dev/null)
  if [ "$code" != "000" ] && [ "$code" != "502" ]; then ready=1; break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "FATAL: prod server did not become ready (last code: $code)"
  tail -20 server.log
  kill $NEXT_PID 2>/dev/null
  pkill -f "standalone/server.js" 2>/dev/null
  [ "$RT_OWNED" = "1" ] && pkill -f "mini-services/realtime" 2>/dev/null
  exit 1
fi
echo "[with-prod] production server ready (probe http $code, ${i}s, COOKIE_SECURE='${COOKIE_SECURE:-}')"

# run the payload command
"$@"
RC=$?

# teardown — kill the server tree; realtime only if we started it
kill $NEXT_PID 2>/dev/null
pkill -f "standalone/server.js" 2>/dev/null
[ "$RT_OWNED" = "1" ] && pkill -f "mini-services/realtime" 2>/dev/null
sleep 1
exit $RC
