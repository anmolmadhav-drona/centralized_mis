#!/bin/bash
# verify-portal-up.sh — read-only smoke check that the portal is genuinely
# serving the DRONA LOGITECH CENTRALIZED MIS experience after a watchdog
# restart: login page with the company logo artwork, API health.
# NO form submissions, NO DB writes.
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected [$3] got [$2]"; fi }
okc() { if echo "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — [$2] lacks [$3]"; fi }
ev() { agent-browser eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

echo "== infrastructure =="
ok "server on :3000 (auth/me)"   "$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 http://localhost:3000/api/auth/me)" "200"
ok "gateway :81 root"            "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:81/)" "200"
ok "login logo asset via gateway (png)" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 15 http://localhost:81/brand/logo-main.png)" "200 image/png"
ok "login logo asset via gateway" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:81/brand/logo-main.webp)" "200"
ok "favicon via gateway"         "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:81/favicon.svg)" "200"
ok "signup route retired (404)"  "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:81/signup)" "404"

echo "== login page + logo artwork (browser) =="
agent-browser cookies clear >/dev/null 2>&1
agent-browser set viewport 1440 900 >/dev/null 2>&1
agent-browser open http://localhost:81/ >/dev/null 2>&1
agent-browser wait --load networkidle >/dev/null 2>&1
sleep 2
ok "login: Sign in heading"       "$(ev 'document.body.textContent.includes("Sign in") ? "yes":"no"')" "yes"
ok "login: DRONA LOGITECH branding" "$(ev '(() => document.body.textContent.includes("DRONA") && document.body.textContent.includes("LOGITECH") ? "yes":"no")()')" "yes"
LINFO=$(ev '(() => { const i=[...document.querySelectorAll("img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main")); if(!i) return "no-img"; return JSON.stringify({src:(i.currentSrc||i.src), w:i.naturalWidth, h:i.naturalHeight, rw:Math.round(i.getBoundingClientRect().width)}) })()')
okc "logo artwork wired into login stage" "$LINFO" 'logo-main'
ok  "logo natural size 1280x548" "$(echo "$LINFO" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(str(d.get('w'))+'x'+str(d.get('h')))" 2>/dev/null || echo bad)" "1280x548"
ok  "logo visibly rendered (>=400px wide)" "$(echo "$LINFO" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('yes' if (d.get('rw') or 0)>=400 else 'no:'+str(d.get('rw')))" 2>/dev/null || echo bad)" "yes"
ok  "old brand film retired (no <video>)" "$(ev '(() => document.querySelector("video") ? "still-present" : "removed")()')" "removed"
ok "NO create-account option" "$(ev '(() => { const links=[...document.querySelectorAll("a")].filter(a=>(a.getAttribute("href")||"").includes("signup") || a.textContent.includes("Create an account")); const txt=document.body.textContent.includes("Create an account"); return links.length===0 && !txt ? "removed" : "still-present" })()')" "removed"
agent-browser screenshot download/verify-portal-login.png >/dev/null 2>&1

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] && echo "PORTAL HEALTHY ✓" || echo "PORTAL HAS ISSUES ✗"
exit $FAIL
