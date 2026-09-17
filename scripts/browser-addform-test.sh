#!/bin/bash
# Browser E2E — the updated Add MIS Entry popup:
#   sections, pre-filled defaults, badge dropdown options, live suggestions,
#   progress counter, and a real end-to-end add (grid + API verification).
# Runs INSIDE one bash invocation (with-server.sh keeps the dev server up).
# NOTE: agent-browser eval returns JSON — unwrap with python; return STRINGS only.
set -u
cd /home/z/my-project
mkdir -p download
PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected [$3] got [$2]"; fi }
okc() { if echo "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — [$2] lacks [$3]"; fi }

AB="agent-browser"
# BASE: where the browser goes; API: where curl goes (auth + persistence checks).
# Defaults verify the local gateway; override to hit the real portal preview URL.
BASE="${ADDTEST_BASE:-http://localhost:81}"
API="${ADDTEST_API:-http://localhost:3000}"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

# ---------------------------------------------------------------- 0. open + login
$AB open "$BASE" >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
LOGGED=$(ev 'document.body.textContent.includes("MIS") ? "yes" : "no"')
ok "login (shell visible)" "$LOGGED" "yes"

# go to MIS view
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS" || x.textContent.trim()==="Centralized MIS"); if(!b) return "not-found"; b.click(); return "ok" })()' >/dev/null
sleep 3
ROWS=$(ev 'document.querySelectorAll(".ag-row").length')
okc "MIS grid rendering" "$ROWS" "^[0-9]" # any digits = grid rows

# ---------------------------------------------------------------- 1. open the Add popup
$AB find role button click --name "Add MIS Entry" >/dev/null 2>&1
sleep 2
DIALOG=$(ev 'document.querySelector("[role=dialog]") ? "yes" : "no"')
ok "Add dialog opens" "$DIALOG" "yes"

# ---------------------------------------------------------------- 2. sections render
SECTIONS=$(ev '[...document.querySelectorAll("[role=dialog] section h4")].map(h=>h.textContent).join("|")')
okc "section: Shipment & Route" "$SECTIONS" "Shipment & Route"
okc "section: Consignee & Material" "$SECTIONS" "Consignee & Material"
okc "section: Charges" "$SECTIONS" "Charges"
okc "section: Delivery Tracking" "$SECTIONS" "Delivery Tracking"
okc "section: Billing & POD" "$SECTIONS" "Billing & POD"
okc "section: Remarks & Damage" "$SECTIONS" "Remarks & Damage"

# ---------------------------------------------------------------- 3. defaults pre-filled
DEF_PICKUP=$(ev 'document.getElementById("f-pickupLocation")?.value || "MISSING"')
ok "default Pickup Location = Sonipat" "$DEF_PICKUP" "Sonipat"
DEF_TRANSPORTER=$(ev 'document.getElementById("f-transporterName")?.value || "MISSING"')
ok "default Transporter = Drona Logitech" "$DEF_TRANSPORTER" "Drona Logitech"
TODAYCHK=$(ev '(() => { const b=[...document.querySelectorAll("[role=dialog] button")].find(x=>x.querySelector("svg.lucide-calendar")); const d=new Date(); const M=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]; const exp=String(d.getDate()).padStart(2,"0")+"-"+M[d.getMonth()]+"-"+d.getFullYear(); return b && b.textContent.includes(exp) ? "match:"+exp : "mismatch:btn=["+(b?b.textContent:"NONE")+"] exp=["+exp+"]" })()')
okc "LR Date defaults to today" "$TODAYCHK" "^match:"
# dropdown defaults shown in triggers
DEF_LRSTATUS=$(ev '(() => { const t=[...document.querySelectorAll("[role=dialog] [id^=f-lrStatus] button, [role=dialog] button[id^=f-lrStatus]")]; const el=t[0]; return el ? el.textContent : "MISSING" })()')
okc "default LR Status = To be Billed" "$DEF_LRSTATUS" "To be Billed"
DEF_DAMAGE=$(ev '(() => { const els=[...document.querySelectorAll("[role=dialog] button")].filter(b=>b.id.startsWith("f-damage")); return els[0] ? els[0].textContent : "MISSING" })()')
okc "default Damage = No" "$DEF_DAMAGE" "No"

# ---------------------------------------------------------------- 4. progress counter
PROG=$(ev '(() => { const p=[...document.querySelectorAll("[role=dialog] p, [role=dialog] span")].map(x=>x.textContent).find(t=>/\/ 3[0-9] filled|\/3[0-9] filled/.test(t)); return p || "MISSING" })()')
okc "progress counter shows N/32 filled" "$PROG" "filled"
NEEDS=$(ev '(() => { const p=[...document.querySelectorAll("[role=dialog] span")].map(x=>x.textContent).find(t=>t.startsWith("Needs:")); return p || "MISSING" })()')
okc "required-hint lists missing fields" "$NEEDS" "Needs: Party Name"
okc "required-hint includes LR No." "$NEEDS" "LR No"
okc "required-hint includes Destination" "$NEEDS" "Destination"

# ---------------------------------------------------------------- 5. Delivery Status dropdown renders BADGES
# open the deliveryStatus select
ev '(() => { const trg=[...document.querySelectorAll("[role=dialog] button")].filter(b=>b.id.startsWith("f-deliveryStatus")); if(!trg.length) return "not-found"; trg[0].click(); return "ok" })()' >/dev/null
sleep 1
OPTS=$(ev '(() => { const opts=[...document.querySelectorAll("[role=option]")]; const badges=opts.filter(o=>o.querySelector("span.badge-tone")); const tones=opts.map(o=>{const b=o.querySelector("span.badge-tone"); return b?Array.from(b.classList).filter(c=>c.startsWith("badge-")).join(","):null}).filter(Boolean); return JSON.stringify({total:opts.length,badged:badges.length,tones:tones.join(";")}) })()')
TOTALOPTS=$(echo "$OPTS" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d['total'])" 2>/dev/null)
BADGEOPTS=$(echo "$OPTS" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d['badged'])" 2>/dev/null)
TONES=$(echo "$OPTS" | python3 -c "import sys,json;d=json.loads(sys.stdin.read());print(d['tones'])" 2>/dev/null)
ok "deliveryStatus lists 7 options" "$TOTALOPTS" "7"
ok "all 7 options render as badge pills" "$BADGEOPTS" "7"
okc "tone: Delivered=success" "$TONES" "badge-success"
okc "tone: Pending=warning" "$TONES" "badge-warning"
okc "tone: In transit=info" "$TONES" "badge-info"
okc "tone: Return=danger" "$TONES" "badge-danger"
# select 'In transit' (badge-info)
ev '(() => { const o=[...document.querySelectorAll("[role=option]")].find(x=>x.textContent.trim()==="In transit"); if(!o) return "not-found"; o.click(); return "ok" })()' >/dev/null
sleep 1
TRIG_TONE=$(ev '(() => { const trg=[...document.querySelectorAll("[role=dialog] button")].filter(b=>b.id.startsWith("f-deliveryStatus")); const b=trg[0]?.querySelector("span.badge-tone"); return b ? (b.classList.contains("badge-info") ? "yes" : "no:"+b.className) : "MISSING" })()')
ok "trigger shows selected value as badge (info)" "$TRIG_TONE" "yes"

# ---------------------------------------------------------------- 6. Party Name suggestions
# fill via the React native-value setter (agent-browser fill is unreliable here)
ev '(() => { const i=document.getElementById("f-partyName"); if(!i) return "not-found"; i.focus(); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; set.call(i,"Ghumman"); i.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()' >/dev/null
sleep 2   # debounce 220ms + fetch
SUGG=$(ev '(() => { const items=[...document.querySelectorAll("[data-radix-popper-content-wrapper] button")].filter(b=>b.textContent.includes("used ")); return items.map(b=>b.textContent.trim()).join(" || ") })()')
okc "party suggestions filtered by query" "$SUGG" "Ghumman Distributors"
okc "suggestions show usage counts" "$SUGG" "used"
# pick the first suggestion with a real click
ev '(() => { const b=[...document.querySelectorAll("[data-radix-popper-content-wrapper] button")].filter(x=>x.textContent.includes("Ghumman Distributors")); if(!b.length) return "not-found"; b[0].click(); return "ok" })()' >/dev/null
sleep 1
PICKED=$(ev 'document.getElementById("f-partyName")?.value || "MISSING"')
ok "picked suggestion fills Party Name" "$PICKED" "Ghumman Distributors Pvt LTD"

# ---------------------------------------------------------------- 7. Destination suggestions
ev '(() => { const i=document.getElementById("f-destination"); if(!i) return "not-found"; i.focus(); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; set.call(i,"delhi"); i.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()' >/dev/null
sleep 2
DSUGG=$(ev '(() => { const items=[...document.querySelectorAll("[data-radix-popper-content-wrapper] button")].filter(b=>b.textContent.includes("used ")); return items.map(b=>b.textContent.trim()).join(" || ") })()')
okc "destination suggestions filtered" "$DSUGG" "Delhi"
ev '(() => { const b=[...document.querySelectorAll("[data-radix-popper-content-wrapper] button")].filter(x=>/delhi/i.test(x.textContent) && x.textContent.includes("used")); if(!b.length) return "not-found"; b[0].click(); return "ok" })()' >/dev/null
sleep 1
DPICKED=$(ev 'document.getElementById("f-destination")?.value || "MISSING"')
okc "picked destination (contains Delhi)" "$DPICKED" "Delhi"

# ---------------------------------------------------------------- 8. complete the record
FILL_JS='(() => { const i=document.getElementById("%ID%"); if(!i) return "not-found"; const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,"value").set; set.call(i,"%VAL%"); i.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()'
fill_input() {
  local js="${FILL_JS//'%ID%'/$1}"
  js="${js//'%VAL%'/$2}"
  ev "$js" >/dev/null 2>&1 || true
}
fill_input f-lrNo "999961"
sleep 1
# formula in a numeric field still works from the form
fill_input f-bucket "100"
fill_input f-loadingCharges "=Bucket*3"
sleep 1
READY=$(ev '(() => { const t=[...document.querySelectorAll("[role=dialog] span")].map(x=>x.textContent).find(x=>x.includes("All required fields filled")); return t ? "ready" : "not-ready" })()')
ok "all-required indicator turns green" "$READY" "ready"

# submit
$AB screenshot download/addform-filled.png >/dev/null 2>&1
ev '(() => { const b=[...document.querySelectorAll("[role=dialog] button")].find(x=>x.textContent.trim()==="Add Record"); if(!b) return "not-found"; b.click(); return "ok" })()' >/dev/null
sleep 3
DIALOG2=$(ev 'document.querySelector("[role=dialog]") ? "open" : "closed"')
ok "dialog closes after save" "$DIALOG2" "closed"
TOAST=$(ev '(() => { return document.body.textContent.includes("Record added") ? "yes":"no" })()')
ok "success toast shown" "$TOAST" "yes"

# ---------------------------------------------------------------- 9. verify persistence via API
source "$(dirname "$0")/lib/na-login.sh"
na_login ""$API"" "admin@npl.com" "Admin@123" || { echo "LOGIN FAILED"; exit 1; }
COOKIE="$NA_COOKIE"CREATED=$(curl -s "$API/api/records?search=999961" -H "cookie: $COOKIE")
okc "API: record exists (LR 999961)" "$CREATED" '"lrNo":999961'
okc "API: party picked from suggestion" "$CREATED" 'Ghumman Distributors'
okc "API: default pickupLocation stored" "$CREATED" '"pickupLocation":"Sonipat"'
okc "API: default lrStatus stored" "$CREATED" '"lrStatus":"To be Billed"'
okc "API: deliveryStatus = In transit" "$CREATED" '"deliveryStatus":"In transit"'
REC_ID=$(echo "$CREATED" | python3 -c "import sys,json;print(json.load(sys.stdin.stdin if False else sys.stdin)['rows'][0]['id'])" 2>/dev/null)
FORMULA_OK=$(echo "$CREATED" | python3 -c "
import sys,json
d=json.load(sys.stdin)
r=d['rows'][0]
print(r.get('_formulas',{}).get('loadingCharges','-'), r.get('loadingCharges','-'))" 2>/dev/null)
okc "API: formula =Bucket*3 stored" "$FORMULA_OK" "=Bucket"
okc "API: formula computed value 300" "$FORMULA_OK" "300"

# ---------------------------------------------------------------- 10. grid shows the new record
GRIDSEARCH_JS="(() => { const s=document.querySelector('input[placeholder*=\"Search LR\"]'); if(s){ s.focus(); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(s,'999961'); s.dispatchEvent(new Event('input',{bubbles:true})); return 'ok' } return 'not-found' })()"
ev "$GRIDSEARCH_JS" >/dev/null
sleep 4
GRIDROW=$(ev '(() => { const cells=[...document.querySelectorAll(".ag-row .ag-cell")]; const hit=cells.find(c=>c.textContent.trim()==="999961"); return hit ? "found" : "missing" })()')
ok "new record visible in grid" "$GRIDROW" "found"
$AB screenshot download/addform-grid-row.png >/dev/null 2>&1

# ---------------------------------------------------------------- 11. cleanup
if [ -n "$REC_ID" ]; then
  DELCODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE "$API/api/records/$REC_ID" -H "cookie: $COOKIE")
  ok "cleanup delete 200" "$DELCODE" "200"
else
  echo "  ✗ cleanup — no REC_ID"
  FAIL=$((FAIL+1))
fi

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ] || exit 1
