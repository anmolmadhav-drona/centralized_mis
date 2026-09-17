#!/usr/bin/env bash
# ============================================================================
# NPL MIS Portal — FULL verification (static + unit + server e2e suites).
#
#   bun run verify:full
#
# Prerequisites (run once, e.g. via `bun run setup:local`):
#   • local stack up:  bun run docker:dev     (PostgreSQL + realtime)
#   • database migrated + seeded (demo users are required by the suites)
#   • nothing else listening on port 3000 — this script starts and stops its
#     OWN production server there
#
# What it does:
#   1. runs scripts/verify.sh (typecheck · lint · unit tests · production build)
#   2. starts the built standalone server on :3000 with the local .env
#   3. runs the three API e2e suites, RESTARTING the server between suites
#      (login rate limiting is per-process — fresh buckets per suite match the
#      validated back-to-back pattern)
#   4. tears the server down and reports a summary
# ============================================================================
set -euo pipefail

cd "$(cd "$(dirname "$0")/.." && pwd)"

BOLD='' GREEN='' RED='' YELLOW='' CLEAR=''
if [ -t 1 ]; then BOLD='\033[1m' GREEN='\033[32m' RED='\033[31m' YELLOW='\033[33m'; fi

info() { printf "  %s\n" "$1"; }
good() { printf "  ${GREEN}✓ %s${CLEAR}\n" "$1"; }
warn() { printf "  ${YELLOW}⚠ %s${CLEAR}\n" "$1"; }
die()  { printf "  ${RED}✗ %s${CLEAR}\n" "$1"; exit 1; }

SERVER_PID=""
cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
    info "stopped the verification server"
  fi
  pkill -f "standalone/server.js" 2>/dev/null || true
}
trap cleanup EXIT

start_server() {
  # (re)start the production standalone server with the local .env loaded
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  pkill -f "standalone/server.js" 2>/dev/null || true
  sleep 1

  set -a
  # shellcheck disable=SC1091
  [ -f .env ] && . ./.env
  set +a

  # node is the production runtime; bun runs the standalone server equally
  # well (the container uses node, the dev workflow may only have bun).
  if command -v node >/dev/null 2>&1; then
    NODE_ENV=production PORT=3000 \
      node .next/standalone/server.js > /tmp/npl-verify-server.log 2>&1 &
  else
    NODE_ENV=production PORT=3000 \
      bun .next/standalone/server.js > /tmp/npl-verify-server.log 2>&1 &
  fi
  SERVER_PID=$!

  local code="000"
  for i in $(seq 1 60); do
    # curl's -w http_code prints "000" on connection failure (curl exits 7 —
    # `|| true` keeps `set -e` from killing the script on the refused probe)
    code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
    [ -z "$code" ] && code=000
    [ "$code" = "200" ] && break
    sleep 1
  done
  if [ "$code" != "200" ]; then
    die "verification server did not become healthy (last code: $code). Log: /tmp/npl-verify-server.log"
  fi
  local ready
  ready="$(curl -s --max-time 5 http://127.0.0.1:3000/api/ready 2>/dev/null || true)"
  case "$ready" in
    *'"database":"up"'*) ;;
    *) die "database not reachable (/api/ready → '${ready:-no answer}'). Start the local stack: bun run docker:dev" ;;
  esac
}

printf "${BOLD}NPL MIS Portal — FULL verification${CLEAR}\n"

# ---- 1. static + unit + build -----------------------------------------------
printf "\n${BOLD}[1/4] Static checks, unit tests, production build${CLEAR}\n"
if ! bash scripts/verify.sh; then
  die "static verification failed — fix the reported problems first"
fi

# ---- 2. environment & port ---------------------------------------------------
printf "\n${BOLD}[2/4] Preparing the verification server${CLEAR}\n"
[ -f .env ] || die "no .env found — run: bun run setup:local"
[ -f .next/standalone/server.js ] || die "no standalone build found (.next/standalone/server.js)"

probe="$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:3000/api/health 2>/dev/null || true)"
[ -z "$probe" ] && probe=000
if [ "$probe" != "000" ]; then
  die "port 3000 is already serving HTTP (probe: $probe). Stop the running server first — this script manages its own."
fi
info "port 3000 is free"

start_server
good "production server up (database reachable)"

# ---- 3. e2e suites (server restarted between suites) ------------------------
printf "\n${BOLD}[3/4] API e2e suites${CLEAR}\n"

FAILED_SUITES=0

run_suite() { # run_suite <label> <npm-script>
  printf "\n${BOLD}▶ e2e: %s${CLEAR}\n" "$1"
  start_server   # fresh process → fresh in-memory rate-limit buckets
  if bun run "$2"; then
    good "$1 — passed"
  else
    printf "  ${RED}✗ %s — FAILED${CLEAR}\n" "$1"
    FAILED_SUITES=$((FAILED_SUITES+1))
  fi
}

run_suite "core API (auth · RBAC · CRUD · concurrency · import · audit · reports)" test:e2e
run_suite "Excel import duplicate-prevention (11 scenarios + race + perf)"        test:import
run_suite "password reset (tokens · single-use · expiry · rate limits · audit)"   test:reset

# ---- 4. summary ---------------------------------------------------------------
printf "\n${BOLD}[4/4] Summary${CLEAR}\n"
printf "  Static + unit + build : ok\n"
printf "  Core API e2e          : %s\n" "$([ $FAILED_SUITES -eq 0 ] && echo ok || echo see above)"
printf "  Import dedup e2e      : %s\n" "$([ $FAILED_SUITES -eq 0 ] && echo ok || echo see above)"
printf "  Password reset e2e    : %s\n" "$([ $FAILED_SUITES -eq 0 ] && echo ok || echo see above)"
if [ "$FAILED_SUITES" -eq 0 ]; then
  printf "  ${GREEN}FULL VERIFICATION PASSED${CLEAR}\n"
else
  printf "  ${RED}${FAILED_SUITES} e2e suite(s) FAILED${CLEAR}\n"
  exit 1
fi
