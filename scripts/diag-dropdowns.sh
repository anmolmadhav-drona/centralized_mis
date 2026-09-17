#!/bin/bash
# Diagnose "dropdowns are not rendering properly" — inspect all dropdown surfaces
set -u
cd /home/z/my-project
AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5

# go to MIS view
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS"); if(!b) return "not-found"; b.click(); return "ok" })()'
sleep 4

echo "=== A. topbar Columns dropdown ==="
ev '(() => { const t=[...document.querySelectorAll("button")].find(x=>x.textContent.toLowerCase().includes("columns")); if(!t) return "trigger NOT FOUND"; t.click(); return "clicked"; })()'
sleep 2
ev '(() => { const c=document.querySelector("[data-radix-popper-content-wrapper]"); if(!c) return "NO POPUP"; return "popup-open len="+c.textContent.length+" first="+c.textContent.slice(0,80); })()'
ev '(() => { document.body.click(); return "closed"; })()'
sleep 1

echo "=== B. grid dropdown cell editor (deliveryStatus) ==="
# find the deliveryStatus column index by header
ev '(() => { const h=[...document.querySelectorAll(".ag-header-cell-text")].map(x=>x.textContent.trim()); return JSON.stringify(h.slice(0,40)); })()'
# double-click first data cell in Delivery Status column
ev '(() => {
  const cells=[...document.querySelectorAll(".ag-row")].slice(0,3);
  return "rows="+cells.length;
})()'
ev '(() => { const api=window.__AG_API__; return api? "api-exposed":"no-api" })()'

echo "=== C. Add Record form dropdowns ==="
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>/add record/i.test(x.textContent)); if(!b) return "btn NOT FOUND"; b.click(); return "clicked"; })()'
sleep 3
ev '(() => {
  const dlg=document.querySelector("[role=dialog]");
  if(!dlg) return "NO DIALOG";
  // count triggers & native selects
  const sel=[...dlg.querySelectorAll("select")];
  const trigs=[...dlg.querySelectorAll("button[role=combobox], [role=combobox]")];
  const labels=[...dlg.querySelectorAll("label")].map(l=>l.textContent.trim());
  return JSON.stringify({nativeSelects:sel.length, comboboxes:trigs.length, nlabels:labels.length});
})()'
# screenshot the dialog
$AB screenshot /home/z/my-project/download/diag-form-dialog.png >/dev/null 2>&1
echo "screenshot saved"
