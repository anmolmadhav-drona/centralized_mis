#!/bin/bash
# Focused debug — diagnose: (a) row order, (b) copy event, (c) fill formula copy
set -u
cd /home/z/my-project
AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

source "$(dirname "$0")/lib/na-login.sh"
na_login "http://localhost:3000" "admin@npl.com" "Admin@123" || { echo "LOGIN FAILED"; exit 1; }
COOKIE="$NA_COOKIE"
for i in 0 1 2; do
  B=$((100 + i * 10))
  curl -s -X POST http://localhost:3000/api/records -H "cookie: $COOKIE" -H 'content-type: application/json' \
    -d "{\"values\":{\"partyName\":\"Dbg Co $i\",\"destination\":\"City$i\",\"lrNo\":999930,\"lrDate\":\"2026-09-0$((i+1))\",\"bucket\":$B,\"deliveryStatus\":\"Pending\"}}" > /dev/null
done

$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS"); b.click(); return "ok" })()' >/dev/null
for i in $(seq 1 25); do ROWS=$(ev 'document.querySelectorAll(".ag-row").length'); [ "${ROWS:-0}" -gt 0 ] 2>/dev/null && break; sleep 1; done
ev '(() => { const el=document.querySelector("input[placeholder*=\"Search LR\"]"); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el,"999930"); el.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()' >/dev/null
sleep 4

echo "--- [a] grid row order (bucket values top to bottom) ---"
for r in 0 1 2; do
  ev "(() => { const c=document.querySelector('.ag-row[row-index=\"$r\"] .ag-cell[col-id=\"bucket\"]'); return c ? c.textContent.trim() : 'none' })()"
done

echo "--- [b] copy event diagnosis ---"
# click a cell first (single-cell selection)
C=$(ev 'JSON.stringify((() => { const c=document.querySelector(".ag-row[row-index=\"0\"] .ag-cell[col-id=\"bucket\"]"); if(!c) return null; const r=c.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })())')
echo "cell center: $C"
X=$(echo "$C" | python3 -c "import sys,json;print(json.load(sys.stdin)['x'])")
Y=$(echo "$C" | python3 -c "import sys,json;print(json.load(sys.stdin)['y'])")
$AB mouse move $X $Y >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse up left >/dev/null 2>&1
sleep 0.5
echo "range after click: $(ev 'JSON.stringify(window.__misExcel.getDebug().range)')"
# dispatch copy event
COPYRESULT=$(ev '(() => {
  try {
    const dt = new DataTransfer();
    const cell = document.querySelector(".ag-row[row-index=\"0\"] .ag-cell[col-id=\"bucket\"]");
    const ev2 = new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true });
    const dispatched = cell.dispatchEvent(ev2);
    return JSON.stringify({ dispatched, defaultPrevented: ev2.defaultPrevented, dtAfter: dt.getData("text/plain"), clip: window.__misExcel.getDebug().clipboardTsv });
  } catch (e) { return "ERR:" + e.message; }
})()')
echo "copy result: $COPYRESULT"

echo "--- [c] paste formula then check node data + fill ---"
LC=$(ev 'JSON.stringify((() => { window.__misApi.ensureColumnVisible("loadingCharges"); const c=document.querySelector(".ag-row[row-index=\"0\"] .ag-cell[col-id=\"loadingCharges\"]"); if(!c) return null; const r=c.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })())')
LX=$(echo "$LC" | python3 -c "import sys,json;print(json.load(sys.stdin)['x'])")
LY=$(echo "$LC" | python3 -c "import sys,json;print(json.load(sys.stdin)['y'])")
$AB mouse move $LX $LY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse up left >/dev/null 2>&1
sleep 0.4
ev 'window.__misExcel.testPaste("=Bucket*3")' >/dev/null
sleep 2.5
echo "nodeDataSample after paste: $(ev 'JSON.stringify(window.__misExcel.getDebug().nodeDataSample)')"
echo "cell text: $(ev '(() => { const c=document.querySelector(".ag-row[row-index=\"0\"] .ag-cell[col-id=\"loadingCharges\"]"); return c ? c.textContent.trim() : "none" })()')"
echo "lastOps: $(ev 'JSON.stringify(window.__misExcel.getDebug().lastOps)')"

echo "--- fill drag: handle position + drop target ---"
H=$(ev '(() => { const h=document.querySelector(".excel-fill-handle"); if(!h) return "no-handle"; const r=h.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)}) })()')
echo "handle: $H"
HX=$(echo "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)['x'])")
HY=$(echo "$H" | python3 -c "import sys,json;print(json.load(sys.stdin)['y'])")
TGT=$(ev 'JSON.stringify((() => { const c=document.querySelector(".ag-row[row-index=\"2\"] .ag-cell[col-id=\"loadingCharges\"]"); if(!c) return null; const r=c.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })())')
TX=$(echo "$TGT" | python3 -c "import sys,json;print(json.load(sys.stdin)['x'])")
TY=$(echo "$TGT" | python3 -c "import sys,json;print(json.load(sys.stdin)['y'])")
echo "drop target: $TGT"
$AB mouse move $HX $HY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
sleep 0.2
$AB mouse move $TX $(( (HY+TY)/2 )) >/dev/null 2>&1
sleep 0.2
$AB mouse move $TX $TY >/dev/null 2>&1
sleep 0.3
echo "during drag: mode=$(ev 'window.__misExcel.getDebug().mode') ghost=$(ev 'JSON.stringify(window.__misExcel.getDebug().lastGhost)')"
$AB mouse up left >/dev/null 2>&1
sleep 2.5
echo "after fill: lastGhost=$(ev 'JSON.stringify(window.__misExcel.getDebug().lastGhost)')"
echo "after fill: lastOps=$(ev 'JSON.stringify(window.__misExcel.getDebug().lastOps)' | head -c 600)"
for r in 0 1 2; do
  echo "LC row $r: $(ev "(() => { const c=document.querySelector('.ag-row[row-index=\"$r\"] .ag-cell[col-id=\"loadingCharges\"]"); return c ? c.textContent.trim() : 'none' })()")"
done
echo "nodeDataSample after fill: $(ev 'JSON.stringify(window.__misExcel.getDebug().nodeDataSample)')"

$AB screenshot download/excel-debug.png >/dev/null 2>&1
# cleanup
curl -s "http://localhost:3000/api/records?search=999930&end=10" -H "cookie: $COOKIE" | python3 -c "
import sys, json
for r in json.load(sys.stdin)['rows']: print(r['id'])" | while read id; do
  [ -n "$id" ] && curl -s -X DELETE "http://localhost:3000/api/records/$id" -H "cookie: $COOKIE" -o /dev/null
done
$AB close >/dev/null 2>&1
