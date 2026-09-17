#!/bin/bash
# with-server.sh — start a FRESH Next.js dev server (+ realtime service),
# wait for readiness, run the given command, then tear down EVERYTHING.
#
# Hardening: any leftover server on :3000 is killed first (a stale server
# would silently serve old process state — e.g. rate-limit buckets — even
# though hot-reload updates the code). Teardown kills the whole tree.
#
# Usage: bash scripts/with-server.sh <command...>
cd /home/z/my-project || exit 1

# ---- pre-flight: clear any stale server on :3000 ----
if ss -tln 2>/dev/null | grep -q ":3000 "; then
  echo "[with-server] stale server on :3000 — killing it first"
  pkill -f "next-server" 2>/dev/null
  pkill -f "next dev" 2>/dev/null
  pkill -f "bun run dev" 2>/dev/null
  for i in $(seq 1 15); do
    ss -tln 2>/dev/null | grep -q ":3000 " || break
    sleep 1
  done
  if ss -tln 2>/dev/null | grep -q ":3000 "; then
    echo "FATAL: cannot free port 3000"
    exit 1
  fi
fi

# start realtime mini-service (socket.io :3003 + admin :3004)
(cd mini-services/realtime && exec bun --hot index.ts >/tmp/rt.log 2>&1) &
RT_PID=$!

# start Next.js dev server
bun run dev >/dev/null 2>&1 &
NEXT_PID=$!

# wait for the dev server (probe both v4/v6 localhost)
code=000
for i in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:3000/api/auth/me 2>/dev/null)
  if [ "$code" != "000" ] && [ "$code" != "502" ]; then ready=1; break; fi
  code4=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000/api/auth/me 2>/dev/null)
  if [ "$code4" != "000" ]; then code=$code4; ready=1; break; fi
  sleep 1
done
if [ -z "$ready" ]; then
  echo "FATAL: dev server did not become ready (last code: $code)"
  tail -20 dev.log
  kill $NEXT_PID $RT_PID 2>/dev/null
  pkill -f "next-server" 2>/dev/null; pkill -f "next dev" 2>/dev/null
  exit 1
fi
echo "[with-server] dev server ready (probe http $code, ${i}s)"

# run the payload command
"$@"
RC=$?

# teardown — kill the whole tree so nothing leaks into the next run
kill $NEXT_PID $RT_PID 2>/dev/null
pkill -f "next-server" 2>/dev/null
pkill -f "next dev" 2>/dev/null
sleep 1
exit $RC
