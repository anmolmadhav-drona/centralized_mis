#!/bin/bash
# na-login.sh — Auth.js credentials login for shell test scripts.
# Usage:
#   source "$(dirname "$0")/lib/na-login.sh"
#   na_login "http://localhost:3000" "admin@npl.com" "Admin@123"
#   echo "$NA_COOKIE"   # cookie header value (authjs.session-token=…)
na_login() {
  local base=$1 email=$2 password=$3
  local jar=/tmp/na-jar-$$
  rm -f "$jar"
  local csrf
  csrf=$(curl -s -c "$jar" "$base/api/auth/csrf" | python3 -c 'import json,sys;print(json.load(sys.stdin)["csrfToken"])' 2>/dev/null)
  if [ -z "$csrf" ]; then
    NA_COOKIE=""
    return 1
  fi
  curl -s -b "$jar" -c "$jar" -o /dev/null -X POST "$base/api/auth/callback/credentials" \
    -H 'content-type: application/x-www-form-urlencoded' \
    --data-urlencode "csrfToken=$csrf" \
    --data-urlencode "email=$email" \
    --data-urlencode "password=$password" \
    --data-urlencode "callbackUrl=$base/"
  NA_COOKIE=$(awk '$6 ~ /authjs\.session-token/ {print $6"="$7}' "$jar" | paste -sd';' -)
  rm -f "$jar"
  [ -n "$NA_COOKIE" ]
}
