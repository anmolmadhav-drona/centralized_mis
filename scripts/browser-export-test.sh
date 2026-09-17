#!/bin/bash
# browser-export-test.sh — verifies the filterwise Excel export IN THE REAL UI:
#   1. structured-panel filter (Destination) → grid total drops → Export POST
#      body carries the exact AG Grid filter model
#   2. floating-filter path (grid API setFilterModel, like header filter UI)
#   3. download succeeds (status/x-file-name/content-length), toast count matches
#   4. cleared filters → export body has no filterModel
# NOTE: Radix DropdownMenu opens on pointerdown — use agent-browser real
# clicks for the Export menu; plain inputs/buttons via native setters.
set -u
cd /home/z/my-project
mkdir -p download
PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected [$3] got [$2]"; fi }
okc() { if echo "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — [$2] lacks [$3]"; fi }

AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }
setinput() {  # $1 = element id or selector, $2 = value
  ev "(() => { const i=document.querySelector('$1'); if(!i) return 'not-found'; i.focus(); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,'$2'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok' })()" >/dev/null
}

# ---------------------------------------------------------------- 0. login
$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
ok "login" "$(ev 'document.body.textContent.includes("MIS") ? "yes" : "no"')" "yes"

# go to MIS view
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS" || x.textContent.trim()==="Centralized MIS"); if(!b) return "not-found"; b.click(); return "ok" })()' >/dev/null
sleep 4
okc "MIS grid rendering" "$(ev 'document.querySelectorAll(".ag-row").length')" "^[0-9]"

TOTAL0=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export [0-9,]+ Records?$/.test(x.trim())); return t ? t.trim() : "MISSING" })()')
okc "export button shows full total (340)" "$TOTAL0" "340"

# ---------------------------------------------------------------- 1. structured-panel filter (Destination = HISAR)
# make sure no stale menu blocks the page, then open the Filters popover with a REAL click (Radix)
$AB press Escape >/dev/null 2>&1
sleep 0.5
$AB find role button click --name "Filters" >/dev/null 2>&1
sleep 1.5
POPO=$(ev 'document.querySelector("input[placeholder=\"e.g. Delhi\"]") ? "open" : "closed"')
ok "filters popover opens" "$POPO" "open"
# destination is a plain Input with placeholder "e.g. Delhi"
setinput 'input[placeholder="e.g. Delhi"]' "HISAR"
sleep 0.5
# click "Apply filters" (plain Button — synthetic click ok; note lowercase f)
APPLIED=$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Apply filters"); if(!b) return "no-apply"; b.click(); return "applied" })()')
ok "Apply filters clicked" "$APPLIED" "applied"
sleep 4

CHIPS=$(ev '(() => { const chips=[...document.querySelectorAll("[data-radix-popper-content-wrapper] *, body span, body button")].map(x=>x.textContent).filter(t=>t && t.includes("HISAR")); return chips.length ? "chips-present" : "no-chips" })()')
okc "filter chips show HISAR" "$CHIPS" "chips-present"

TOTAL1=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export [0-9,]+ Records?$/.test(x.trim())); return t ? t.trim() : "MISSING" })()')
ok "filtered total < full total" "$(python3 -c "
import re
m1=re.search(r'Export ([0-9,]+) Records?','''$TOTAL1''')
m0=re.search(r'Export ([0-9,]+) Records?','''$TOTAL0''')
t1=int(m1.group(1).replace(',','')) if m1 else -1
t0=int(m0.group(1).replace(',','')) if m0 else -1
print('yes' if 0 < t1 < t0 else 'no')")" "yes"
echo "    (full=$TOTAL0 → filtered=$TOTAL1)"
# case-insensitivity (Excel semantics): HISAR uppercase query must match Hisar rows too
NUM1=$(python3 -c "
import re
m=re.search(r'Export ([0-9,]+) Records?','''$TOTAL1''')
print(int(m.group(1).replace(',','')) if m else -1)")
ok "equals filter is case-insensitive (HISAR query → 5 rows incl. Hisar)" "$(python3 -c "print('yes' if $NUM1 == 5 else 'no:'+str($NUM1))")" "yes"

# ---------------------------------------------------------------- 2. intercept the export POST
ev '(() => {
  window.__exportCalls = [];
  const orig = window.fetch;
  window.fetch = async function(...args) {
    const [url, init] = args;
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (u.includes("/api/export")) {
      const entry = { url: u, body: null, status: null, fileName: null, bytes: null };
      try { entry.body = init && init.body ? JSON.parse(String(init.body)) : null } catch(e) { entry.body = String(init && init.body) }
      const res = await orig.apply(this, args);
      entry.status = res.status;
      entry.fileName = res.headers.get("x-file-name");
      entry.bytes = res.headers.get("content-length");
      window.__exportCalls.push(entry);
      return res;
    }
    return orig.apply(this, args);
  };
  return "patched";
})()' >/dev/null

# open the Export dropdown with a REAL click (Radix DropdownMenu — pointerdown)
$AB press Escape >/dev/null 2>&1
sleep 0.5
EXPORTBTN=$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>/^Export [0-9,]+ Records?$/.test(x.textContent.trim())); return b ? b.textContent.trim() : "MISSING" })()')
echo "    export button text: $EXPORTBTN"
$AB find role button click --name "$EXPORTBTN" >/dev/null 2>&1
sleep 1.5
MENUOPEN=$(ev 'document.querySelector("[role=menu]") ? "open" : "closed"')
ok "export dropdown opens (real click)" "$MENUOPEN" "open"
# Download .xlsx — real click (it is inside the Radix menu)
$AB find role menuitem click --name "Download .xlsx" >/dev/null 2>&1
# toast check early (sonner auto-dismisses after ~4s)
sleep 2
TOAST=$(ev '(() => { const t=[...document.querySelectorAll("[data-sonner-toast], [role=status], body li")].map(x=>x.textContent).find(x=>x && x.includes("Exported")); return t ? "toast: "+t.slice(0,90) : "MISSING" })()')
okc "success toast with filtered count" "$TOAST" "Exported"
sleep 3

CALL=$(ev '(() => { const c=window.__exportCalls && window.__exportCalls[0]; if(!c) return "NO-CALL"; return JSON.stringify({status:c.status, fileName:c.fileName, bytes:Number(c.bytes), filter:c.body && c.body.filterModel, search:c.body && c.body.search, sort:c.body && c.body.sortModel, summary:c.body && c.body.includeSummary}) })()')
echo "    export call: $CALL"
okc "export POST sent (status 200)" "$CALL" '"status":200'
okc "xlsx filename header present" "$CALL" 'MIS_Export_'
okc "filterModel carried in POST body" "$CALL" 'destination'
okc "filter value HISAR present" "$CALL" 'HISAR'
ok "content-length present (>5KB, valid xlsx)" "$(python3 -c "
import json
try:
  d=json.loads('''$CALL'''); b=d.get('bytes') or 0; print('yes' if b and b>5000 else 'no:'+str(b))
except Exception as e: print('parse-fail')")" "yes"
ok "search empty in body" "$(python3 -c "
import json
try:
  d=json.loads('''$CALL'''); print('yes' if not d.get('search') else 'no:'+str(d['search']))
except Exception as e: print('parse-fail')")" "yes"

# body filter must equal the grid's live filter model
BODYVSGRID=$(ev '(() => {
  const c=window.__exportCalls[0]; if(!c||!c.body||!c.body.filterModel) return "no-body";
  const api=window.__misApi; if(!api||typeof api.getFilterModel!=="function") return "no-api";
  const grid=api.getFilterModel();
  const same=JSON.stringify(c.body.filterModel)===JSON.stringify(grid);
  return same ? "match" : "mismatch:body="+JSON.stringify(c.body.filterModel)+" grid="+JSON.stringify(grid);
})()')
ok "export body filterModel == live grid filter model (exact)" "$BODYVSGRID" "match"

TOASTCHK=1  # toast already checked above (early timing)
# ---------------------------------------------------------------- 3. floating-filter path
# clear structured filters ("Clear all") then set a floating filter via grid API
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim().startsWith("Clear all")); if(!b) return "no-clear"; b.click(); return "cleared" })()' >/dev/null
sleep 4
ev '(() => {
  const api=window.__misApi; if(!api) return "no-api";
  api.setFilterModel({ partyName: { filterType:"text", type:"contains", filter:"UPSRTC" } });
  api.onFilterChanged();
  return "set";
})()' >/dev/null
sleep 4
TOTAL2=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export [0-9,]+ Records?$/.test(x.trim())); return t ? t.trim() : "MISSING" })()')
NUM2=$(python3 -c "
import re
m=re.search(r'Export ([0-9,]+) Records?','''$TOTAL2''')
print(int(m.group(1).replace(',','')) if m else -1)")
ok "grid total reflects floating-filter (UPSRTC, <340)" "$(python3 -c "print('yes' if 0 < $NUM2 < 340 else 'no')")" "yes"
echo "    (UPSRTC filtered total: $TOTAL2)"

# export again with the floating filter active
$AB press Escape >/dev/null 2>&1
sleep 0.5
$AB find role button click --name "$TOTAL2" >/dev/null 2>&1
sleep 1.5
ok "export dropdown re-opens" "$(ev 'document.querySelector("[role=menu]") ? "open" : "closed"')" "open"
$AB find role menuitem click --name "Download .xlsx" >/dev/null 2>&1
# early toast check
sleep 2
TOAST2=$(ev "(() => { const t=[...document.querySelectorAll('[data-sonner-toast], [role=status], body li')].map(x=>x.textContent).find(x=>x && x.includes('Exported')); return t && t.includes(String($NUM2)) ? 'yes' : 'toast-mismatch: '+(t||'none').slice(0,90) })()")
ok "toast count matches floating-filter total ($NUM2)" "$TOAST2" "yes"
sleep 3
CALL2=$(ev '(() => { const c=window.__exportCalls && window.__exportCalls[1]; if(!c) return "NO-CALL"; return JSON.stringify({status:c.status, filter:c.body && c.body.filterModel}) })()')
echo "    export call 2: $CALL2"
okc "second export carries floating-filter model" "$CALL2" "UPSRTC"
okc "second export excludes cleared destination filter" "$(python3 -c "
import json
try:
  d=json.loads('''$CALL2'''); fm=d.get('filter') or {}; print('yes' if 'destination' not in fm else 'no')
except Exception: print('parse-fail')")" "yes"

# ---------------------------------------------------------------- 4. cleared filters → no filterModel
ev '(() => { const api=window.__misApi; api.setFilterModel(null); api.onFilterChanged(); return "cleared" })()' >/dev/null
sleep 4
TOTAL3=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export [0-9,]+ Records?$/.test(x.trim())); return t ? t.trim() : "MISSING" })()')
okc "total back to 340 after clearing" "$TOTAL3" "340"
$AB find role button click --name "$TOTAL3" >/dev/null 2>&1
sleep 1
$AB find role menuitem click --name "Download .xlsx" >/dev/null 2>&1
sleep 5
CALL3=$(ev '(() => { const c=window.__exportCalls && window.__exportCalls[2]; if(!c) return "NO-CALL"; return JSON.stringify({status:c.status, hasFilter:!!(c.body && c.body.filterModel && Object.keys(c.body.filterModel).length)}) })()')
okc "cleared-filters export body has NO filterModel" "$CALL3" '"hasFilter":false'
okc "cleared-filters export still 200" "$CALL3" '"status":200'

# ---------------------------------------------------------------- 5. audit trail (API)
source "$(dirname "$0")/lib/na-login.sh"
na_login "http://localhost:3000" "admin@npl.com" "Admin@123" || { echo "LOGIN FAILED"; exit 1; }
COOKIE="$NA_COOKIE"
AUDIT=$(curl -s "http://localhost:3000/api/audit?limit=5" -H "cookie: $COOKIE")
okc "audit logs the EXPORT entries" "$AUDIT" "EXPORT"
okc "audit describes active filter columns (1 column)" "$(echo "$AUDIT" | head -c 3000)" "filters on 1 column"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] || exit 1
