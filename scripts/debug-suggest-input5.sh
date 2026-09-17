#!/bin/bash
set -u
cd /home/z/my-project
AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
echo "page loaded: $(ev 'document.title')"
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
echo "logged in: $(ev 'document.body.textContent.includes("Add MIS Entry") ? "yes" : "no"')"
ev '(() => { window.__errs=[]; window.onerror=(m)=>{window.__errs.push(String(m));return false}; return "armed" })()' >/dev/null
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS"); if(b)b.click(); return "ok" })()' >/dev/null
sleep 3
echo "MIS view: $(ev 'document.querySelectorAll(".ag-row").length') rows"
echo "add btn: $(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Add MIS Entry"); return b?"found":"missing" })()')"
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Add MIS Entry"); if(b)b.click(); return "ok" })()' >/dev/null
sleep 2
echo "dialog: $(ev 'document.querySelector("[role=dialog]") ? "open" : "closed"')"
echo "errors: $(ev 'JSON.stringify(window.__errs)')"
echo "party input: $(ev '(() => { const i=document.getElementById("f-partyName"); return i ? i.outerHTML.slice(0,120) : "ABSENT" })()')"
