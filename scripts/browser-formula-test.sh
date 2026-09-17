#!/bin/bash
# Browser E2E — Excel formulas in the MIS grid (the user-reported bug)
# Runs INSIDE one bash invocation (with-server.sh keeps the dev server up).
# NOTE: agent-browser eval returns JSON — unwrap with python; return STRINGS only.
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

# ---------------------------------------------------------------- 0. seed
source "$(dirname "$0")/lib/na-login.sh"
na_login "http://localhost:3000" "admin@npl.com" "Admin@123" || { echo "LOGIN FAILED"; exit 1; }
COOKIE="$NA_COOKIE"
curl -s -X POST http://localhost:3000/api/records -H "cookie: $COOKIE" -H 'content-type: application/json' \
  -d '{"values":{"partyName":"Formula UI Test Co","destination":"Testville","lrNo":999901,"lrDate":"2026-09-01","bucket":100,"deliveryStatus":"Pending"}}' \
  > /tmp/ui-create.json
REC_ID=$(python3 -c "import json;print(json.load(open('/tmp/ui-create.json'))['record']['id'])" 2>/dev/null)
echo "seed record: ${REC_ID:-FAILED}"
[ -z "$REC_ID" ] && { echo "FATAL: could not create test record"; exit 1; }

# ---------------------------------------------------------------- 1. open + login
$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
LOGGED=$(ev 'document.body.textContent.includes("MIS") ? "yes" : "no"')
ok "login (shell visible)" "$LOGGED" "yes"

# instrument fetch — log every mutating /api/records call (req + resp)
ev '
(() => {
  const orig = window.fetch;
  window.__patchLog = [];
  window.fetch = async (...args) => {
    const res = await orig(...args);
    try {
      const url = String(args[0]);
      const method = (args[1] && args[1].method) || "GET";
      if (url.includes("/api/records") && method !== "GET") {
        window.__patchLog.push({ method, status: res.status, req: args[1] && args[1].body ? String(args[1].body) : null });
      }
    } catch (e) {}
    return res;
  };
  return "instrumented";
})()' >/dev/null

# go to MIS view
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS" || x.textContent.trim()==="Centralized MIS"); if(!b) return "not-found"; b.click(); return "ok" })()' >/dev/null

# wait for the grid to render rows
for i in $(seq 1 25); do
  ROWS=$(ev 'document.querySelectorAll(".ag-row").length')
  [ "${ROWS:-0}" -gt 0 ] 2>/dev/null && break
  sleep 1
done
echo "grid rows after load: ${ROWS:-0}"

# search for the test LR (isolates a single row)
ev '(() => { const el=document.querySelector("input[placeholder*=\"Search LR\"]"); if(!el) return "no-input"; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(el,"999901"); el.dispatchEvent(new Event("input",{bubbles:true})); return "ok" })()' >/dev/null

FOUND=""
for i in $(seq 1 20); do
  FOUND=$(ev '(() => { const c=document.querySelector(".ag-cell[col-id=\"lrNo\"]"); return c ? c.textContent.trim() : "" })()')
  [ "$FOUND" = "999901" ] && break
  sleep 1
done
ok "search isolates LR 999901" "$FOUND" "999901"
sleep 1

# helpers on window (document-level queries — the search isolated ONE row)
ev '
window.__ensure = (colId) => {
  try { window.__misApi.ensureColumnVisible(colId); } catch (e) {}
  try { window.__misApi.ensureIndexVisible(0, "top"); } catch (e) {}
  return "ok";
};
window.__startEdit = (colId) => {
  window.__ensure(colId);
  const cell = document.querySelector(".ag-cell[col-id=\"" + colId + "\"]");
  if (!cell) return "no-cell";
  cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  try {
    window.__misApi.startEditingCell({ rowIndex: 0, colKey: colId });
  } catch (e) { return "err:" + e.message; }
  return "started";
};
window.__markEditor = () => {
  // clear old marks, then tag the LIVE editor input — AG Grid focuses it on open
  document.querySelectorAll("[data-testid=mis-cell-editor]").forEach((el) => el.removeAttribute("data-testid"));
  const cells = window.__misApi.getEditingCells() || [];
  if (!cells || cells.length === 0) return "no-editing";
  const el = document.activeElement;
  if (el && el.tagName === "INPUT" && el.isConnected) {
    el.setAttribute("data-testid", "mis-cell-editor");
    return "focused:" + (el.value || "").slice(0, 24);
  }
  // fallback: instance gui for the editing cell
  const insts = window.__misApi.getCellEditorInstances() || [];
  let marked = 0;
  for (const i of insts) {
    const g = i.getGui ? i.getGui() : null;
    const input = g && g.querySelector ? g.querySelector("input") : null;
    if (input && input.isConnected) { input.setAttribute("data-testid", "mis-cell-editor"); marked++; }
  }
  return "fallback-marked:" + marked;
};
window.__editorValue = () => {
  const el = document.querySelector("[data-testid=mis-cell-editor]");
  return el ? el.value : "no-editor";
};
window.__cellText = (colId) => {
  window.__ensure(colId);
  const cell = document.querySelector(".ag-cell[col-id=\"" + colId + "\"]");
  return cell ? cell.textContent.trim() : "none";
};
window.__clickCell = (colId) => {
  window.__ensure(colId);
  const cell = document.querySelector(".ag-cell[col-id=\"" + colId + "\"]");
  if (!cell) return "no-cell";
  cell.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
  return "ok";
};
window.__formulaBar = () => {
  const inp = document.querySelector("input[aria-label=\"Formula\"], input[aria-label=\"Cell value\"]");
  return inp ? inp.value : "no-bar";
};
window.__cellClass = (colId) => {
  window.__ensure(colId);
  const cell = document.querySelector(".ag-cell[col-id=\"" + colId + "\"]");
  return cell ? cell.className : "none";
};
"helpers-ready"' >/dev/null

# cell text with retry (column virtualization needs a frame after ensure)
ct() { local t=""; for i in 1 2 3 4; do t=$(ev "window.__cellText(\"$1\")"); [ "$t" != "none" ] && break; sleep 0.4; done; echo "$t"; }
# realistic edit: ensure column → frame → open editor → mark FOCUSED input → Playwright fill → real Enter
edit() {
  ev "window.__ensure(\"$1\")" >/dev/null
  sleep 0.5
  ST=$(ev "window.__startEdit(\"$1\")")
  sleep 0.5
  MK=$(ev 'window.__markEditor()')
  echo "    [edit:$1] start=$ST mark=$MK"
  $AB find first '[data-testid="mis-cell-editor"]' fill "$2" >/dev/null 2>&1
  echo "    [edit:$1] after-fill value=$(ev 'window.__editorValue()') (want $2)"
  $AB press Enter >/dev/null 2>&1
  sleep 0.3
}

BUCKET=$(ct "bucket")
ok "Bucket cell shows 100" "$BUCKET" "100"
LC0=$(ct "loadingCharges")
echo "  (Loading Charges before: $LC0)"

# ---------------------------------------------------------------- T1 — =Bucket*3 → 300
echo ""
echo "[T1] type =Bucket*3 into the Loading Charges cell"
edit "loadingCharges" "=Bucket*3"
sleep 2.2
LC=$(ct "loadingCharges")
ok "T1: Loading Charges displays 300" "$LC" "300"
STYLE=$(ev 'window.__cellClass("loadingCharges").includes("mis-formula-cell") ? "styled" : "unstyled"')
ok "formula cell styling applied" "$STYLE" "styled"

# formula bar shows the formula when the cell is selected
ev 'window.__clickCell("loadingCharges")' >/dev/null
sleep 0.6
FB=$(ev 'window.__formulaBar()')
ok "formula bar shows =Bucket*3" "$FB" "=Bucket*3"
$AB screenshot download/formula-ui-t1.png >/dev/null 2>&1

# ---------------------------------------------------------------- T2 — Bucket 100→200 → 600
echo ""
echo "[T2] change Bucket 100→200 — cascading recalculation"
edit "bucket" "200"
sleep 2.2
B=$(ct "bucket")
ok "Bucket displays 200" "$B" "200"
LC2=$(ct "loadingCharges")
ok "T2: Loading Charges auto-recalculated to 600" "$LC2" "600"
$AB screenshot download/formula-ui-t2.png >/dev/null 2>&1

# ---------------------------------------------------------------- T3 — #REF! error cell
echo ""
echo "[T3] invalid formula =Bucket*ABC → #REF!"
edit "loadingCharges" "=Bucket*ABC"
sleep 2.2
LC3=$(ct "loadingCharges")
okc "T3: cell shows #REF! error" "$LC3" "#REF!"
ERRSTYLE=$(ev 'window.__cellClass("loadingCharges").includes("mis-cell-error") ? "err-styled" : "unstyled"')
ok "error cell styling applied" "$ERRSTYLE" "err-styled"
ev 'window.__clickCell("loadingCharges")' >/dev/null
sleep 0.6
BARERR=$(ev '(() => { const el=[...document.querySelectorAll("span")].find(s=>s.textContent.includes("#REF!")); return el ? el.textContent.slice(0,90) : "no-error-chip" })()')
okc "formula bar shows the #REF! explanation" "$BARERR" "Unknown column"
$AB screenshot download/formula-ui-t3.png >/dev/null 2>&1

# ---------------------------------------------------------------- T4 — plain value clears the formula
echo ""
echo "[T4] typing a plain value clears the formula"
edit "loadingCharges" "42"
sleep 2.2
LC4=$(ct "loadingCharges")
ok "plain value 42 stored" "$LC4" "42"
PLAIN=$(ev 'window.__cellClass("loadingCharges").includes("mis-formula-cell") ? "still-formula" : "cleared"')
ok "formula indicator removed" "$PLAIN" "cleared"

# ---------------------------------------------------------------- T5 — formula bar editing
echo ""
echo "[T5] edit via the formula bar itself"
ev 'window.__clickCell("loadingCharges")' >/dev/null
sleep 0.6
BARVAL=$(ev 'window.__formulaBar()')
ok "formula bar reflects the cell value" "$BARVAL" "42"
ev '(() => { const inp=document.querySelector("input[aria-label=\"Cell value\"]"); if(!inp) return "no-bar"; const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set; set.call(inp,"=Bucket*2"); inp.dispatchEvent(new Event("input",{bubbles:true})); return "set" })()' >/dev/null
sleep 0.3
$AB find first 'input[aria-label="Cell value"]' press Enter >/dev/null 2>&1 || ev '(() => { const inp=document.querySelector("input[aria-label=\"Cell value\"]"); inp.dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",code:"Enter",keyCode:13,which:13,bubbles:true,cancelable:true})); return "entered" })()' >/dev/null
sleep 2.2
LC5=$(ct "loadingCharges")
ok "T5: formula bar commit → cell = 400" "$LC5" "400"
$AB screenshot download/formula-ui-t5.png >/dev/null 2>&1

# ---------------------------------------------------------------- cleanup
# dump the intercepted PATCH log for diagnostics
echo ""
echo "--- PATCH LOG ---"
ev '(() => { const l = window.__patchLog || []; return l.map(x => x.method + " " + x.status + " req=" + String(x.req).slice(0,120)).join("\n") })()'
curl -s -X DELETE "http://localhost:3000/api/records/$REC_ID" -H "cookie: $COOKIE" -o /dev/null
$AB close >/dev/null 2>&1
echo ""
echo "======================================================"
echo "BROWSER E2E: $PASS passed, $FAIL failed"
echo "======================================================"
[ "$FAIL" -gt 0 ] && exit 1
exit 0
