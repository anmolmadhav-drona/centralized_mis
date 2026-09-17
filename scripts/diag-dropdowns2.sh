#!/bin/bash
# Diagnose dropdown rendering — MIS view, all dropdown surfaces
set -u
cd /home/z/my-project
AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

$AB set viewport 1600 900 >/dev/null 2>&1
$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1

# login if needed
ev '(() => { return document.querySelector("input[type=password]") ? "login" : "app" })()' | grep -q login && {
  $AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
  $AB find label "Password" fill "Admin@123" >/dev/null 2>&1
  $AB find role button click --name "Sign in" >/dev/null 2>&1
  sleep 5
}

# go to MIS view (nav item with MIS text)
ev '(() => { const b=[...document.querySelectorAll("button,a,[role=button]")].find(x=>/^MIS$/.test(x.textContent.trim())); if(!b) return "nav-not-found"; b.click(); return "ok" })()'
sleep 5

echo "=== A. Filter-panel Select (Delivery Status filter) ==="
ev '(() => {
  const t=[...document.querySelectorAll("[role=combobox]")];
  return JSON.stringify(t.map(x=>({txt:x.textContent.trim().slice(0,30), vis:!!x.offsetParent})));
})()'

echo "--- click first combobox trigger ---"
ev '(() => { const t=[...document.querySelectorAll("[role=combobox]")].find(x=>x.offsetParent); if(!t) return "none-visible"; t.click(); return "clicked:"+t.textContent.trim().slice(0,20); })()'
sleep 1
ev '(() => {
  const c=document.querySelector("[data-radix-popper-content-wrapper]");
  if(!c) return "NO POPUP RENDERED";
  const items=[...c.querySelectorAll("[role=option]")].map(o=>o.textContent.trim()).slice(0,12);
  return "popup OK — options: "+JSON.stringify(items);
})()'
$AB screenshot /home/z/my-project/download/diag-filter-select.png >/dev/null 2>&1
ev '(() => { document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return "esc" })()'
sleep 1

echo "=== B. Grid dropdown cell editor (Delivery Status column) ==="
ev '(() => {
  // find column index of deliveryStatus via header cells
  const hs=[...document.querySelectorAll(".ag-header-cell")];
  const idx=hs.findIndex(h=>h.textContent.includes("Delivery Status"));
  return "header idx="+idx+" of "+hs.length;
})()'
# double-click the first row cell in Delivery Status column using AG api-free approach: find cell by col-id
ev '(() => {
  const cell=document.querySelector(".ag-row[row-index=\\"0\\"] .ag-cell[col-id=deliveryStatus]");
  if(!cell) return "cell NOT FOUND";
  cell.dispatchEvent(new MouseEvent("dblclick",{bubbles:true}));
  return "dblclicked";
})()'
sleep 1
ev '(() => {
  const ed=document.querySelector(".ag-cell-editor");
  if(!ed) return "NO EDITOR OPEN";
  const sel=ed.querySelector("select");
  if(!sel) return "editor open but NO <select>: html="+ed.innerHTML.slice(0,120);
  return "select editor OK — options: "+JSON.stringify([...sel.options].map(o=>o.textContent).slice(0,10));
})()'
$AB screenshot /home/z/my-project/download/diag-grid-editor.png >/dev/null 2>&1
ev '(() => { document.body.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})); return "esc" })()'
sleep 1

echo "=== C. Columns visibility dropdown (icon button) ==="
ev '(() => {
  const b=[...document.querySelectorAll("button")].find(x=>x.querySelector(".lucide-columns-3, .lucide-columns"));
  if(!b) return "btn not found";
  b.click(); return "clicked";
})()'
sleep 1
ev '(() => {
  const c=document.querySelector("[data-radix-popper-content-wrapper]");
  if(!c) return "NO POPUP RENDERED";
  const items=[...c.querySelectorAll("[role=menuitemcheckbox]")].map(o=>o.textContent.trim());
  return "popup OK — "+items.length+" items, first: "+items.slice(0,5).join(" | ");
})()'
$AB screenshot /home/z/my-project/download/diag-columns-menu.png >/dev/null 2>&1
ev '(() => { document.body.click(); return "closed" })()'
sleep 1

echo "=== D. Add MIS Entry form dropdowns ==="
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>/add mis entry/i.test(x.textContent)); if(!b) return "btn NOT FOUND"; b.click(); return "clicked" })()'
sleep 3
ev '(() => {
  const dlg=document.querySelector("[role=dialog]");
  if(!dlg) return "NO DIALOG";
  const combos=[...dlg.querySelectorAll("[role=combobox]")];
  const natives=[...dlg.querySelectorAll("select")];
  return JSON.stringify({comboboxes:combos.length, nativeSelects:natives.length, dialogVisible:!!dlg.offsetParent});
})()'
# click the first combobox inside the dialog
ev '(() => {
  const dlg=document.querySelector("[role=dialog]");
  if(!dlg) return "no dialog";
  const t=[...dlg.querySelectorAll("[role=combobox]")][0];
  if(!t) return "no combobox in dialog";
  t.click(); return "clicked combobox: "+t.textContent.trim().slice(0,25);
})()'
sleep 1
ev '(() => {
  const c=document.querySelector("[data-radix-popper-content-wrapper]");
  if(!c) return "NO POPUP RENDERED";
  const items=[...c.querySelectorAll("[role=option]")].map(o=>o.textContent.trim()).slice(0,15);
  return "popup OK — "+items.length+" options: "+JSON.stringify(items);
})()'
$AB screenshot /home/z/my-project/download/diag-form-dropdown.png >/dev/null 2>&1
echo "=== console errors ==="
$AB errors 2>/dev/null | head -20
