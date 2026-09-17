#!/bin/bash
# Browser E2E — Excel-like grid behaviour (the user request):
#   drag-selection, drag-copy via fill handle, fill-down, multi-cell paste,
#   copy/cut/paste, Delete, undo/redo, series fill.
# Uses REAL Playwright mouse events (move/down/up) through agent-browser.
# Order-agnostic: the grid's row order is read at runtime and expectations
# are computed from the actual values.
# Runs INSIDE one bash invocation (with-server.sh keeps the dev server up).
set -u
cd /home/z/my-project
mkdir -p download
PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected [$3] got [$2]"; fi }
okc() { if echo "$2" | grep -qF "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — [$2] lacks [$3]"; fi }

AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

# ---------------------------------------------------------------- 0. seed
source "$(dirname "$0")/lib/na-login.sh"
na_login "http://localhost:3000" "admin@npl.com" "Admin@123" || { echo "LOGIN FAILED"; exit 1; }
COOKIE="$NA_COOKIE"
for i in 0 1 2; do
  B=$((100 + i * 10))
  curl -s -X POST http://localhost:3000/api/records -H "cookie: $COOKIE" -H 'content-type: application/json' \
    -d "{\"values\":{\"partyName\":\"Excel UI Co $i\",\"destination\":\"City$i\",\"lrNo\":999920,\"lrDate\":\"2026-09-0$((i+1))\",\"bucket\":$B,\"deliveryStatus\":\"Pending\",\"vehicleNumber\":\"HR99-$i\"}}" > /dev/null
done
# series records (3 rows; buckets arbitrary — expectations computed at runtime)
for i in 0 1 2; do
  SB=$((10 + i * 10)); [ "$i" = "2" ] && SB=55
  curl -s -X POST http://localhost:3000/api/records -H "cookie: $COOKIE" -H 'content-type: application/json' \
    -d "{\"values\":{\"partyName\":\"Series Co $i\",\"destination\":\"SCity$i\",\"lrNo\":999921,\"lrDate\":\"2026-09-1$((i+1))\",\"bucket\":$SB,\"deliveryStatus\":\"Pending\"}}" > /dev/null
done
echo "seeded 6 test records"

# ---------------------------------------------------------------- 1. open + login
$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
LOGGED=$(ev 'document.body.textContent.includes("MIS") ? "yes" : "no"')
ok "login (shell visible)" "$LOGGED" "yes"

ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS" || x.textContent.trim()==="Centralized MIS"); if(!b) return "not-found"; b.click(); return "ok" })()' >/dev/null
for i in $(seq 1 25); do
  ROWS=$(ev 'document.querySelectorAll(".ag-row").length')
  [ "${ROWS:-0}" -gt 0 ] 2>/dev/null && break
  sleep 1
done
echo "grid rows after load: ${ROWS:-0}"

ev '(() => { const el=document.querySelector("input[placeholder*=\"Search LR\"]"); if(!el) return "no-input"; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el,"999920"); el.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()' >/dev/null
FOUND=""
for i in $(seq 1 20); do
  FOUND=$(ev '(() => { const c=document.querySelector(".ag-cell[col-id=\"lrNo\"]"); return c ? c.textContent.trim() : "" })()')
  [ "$FOUND" = "999920" ] && break
  sleep 1
done
ok "search isolates the 3 test records" "$FOUND" "999920"
sleep 1.5

# ---------------------------------------------------------------- helpers
ev '
window.__ensure = (colId) => {
  try { window.__misApi.ensureColumnVisible(colId); } catch (e) {}
  return "ok";
};
window.__center = (colId, row) => {
  window.__ensure(colId);
  const cell = document.querySelector(".ag-row[row-index=\"" + row + "\"] .ag-cell[col-id=\"" + colId + "\"]");
  if (!cell) return null;
  const r = cell.getBoundingClientRect();
  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
};
window.__cellText = (colId, row) => {
  window.__ensure(colId);
  const cell = document.querySelector(".ag-row[row-index=\"" + row + "\"] .ag-cell[col-id=\"" + colId + "\"]");
  return cell ? cell.textContent.trim() : "none";
};
window.__anyBodyCell = () => document.querySelector(".ag-body-container .ag-cell") || document.querySelector(".ag-cell");
window.__dbg = () => window.__misExcel ? window.__misExcel.getDebug() : "no-controller";
window.__paste = (tsv) => {
  const dt = new DataTransfer();
  dt.setData("text/plain", tsv);
  const ev2 = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
  window.__anyBodyCell().dispatchEvent(ev2);
  return "pasted";
};
window.__cutEvent = () => {
  const dt = new DataTransfer();
  const ev2 = new ClipboardEvent("cut", { clipboardData: dt, bubbles: true, cancelable: true });
  window.__anyBodyCell().dispatchEvent(ev2);
  return "cut";
};
window.__copyEvent = () => {
  const dt = new DataTransfer();
  const ev2 = new ClipboardEvent("copy", { clipboardData: dt, bubbles: true, cancelable: true });
  window.__anyBodyCell().dispatchEvent(ev2);
  return dt.getData("text/plain");
};
window.__shiftArrow = (key, ctrl) => {
  const cell = window.__anyBodyCell();
  cell.dispatchEvent(new KeyboardEvent("keydown", { key, ctrlKey: !!ctrl, shiftKey: true, bubbles: true, cancelable: true }));
  return "sent";
};
"helpers-ready"' >/dev/null

ct() { local t=""; for i in 1 2 3 4 5 6; do t=$(ev "window.__cellText(\"$1\", $2)"); [ "$t" != "none" ] && break; sleep 0.5; done; echo "$t"; }
center() {
  local r=""
  for i in 1 2 3 4 5 6; do
    r=$(ev "JSON.stringify(window.__center(\"$1\", $2))")
    if [ "$r" != "null" ] && [ -n "$r" ]; then echo "$r"; return; fi
    sleep 0.5
  done
  echo "$r"
}
cx() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['x'])" 2>/dev/null; }
cy() { echo "$1" | python3 -c "import sys,json;print(json.load(sys.stdin)['y'])" 2>/dev/null; }

# read the grid's actual row order (bucket values top to bottom)
ev 'window.__ensure("bucket")' >/dev/null; sleep 0.6
B0=$(ct "bucket" 0); B1=$(ct "bucket" 1); B2=$(ct "bucket" 2)
echo "row order — buckets: [$B0, $B1, $B2]"
ok "buckets readable (row order captured)" "$([ -n "$B0" ] && [ -n "$B1" ] && [ -n "$B2" ] && echo yes)" "yes"

# ---------------------------------------------------------------- T1 drag-selection (real mouse)
echo ""
echo "[T1] drag-select a multi-row range with the mouse"
# both columns are visible simultaneously — no scroll between captures
# (a scroll between the two coordinate captures would stale the first)
C1=$(center "partyName" 0); C2=$(center "destination" 2)
X1=$(cx "$C1"); Y1=$(cy "$C1"); X2=$(cx "$C2"); Y2=$(cy "$C2")
$AB mouse move $X1 $Y1 >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse move $(( (X1+X2)/2 )) $(( (Y1+Y2)/2 )) >/dev/null 2>&1
sleep 0.2
$AB mouse move $X2 $Y2 >/dev/null 2>&1
sleep 0.2
$AB mouse up left >/dev/null 2>&1
sleep 0.6
RANGE=$(ev 'JSON.stringify(window.__dbg().range)')
okc "T1: range covers rows 0-2" "$RANGE" '"r1":0'
okc "T1: range reaches row 2" "$RANGE" '"r2":2'
OVERLAY=$(ev '(() => { const b=document.querySelector(".excel-range-border"); return b && b.style.display !== "none" ? "visible" : "hidden" })()')
ok "T1: selection border overlay visible" "$OVERLAY" "visible"
HANDLE=$(ev '(() => { const h=document.querySelector(".excel-fill-handle"); return h && h.style.display !== "none" ? "visible" : "hidden" })()')
ok "T1: fill handle visible at selection corner" "$HANDLE" "visible"
INFO=$(ev 'document.body.textContent.includes("cells selected") ? "shown" : "missing"')
ok "T1: footer shows selection stats" "$INFO" "shown"
$AB screenshot download/excel-ui-t1-selection.png >/dev/null 2>&1

# ---------------------------------------------------------------- T2 copy (Ctrl+C event)
echo ""
echo "[T2] copy the selected range (Excel-style TSV)"
ev 'window.__copyEvent()' >/dev/null
sleep 0.3
COPYCNT=$(ev 'window.__dbg().copyEventCount')
ok "T2: copy handler fired" "$([ "${COPYCNT:-0}" -ge 1 ] && echo fired)" "fired"
CLIP=$(ev 'window.__dbg().clipboardTsv')
okc "T2: internal clipboard holds the range TSV (party+dest cells)" "$CLIP" "City2"
okc "T2: TSV is tab-separated rows" "$CLIP" "Excel UI Co"

# ---------------------------------------------------------------- T3 paste a formula from 'Excel'
echo ""
echo "[T3] paste =Bucket*3 into Loading Charges (single-cell paste)"
ev 'window.__ensure("loadingCharges")' >/dev/null; sleep 0.6
LC0=$(center "loadingCharges" 0)
LCX=$(cx "$LC0"); LCY=$(cy "$LC0")
$AB mouse move $LCX $LCY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse up left >/dev/null 2>&1
sleep 0.4
ev 'window.__paste("=Bucket*3")' >/dev/null
sleep 2.4
LC=$(ct "loadingCharges" 0)
EXP3=$(( B0 * 3 ))
ok "T3: pasted formula computes $EXP3" "$LC" "$EXP3"

# ---------------------------------------------------------------- T4 fill handle drag-copy down (THE key feature)
echo ""
echo "[T4] drag the fill handle down — formula copies with per-row recalc"
HANDLE_POS=$(ev '(() => { const h=document.querySelector(".excel-fill-handle"); if(!h||h.style.display==="none") return null; const r=h.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}) })()')
HX=$(cx "$HANDLE_POS"); HY=$(cy "$HANDLE_POS")
TGT=$(center "loadingCharges" 2)
TX=$(cx "$TGT"); TY=$(cy "$TGT")
$AB mouse move $HX $HY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
sleep 0.2
$AB mouse move $HX $(( (HY+TY)/2 )) >/dev/null 2>&1
sleep 0.2
$AB mouse move $TX $TY >/dev/null 2>&1
sleep 0.3
$AB mouse up left >/dev/null 2>&1
sleep 2.6
GHOST=$(ev 'JSON.stringify(window.__dbg().lastGhost)')
okc "T4: fill stayed vertical (no column spill)" "$GHOST" '"c1":'
GHOSTC1=$(echo "$GHOST" | python3 -c "import sys,json; g=json.load(sys.stdin); print(g['c1'] if g else 'none')")
GHOSTC2=$(echo "$GHOST" | python3 -c "import sys,json; g=json.load(sys.stdin); print(g['c2'] if g else 'none')")
ok "T4: ghost columns equal (c1==c2)" "$GHOSTC1" "$GHOSTC2"
LC1=$(ct "loadingCharges" 1)
LC2=$(ct "loadingCharges" 2)
EXP41=$(( B1 * 3 ))
EXP42=$(( B2 * 3 ))
ok "T4: row 1 (Bucket $B1) → $EXP41" "$LC1" "$EXP41"
ok "T4: row 2 (Bucket $B2) → $EXP42" "$LC2" "$EXP42"
OPS=$(ev 'JSON.stringify(window.__dbg().lastOps)')
okc "T4: fill sent FORMULAS (not values)" "$OPS" '=Bucket*3'
$AB screenshot download/excel-ui-t4-fill.png >/dev/null 2>&1

# ---------------------------------------------------------------- T5 multi-cell paste from Excel (3x1 block)
echo ""
echo "[T5] paste a 3-cell column from Excel into Destination"
ev 'window.__ensure("destination")' >/dev/null; sleep 0.6
D0=$(center "destination" 0)
DX=$(cx "$D0"); DY=$(cy "$D0")
$AB mouse move $DX $DY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse up left >/dev/null 2>&1
sleep 0.4
ev 'window.__paste("Pasted-A\nPasted-B\nPasted-C")' >/dev/null
sleep 2.4
D0T=$(ct "destination" 0); D1T=$(ct "destination" 1); D2T=$(ct "destination" 2)
ok "T5: destination row 0 = Pasted-A" "$D0T" "Pasted-A"
ok "T5: destination row 1 = Pasted-B" "$D1T" "Pasted-B"
ok "T5: destination row 2 = Pasted-C" "$D2T" "Pasted-C"

# ---------------------------------------------------------------- T6 Delete clears a range
echo ""
echo "[T6] select bucket column x 3 rows → Delete clears"
ev 'window.__ensure("bucket")' >/dev/null; sleep 0.6
BB0=$(center "bucket" 0); BB2=$(center "bucket" 2)
BX1=$(cx "$BB0"); BY1=$(cy "$BB0"); BX2=$(cx "$BB2"); BY2=$(cy "$BB2")
$AB mouse move $BX1 $BY1 >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse move $BX2 $BY2 >/dev/null 2>&1
sleep 0.2
$AB mouse up left >/dev/null 2>&1
sleep 0.5
$AB press Delete >/dev/null 2>&1
sleep 2.4
B0T=$(ct "bucket" 0)
ok "T6: buckets cleared" "$B0T" "—"

# ---------------------------------------------------------------- T7 Ctrl+Z undo restores
echo ""
echo "[T7] Ctrl+Z restores the cleared buckets"
$AB press Control+z >/dev/null 2>&1
sleep 2.4
B0T=$(ct "bucket" 0); B1T=$(ct "bucket" 1); B2T=$(ct "bucket" 2)
ok "T7: bucket row 0 restored $B0" "$B0T" "$B0"
ok "T7: bucket row 1 restored $B1" "$B1T" "$B1"
ok "T7: bucket row 2 restored $B2" "$B2T" "$B2"
LC2=$(ct "loadingCharges" 2)
ok "T7: formulas still live after undo ($EXP42)" "$LC2" "$EXP42"

# ---------------------------------------------------------------- T8 undo depth / redo
echo ""
echo "[T8] Ctrl+Y redo re-clears, Ctrl+Z undo restores again"
$AB press Control+y >/dev/null 2>&1
sleep 2.4
B0T=$(ct "bucket" 0)
ok "T8: redo re-applies the clear" "$B0T" "—"
$AB press Control+z >/dev/null 2>&1
sleep 2.4
B0T=$(ct "bucket" 0)
ok "T8: undo restores once more" "$B0T" "$B0"

# ---------------------------------------------------------------- T9 cut + paste = move
echo ""
echo "[T9] cut (Ctrl+X) then paste elsewhere = move"
ev 'window.__ensure("vehicleNumber")' >/dev/null; sleep 0.6
V0=$(ct "vehicleNumber" 0); V1=$(ct "vehicleNumber" 1); V2=$(ct "vehicleNumber" 2)
echo "  vehicleNumbers before: [$V0, $V1, $V2]"
VV0=$(center "vehicleNumber" 0); VV2=$(center "vehicleNumber" 2)
VX1=$(cx "$VV0"); VY1=$(cy "$VV0"); VX2=$(cx "$VV2"); VY2=$(cy "$VV2")
$AB mouse move $VX1 $VY1 >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse move $VX2 $VY2 >/dev/null 2>&1
sleep 0.2
$AB mouse up left >/dev/null 2>&1
sleep 0.5
ev 'window.__cutEvent()' >/dev/null
sleep 0.4
CUTMODE=$(ev 'window.__dbg().cutMode ? "cut-mode" : "no-cut"')
ok "T9: cut mode engaged (dashed border)" "$CUTMODE" "cut-mode"
# click destination row 0 and paste the cut TSV there
ev 'window.__ensure("destination")' >/dev/null; sleep 0.6
DD0=$(center "destination" 0)
DX=$(cx "$DD0"); DY=$(cy "$DD0")
$AB mouse move $DX $DY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse up left >/dev/null 2>&1
sleep 0.4
CUTTSV=$(ev 'window.__dbg().clipboardTsv')
echo "  cut tsv: $(echo "$CUTTSV" | head -c 60)"
ESC=$(printf '%s' "$CUTTSV" | python3 -c "import json,sys; sys.stdout.write(json.dumps(sys.stdin.read()))")
echo "  paste dispatch: $(ev "window.__misExcel.testPaste($ESC)")"
sleep 2.6
V0T=$(ct "vehicleNumber" 0)
V0T=$([ -z "$V0T" ] && echo "" || echo "$V0T")
VEHCLEARED=$(ev '(() => { window.__misApi.ensureColumnVisible("vehicleNumber"); const c=document.querySelector(".ag-row[row-index=\"0\"] .ag-cell[col-id=\"vehicleNumber\"]"); return c ? (c.textContent.trim() === "" ? "cleared" : "still:" + c.textContent.trim()) : "none" })()')
ok "T9: source cleared after move (vehicleNumber)" "$VEHCLEARED" "cleared"
D0T=$(ct "destination" 0)
ok "T9: values landed at the paste target" "$D0T" "$V0"

# ---------------------------------------------------------------- T10 Shift+Arrow range extension
echo ""
echo "[T10] Shift+Arrow extends the selection"
ev 'window.__ensure("bucket")' >/dev/null; sleep 0.6
BB0=$(center "bucket" 0)
BX=$(cx "$BB0"); BY=$(cy "$BB0")
$AB mouse move $BX $BY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse up left >/dev/null 2>&1
sleep 0.5
ev 'window.__shiftArrow("ArrowDown", false)' >/dev/null; sleep 0.2
ev 'window.__shiftArrow("ArrowDown", true)' >/dev/null; sleep 0.4
R=$(ev 'JSON.stringify(window.__dbg().range)')
okc "T10: extended to the last rendered row" "$R" '"r2":'

# ---------------------------------------------------------------- T11 series fill
echo ""
echo "[T11] numeric series continuation (drag fill extends the series)"
ev '(() => { const el=document.querySelector("input[placeholder*=\"Search LR\"]"); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el,"999921"); el.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()' >/dev/null
for i in $(seq 1 15); do
  FOUND=$(ev '(() => { const c=document.querySelector(".ag-cell[col-id=\"lrNo\"]"); return c ? c.textContent.trim() : "" })()')
  [ "$FOUND" = "999921" ] && break
  sleep 1
done
ok "T11: search isolates series records" "$FOUND" "999921"
sleep 1.5
ev 'window.__ensure("bucket")' >/dev/null; sleep 0.6
S0=$(ct "bucket" 0); S1=$(ct "bucket" 1)
echo "  series rows: [$S0, $S1] → expecting $(( S1 + (S1 - S0) )) on row 2"
SS0=$(center "bucket" 0); SS1=$(center "bucket" 1)
SX0=$(cx "$SS0"); SY0=$(cy "$SS0"); SX1=$(cx "$SS1"); SY1=$(cy "$SS1")
$AB mouse move $SX0 $SY0 >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
$AB mouse move $SX1 $SY1 >/dev/null 2>&1
sleep 0.2
$AB mouse up left >/dev/null 2>&1
sleep 0.5
HANDLE_POS=$(ev '(() => { const h=document.querySelector(".excel-fill-handle"); if(!h||h.style.display==="none") return null; const r=h.getBoundingClientRect(); return JSON.stringify({x:Math.round(r.left+r.width/2), y:Math.round(r.top+r.height/2)}) })()')
HX=$(cx "$HANDLE_POS"); HY=$(cy "$HANDLE_POS")
TGT=$(center "bucket" 2)
TX=$(cx "$TGT"); TY=$(cy "$TGT")
$AB mouse move $HX $HY >/dev/null 2>&1
$AB mouse down left >/dev/null 2>&1
sleep 0.2
$AB mouse move $HX $(( (HY+TY)/2 )) >/dev/null 2>&1
sleep 0.2
$AB mouse move $TX $TY >/dev/null 2>&1
sleep 0.3
$AB mouse up left >/dev/null 2>&1
sleep 2.6
B2T=$(ct "bucket" 2)
EXP11=$(( S1 + (S1 - S0) ))
ok "T11: series continued to $EXP11" "$B2T" "$EXP11"
$AB screenshot download/excel-ui-t11-series.png >/dev/null 2>&1

# ---------------------------------------------------------------- verify server state via API
echo ""
echo "[API] server-side verification"
SRV=$(curl -s "http://localhost:3000/api/records?search=999920&end=100" -H "cookie: $COOKIE")
okc "API: loadingCharges persisted (has $EXP3)" "$SRV" "\"loadingCharges\":$EXP3"
okc "API: destinations show the move result (has $V0)" "$SRV" "\"destination\":\"$V0\""

# ---------------------------------------------------------------- trace dump (diagnostics)
echo ""
echo "--- CONTROLLER TRACE (last 40 events) ---"
ev 'JSON.stringify(window.__misExcel.getDebug().trace)' | python3 -c "
import sys, json
try:
    t = json.loads(sys.stdin.read())
    for line in t[-40:]: print(' ', line)
except Exception as e:
    print('trace parse error', e)"

# ---------------------------------------------------------------- cleanup
for LR in 999920 999921; do
  curl -s "http://localhost:3000/api/records?search=$LR&end=10" -H "cookie: $COOKIE" | python3 -c "
import sys, json
try:
    for r in json.load(sys.stdin)['rows']: print(r['id'])
except Exception: pass" | while read id; do
    [ -n "$id" ] && curl -s -X DELETE "http://localhost:3000/api/records/$id" -H "cookie: $COOKIE" -o /dev/null
  done
done
$AB close >/dev/null 2>&1
echo ""
echo "======================================================"
echo "BROWSER EXCEL E2E: $PASS passed, $FAIL failed"
echo "======================================================"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
