#!/bin/bash
# brand-logo-check.sh — verifies the company's ORIGINAL transparent logo, built
# directly into the charcoal sidebar (no plate / no card):
#   1. the loading screen (SSR markup carries both theme variants)
#   2. sidebar brand block, top-left of the dashboard (expanded)
#   3. collapsed sidebar (original emblem, transparent on the rail)
#   4. mobile drawer header
set -u
cd /home/z/my-project
PASS=0; FAIL=0
ok()  { if [ "$2" = "$3" ]; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — expected [$3] got [$2]"; fi }
okc() { if echo "$2" | grep -q "$3"; then PASS=$((PASS+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — [$2] lacks [$3]"; fi }
AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

echo "== loading screen (SSR) =="
LOADING_LOGO=$(curl -s --max-time 10 http://localhost:81/ | grep -c "logo-main" || true)
ok "loading (SSR): original logo present" "$([ "$LOADING_LOGO" -gt 0 ] && echo yes || echo no)" "yes"
LOADING_DARK=$(curl -s --max-time 10 http://localhost:81/ | grep -c "logo-main-dark" || true)
ok "loading (SSR): dark-surface variant present" "$([ "$LOADING_DARK" -gt 0 ] && echo yes || echo no)" "yes"
LOADING_PLATE=$(curl -s --max-time 10 http://localhost:81/ | grep -c "FAFAF8" || true)
ok "loading (SSR): no white plate anywhere" "$([ "$LOADING_PLATE" -eq 0 ] && echo yes || echo no)" "yes"

echo "== login =="
$AB cookies clear >/dev/null 2>&1
$AB set viewport 1440 900 >/dev/null 2>&1
$AB open http://localhost:81/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
sleep 2
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in to Centralized MIS" >/dev/null 2>&1
sleep 6

echo "== sidebar brand (expanded, top-left of dashboard) =="
ok "sidebar present" "$(ev 'document.querySelector("aside") ? "yes":"no"')" "yes"
ok "ORIGINAL dark-surface artwork in sidebar (logo-main-dark)" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); return i && i.complete && i.naturalWidth>100 ? "yes" : "no" })()')" "yes"
ok "logo sits DIRECTLY on charcoal — no plate/card" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); if(!i) return "no-img"; const brand=i.closest("div").parentElement; const plates=[...brand.querySelectorAll("div")].filter(d=>getComputedStyle(d).backgroundColor==="rgb(250, 250, 248)"); return plates.length===0 ? "yes":"plate:"+plates.length })()')" "yes"
ok "logo host is transparent (artwork floats)" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); if(!i) return "no-img"; const host=i.closest("div"); return getComputedStyle(host).backgroundColor==="rgba(0, 0, 0, 0)" ? "yes":"bg="+getComputedStyle(host).backgroundColor })()')" "yes"
ok "subtle warm-gold glow behind logo" "$(ev '(() => { const g=[...document.querySelectorAll("aside div")].find(d=>(d.getAttribute("style")||"").includes("232, 154, 22")); return g ? "yes" : "no" })()')" "yes"
ok "sidebar caption: Centralized MIS" "$(ev '(() => { const t=[...document.querySelectorAll("aside p")].map(p=>p.textContent.trim()); return t.includes("Centralized MIS") ? "yes":"no" })()')" "yes"
ok "logo width slightly reduced to 136px" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); return i ? Math.round(i.getBoundingClientRect().width) : 0 })()')" "136"
ok "no leftover vector lockup in sidebar" "$(ev '(() => { const svgs=[...document.querySelectorAll("aside svg[role=img]")]; return svgs.length===0 ? "clean":"present:"+svgs.length })()')" "clean"
$AB screenshot download/brand-sidebar-transparent.png >/dev/null 2>&1

echo "== collapsed sidebar (original emblem) =="
$AB find role button click --name "Collapse sidebar" >/dev/null 2>&1
sleep 2
ok "collapsed: ORIGINAL dark-surface emblem (logo-emblem-dark)" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-emblem-dark")); return i && i.complete && i.naturalWidth>100 ? "yes" : "no" })()')" "yes"
ok "collapsed: no plate around emblem" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-emblem-dark")); if(!i) return "no-img"; const host=i.closest("div"); return getComputedStyle(host).backgroundColor==="rgba(0, 0, 0, 0)" ? "yes":"bg="+getComputedStyle(host).backgroundColor })()')" "yes"
ok "collapsed: glow behind emblem" "$(ev '(() => { const g=[...document.querySelectorAll("aside div")].find(d=>(d.getAttribute("style")||"").includes("232, 154, 22")); return g ? "yes" : "no" })()')" "yes"
ok "collapsed: emblem sized ~34px" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-emblem-dark")); return i ? Math.round(i.getBoundingClientRect().width) : 0 })()')" "34"
$AB screenshot download/brand-collapsed-transparent.png >/dev/null 2>&1
$AB find role button click --name "Expand sidebar" >/dev/null 2>&1
sleep 2

echo "== dark mode brand =="
$AB find role button click --name "Toggle theme" >/dev/null 2>&1
sleep 2
ok "dark: transparent logo still visible in sidebar" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); const r=i.getBoundingClientRect(); return i && r.width>100 ? "yes":"no" })()')" "yes"
ok "dark: no plate — logo on charcoal directly" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); const brand=i.closest("div").parentElement; const plates=[...brand.querySelectorAll("div")].filter(d=>getComputedStyle(d).backgroundColor==="rgb(250, 250, 248)"); return plates.length===0 ? "yes":"no" })()')" "yes"
$AB screenshot download/brand-sidebar-dark-transparent.png >/dev/null 2>&1
$AB find role button click --name "Toggle theme" >/dev/null 2>&1
sleep 2

echo "== mobile drawer brand =="
$AB set viewport 390 844 >/dev/null 2>&1
sleep 2
$AB find role button click --name "Open navigation" >/dev/null 2>&1
sleep 2
ok "drawer: transparent dark-surface logo" "$(ev '(() => { const i=[...document.querySelectorAll("[role=dialog] img, [data-state=open] img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); return i ? "yes" : "no" })()')" "yes"
ok "drawer: Centralized MIS caption" "$(ev '(() => { const t=[...document.querySelectorAll("[role=dialog] p, [data-state=open] p")].map(p=>p.textContent.trim()); return t.includes("Centralized MIS") ? "yes":"no" })()')" "yes"
$AB screenshot download/brand-drawer-transparent.png >/dev/null 2>&1
$AB press Escape >/dev/null 2>&1
$AB set viewport 1440 900 >/dev/null 2>&1

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ] && echo "TRANSPARENT ORIGINAL LOGO BUILT INTO SIDEBAR ✓" || echo "ISSUES ✗"
exit $FAIL
