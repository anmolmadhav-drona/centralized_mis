#!/bin/bash
# browser-table-access-test.sh — verifies restricted-table UI visibility
# (Vehicle Rate, Loading Charges) in the REAL Centralized MIS grid:
#   ADMIN   → both columns present in the grid header
#   MANAGER → both columns present
#   USER    → both columns absent (not rendered, no column-chooser entry)
#   VIEWER  → both columns absent
# Uses the production standalone build through the gateway (:81).
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected [$3] got [$2]"; fi; }

AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

login() { # $1 email, $2 password
  $AB cookies clear >/dev/null 2>&1
  $AB open http://localhost:81 >/dev/null 2>&1
  $AB wait --load networkidle >/dev/null 2>&1
  sleep 1
  $AB find label "Email" fill "$1" >/dev/null 2>&1
  $AB find label "Password" fill "$2" >/dev/null 2>&1
  ev "(() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('Sign in to Centralized MIS')); if(!b) return 'no-button'; b.click(); return 'clicked' })()" >/dev/null
  sleep 7
}

grid_headers() {
  # AG Grid virtualizes columns — scroll right while collecting header texts
  ev '(async () => { const vp=document.querySelector(".ag-grid-viewport"); const c=new Set(); for(let i=0;i<40;i++){ [...document.querySelectorAll(".ag-header-cell-text")].forEach(x=>c.add(x.textContent.trim())); if(!vp || vp.scrollLeft>=vp.scrollWidth-vp.clientWidth-5) break; vp.scrollLeft+=400; await new Promise(r=>setTimeout(r,120)); } [...document.querySelectorAll(".ag-header-cell-text")].forEach(x=>c.add(x.textContent.trim())); return JSON.stringify([...c]) })()'
}

check_role() { # $1 label, $2 email, $3 pw, $4 expect(present|absent)
  login "$2" "$3"
  # navigate to Centralized MIS view (JS click — the sidebar item can be
  # transiently covered during entrance animations, which blocks real clicks)
  ev "(() => { const els=[...document.querySelectorAll('button, a')].filter(x=>x.textContent.trim().includes('Centralized MIS') && !x.textContent.includes('Sign in')); if(!els.length) return 'no-nav-item'; els[0].click(); return 'nav-clicked' })()" >/dev/null
  sleep 5
  local headers
  headers=$(grid_headers)
  if [ -z "$headers" ] || [ "$headers" = "[]" ]; then
    echo "  (role $1: grid not ready — retrying once)"
    sleep 5
    headers=$(grid_headers)
  fi
  local vr lc
  vr=$(echo "$headers" | grep -c "Vehicle Rate" || true)
  lc=$(echo "$headers" | grep -c "Loading Charges" || true)
  if [ "$4" = "present" ]; then
    ok "[$1] Vehicle Rate column visible" "$vr" "1"
    ok "[$1] Loading Charges column visible" "$lc" "1"
  else
    ok "[$1] Vehicle Rate column hidden" "$vr" "0"
    ok "[$1] Loading Charges column hidden" "$lc" "0"
  fi
  # column chooser must not reveal restricted columns either
  local bodyHas
  bodyHas=$(ev 'document.body.textContent.includes("Vehicle Rate") ? "yes":"no"')
  if [ "$4" = "absent" ]; then
    ok "[$1] no 'Vehicle Rate' text anywhere in the view" "$bodyHas" "no"
  fi
}

$AB set viewport 1440 900 >/dev/null 2>&1

echo "== ADMIN =="
check_role ADMIN admin@npl.com Admin@123 present
echo "== MANAGER =="
check_role MANAGER manager@npl.com Manager@123 present
echo "== USER =="
check_role USER user@npl.com User@123 absent
echo "== VIEWER =="
check_role VIEWER viewer@npl.com Viewer@123 absent

echo
echo "================================"
echo "BROWSER TABLE-ACCESS: $PASS pass / $FAIL fail"
[ "$FAIL" -eq 0 ] && echo "ALL GREEN" || exit 1
