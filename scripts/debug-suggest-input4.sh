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
ev '(() => { window.__suggestLog=[]; const o=window.fetch; window.fetch=async(...a)=>{const u=String(a[0]);if(u.includes("/api/records/suggest"))window.__suggestLog.push(u.split("?")[1]);return o(...a)}; return "instrumented" })()' >/dev/null

echo "== input type check: $(ev 'document.getElementById("f-partyName")?.type')"

echo "== fill partyName:"
$AB find first "#f-partyName" fill "Ghumman" 2>&1 | head -1
sleep 2
echo "   value: $(ev 'document.getElementById("f-partyName")?.value')"
echo "   log: $(ev 'JSON.stringify(window.__suggestLog)')"
echo "   popover: $(ev '[...document.querySelectorAll("[data-radix-popper-content-wrapper] button")].map(b=>b.textContent.trim()).slice(0,3).join(" | ")')"

echo "== real keypress typing on destination:"
$AB find first "#f-destination" click >/dev/null 2>&1
$AB press "d" 2>&1 | head -1
$AB press "e" 2>&1 | head -1
$AB press "l" 2>&1 | head -1
sleep 2
echo "   value: $(ev 'document.getElementById("f-destination")?.value')"
echo "   log: $(ev 'JSON.stringify(window.__suggestLog)')"
