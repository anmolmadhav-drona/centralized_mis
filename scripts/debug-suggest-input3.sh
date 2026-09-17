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
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in" >/dev/null 2>&1
sleep 5
ev '(() => { const b=[...document.querySelectorAll("button,a")].find(x=>x.textContent.trim()==="MIS"); if(b)b.click(); return "ok" })()' >/dev/null
sleep 3
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Add MIS Entry"); if(b)b.click(); return "ok" })()' >/dev/null
sleep 2

echo "== fill lrNo (plain Input, no popover):"
$AB find first "#f-lrNo" fill "12345" 2>&1 | head -1
sleep 1
echo "   value: $(ev 'document.getElementById("f-lrNo")?.value')"

echo "== fill invoiceNumber (SuggestInput with popover):"
$AB find first "#f-invoiceNumber" fill "INV-9" 2>&1 | head -1
sleep 1
echo "   value: $(ev 'document.getElementById("f-invoiceNumber")?.value')"

echo "== typing simulation on partyName (keyboard press):"
$AB find first "#f-partyName" click >/dev/null 2>&1
sleep 1
$AB press "G" 2>&1 | head -1 || true
$AB type "Ghumman" 2>&1 | head -1 || true
sleep 2
echo "   value: $(ev 'document.getElementById("f-partyName")?.value')"
echo "   fetchlog: $(ev '(() => { if(!window.__suggestLog){window.__suggestLog=[];const o=window.fetch;window.fetch=async(...a)=>{const u=String(a[0]);if(u.includes("/api/records/suggest"))window.__suggestLog.push(u.split("?")[1]);return o(...a)}}; return JSON.stringify(window.__suggestLog) })()')"
