#!/bin/bash
# browser-redesign-test.sh — verifies the DRONA LOGITECH CENTRALIZED MIS redesign
# in the real UI (production standalone build, through gateway :81):
#   A. login page branding (company logo stage, wordmark, tagline, warm palette)
#   B. login works (admin) → app shell
#   C. shell: grouped nav, brand, topbar eyebrow/title, global search, bell
#   D. dashboard: KPIs w/ animated counters, charts, section header
#   E. MIS workspace: context strip, grid, export/add buttons, formula bar
#   F. global search (header) → MIS search box + filtered total
#   G. filterwise export regression (Task 8): filter → POST body → xlsx
#   H. reports / audit / settings / import-export views render
#   I. dark mode + mobile drawer
# NOTE: Radix menus open on pointerdown — use find role button click (real).
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
setinput() {  # $1 = selector, $2 = value
  ev "(() => { const i=document.querySelector('$1'); if(!i) return 'not-found'; i.focus(); const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set; set.call(i,'$2'); i.dispatchEvent(new Event('input',{bubbles:true})); return 'ok' })()" >/dev/null
}

echo "== A. login page branding =="
# start from a logged-out session at desktop size so the real login page renders
$AB cookies clear >/dev/null 2>&1
$AB set viewport 1440 900 >/dev/null 2>&1
$AB open http://localhost:81 >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
sleep 2
ok "DRONA + LOGITECH wordmark" "$(ev '(() => { const t=document.body.textContent; return t.includes("DRONA") && t.includes("LOGITECH") ? "yes" : "no" })()')" "yes"
ok "Centralized MIS product name" "$(ev 'document.body.textContent.includes("Centralized MIS") ? "yes":"no"')" "yes"
ok "login stage shows the original logo artwork" "$(ev '(() => { const i=[...document.querySelectorAll("img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main")); return i && i.complete && i.naturalWidth>300 ? "yes":"no" })()')" "yes"
LINFO=$(ev '(() => { const i=[...document.querySelectorAll("img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main")); if(!i) return "no-img"; return JSON.stringify({src:(i.currentSrc||i.src), w:i.naturalWidth, h:i.naturalHeight, rw:Math.round(i.getBoundingClientRect().width)}) })()')
okc "logo artwork wired into login stage" "$LINFO" 'logo-main'
ok "logo natural size 1280x548" "$(echo "$LINFO" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print(str(d.get('w'))+'x'+str(d.get('h')))" 2>/dev/null || echo bad)" "1280x548"
ok "login logo rendered wide (>=400px)" "$(echo "$LINFO" | python3 -c "import sys,json; d=json.loads(sys.stdin.read()); print('yes' if (d.get('rw') or 0)>=400 else 'no:'+str(d.get('rw')))" 2>/dev/null || echo bad)" "yes"
ok "old brand film fully retired (no <video>)" "$(ev '(() => { return document.querySelector("video") ? "still-present" : "removed" })()')" "removed"
ok "logo asset served (200 image/png)" "$(curl -s -o /dev/null -w '%{http_code} %{content_type}' --max-time 10 http://localhost:81/brand/logo-main.png)" "200 image/png"
ok "logo webp variant served (200)" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 http://localhost:81/brand/logo-main.webp)" "200"
ok "NO create-account option on login" "$(ev '(() => { const links=[...document.querySelectorAll("a")].filter(a=>(a.getAttribute("href")||"").includes("signup") || a.textContent.includes("Create an account")); const txt=document.body.textContent.includes("Create an account"); return links.length===0 && !txt ? "removed" : "still-present" })()')" "removed"
ok "favicon is Drona emblem svg" "$(ev '(() => { const l=[...document.querySelectorAll("link[rel=icon]")]; return l.some(x=>(x.href||"").includes("favicon.svg")) ? "yes" : "no" })()')" "yes"
ok "warm workspace background #FAFAF8" "$(ev 'getComputedStyle(document.body).backgroundColor')" "rgb(250, 250, 248)"
ok "sign-in button carries product name" "$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.includes("Sign in to Centralized MIS")); return b ? "yes" : "no" })()')" "yes"
LOADING_LOGO=$(curl -s --max-time 10 http://localhost:81/ | grep -c "logo-main" || true)
ok "loading screen (SSR) shows original logo" "$([ "$LOADING_LOGO" -gt 0 ] && echo yes || echo no)" "yes"
LOADING_DARK=$(curl -s --max-time 10 http://localhost:81/ | grep -c "logo-main-dark" || true)
ok "loading screen (SSR) carries dark-surface variant" "$([ "$LOADING_DARK" -gt 0 ] && echo yes || echo no)" "yes"
LOADING_PLATE=$(curl -s --max-time 10 http://localhost:81/ | grep -c "FAFAF8" || true)
ok "loading screen (SSR) has no white plate" "$([ "$LOADING_PLATE" -eq 0 ] && echo yes || echo no)" "yes"
$AB screenshot download/redesign-01-login.png >/dev/null 2>&1

echo "== B. login =="
$AB find label "Email" fill "admin@npl.com" >/dev/null 2>&1
$AB find label "Password" fill "Admin@123" >/dev/null 2>&1
$AB find role button click --name "Sign in to Centralized MIS" >/dev/null 2>&1
sleep 6
ok "login lands in app" "$(ev 'document.body.textContent.includes("Operations Dashboard") ? "yes" : "no"')" "yes"

echo "== C. app shell =="
ok "sidebar brand: ORIGINAL dark-surface artwork (logo-main-dark)" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); return i && i.complete && i.naturalWidth>100 ? "yes":"no" })()')" "yes"
ok "sidebar brand: NO plate — logo sits directly on charcoal" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); if(!i) return "no-img"; const brand=i.closest("div").parentElement; const plates=[...brand.querySelectorAll("div")].filter(d=>getComputedStyle(d).backgroundColor==="rgb(250, 250, 248)"); return plates.length===0 ? "yes":"plate:"+plates.length })()')" "yes"
ok "sidebar brand: subtle warm-gold glow behind logo" "$(ev '(() => { const g=[...document.querySelectorAll("aside div")].find(d=>(d.getAttribute("style")||"").includes("232, 154, 22")); return g ? "yes":"no" })()')" "yes"
ok "sidebar brand: artwork transparent on sidebar bg" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-main-dark")); if(!i) return "no-img"; const host=i.closest("div"); return getComputedStyle(host).backgroundColor==="rgba(0, 0, 0, 0)" ? "yes":"bg="+getComputedStyle(host).backgroundColor })()')" "yes"
ok "sidebar brand: Centralized MIS caption" "$(ev '(() => { const t=[...document.querySelectorAll("aside p")].map(p=>p.textContent.trim()); return t.includes("Centralized MIS") ? "yes":"no" })()')" "yes"
GROUPLABELS=$(ev '(() => { const want=["Overview","MIS","Analytics","Operations","Administration"]; const labels=[...document.querySelectorAll("nav p, aside p")].map(p=>p.textContent.trim()); return want.filter(w=>labels.includes(w)).join(",") })()')
ok "all 5 nav groups present" "$GROUPLABELS" "Overview,MIS,Analytics,Operations,Administration"
NAVITEMS=$(ev '(() => { const want=["Dashboard","Centralized MIS","Import / Export","Reports & Summaries","Audit Trail","Users & Settings"]; const btns=[...document.querySelectorAll("nav button")].map(b=>b.textContent.trim()); return want.filter(w=>btns.includes(w)).join(",") })()')
ok "all 6 nav items present (RBAC-filtered for admin)" "$NAVITEMS" "Dashboard,Centralized MIS,Import / Export,Reports & Summaries,Audit Trail,Users & Settings"
ok "topbar eyebrow shows section" "$(ev '(() => { const p=[...document.querySelectorAll("header p")].find(x=>x.textContent.trim()==="Overview"); return p?"yes":"no" })()')" "yes"
ok "global search input present" "$(ev '(() => { const i=document.querySelector("input[placeholder=\"Search the MIS…\"]"); return i?"yes":"no" })()')" "yes"
ok "notification bell present" "$(ev '(() => { const b=[...document.querySelectorAll("header button")].find(x=>x.getAttribute("aria-label")&&x.getAttribute("aria-label").startsWith("Notifications")); return b?"yes":"no" })()')" "yes"
ok "charcoal sidebar #252525" "$(ev '(() => { const a=document.querySelector("aside"); return a?getComputedStyle(a).backgroundColor:"no-aside" })()')" "rgb(37, 37, 37)"
# collapsed sidebar — the original emblem, transparent on the rail
$AB find role button click --name "Collapse sidebar" >/dev/null 2>&1
sleep 1.5
ok "collapsed: ORIGINAL dark-surface emblem (logo-emblem-dark)" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-emblem-dark")); return i && i.complete && i.naturalWidth>100 ? "yes":"no" })()')" "yes"
ok "collapsed: no plate around emblem" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-emblem-dark")); if(!i) return "no-img"; const host=i.closest("div"); return getComputedStyle(host).backgroundColor==="rgba(0, 0, 0, 0)" ? "yes":"bg="+getComputedStyle(host).backgroundColor })()')" "yes"
ok "collapsed: emblem renders at 34px" "$(ev '(() => { const i=[...document.querySelectorAll("aside img")].find(x=>(x.currentSrc||x.src||"").includes("logo-emblem-dark")); return i ? Math.round(i.getBoundingClientRect().width) : 0 })()')" "34"
$AB find role button click --name "Expand sidebar" >/dev/null 2>&1
sleep 1.5
ok "user chip shows name" "$(ev 'document.body.textContent.includes("System Administrator") ? "yes":"no"')" "yes"
ok "active nav uses Drona red indicator" "$(ev '(() => { const b=[...document.querySelectorAll("nav button")].find(x=>x.getAttribute("aria-current")==="page"); if(!b) return "no-active"; const bar=b.querySelector("span.rounded-r, span"); const s=[...b.querySelectorAll("span")].find(s=>s.className.toString().includes("bg-brand-red")); return s?"yes":"no-bar" })()')" "yes"
$AB screenshot download/redesign-02-shell.png >/dev/null 2>&1

echo "== D. dashboard =="
ok "control-center headline" "$(ev 'document.body.textContent.includes("What is happening across Drona Logitech right now") ? "yes":"no"')" "yes"
ok "live eyebrow" "$(ev 'document.body.textContent.includes("Centralized View") ? "yes":"no"')" "yes"
KPILABELS=$(ev '(() => { const want=["Total Records","Total Quantity","Delivered","Pending + In Transit","FTL / PTL","POD Received"]; const t=[...document.querySelectorAll("p")].map(p=>p.textContent.trim()); return want.filter(w=>t.includes(w)).join(",") })()')
ok "KPI card labels" "$KPILABELS" "Total Records,Total Quantity,Delivered,Pending + In Transit,FTL / PTL,POD Received"
sleep 1.5  # let the animated counters settle
ok "Total Records counter settles at 340" "$(ev '(() => { const cards=[...document.querySelectorAll("p")].find(p=>p.textContent.trim()==="Total Records"); if(!cards) return "no-card"; const v=cards.parentElement.querySelector(".kpi-value"); return v?v.textContent.trim():"no-value" })()')" "340"
ok "charts rendered (recharts SVG)" "$(ev '(() => { const n=document.querySelectorAll("svg.recharts-surface").length; return n>0?"yes":"no" })()')" "yes"
ok "status donut uses brand gold slice" "$(ev '(() => { const cells=[...document.querySelectorAll(".recharts-pie-sector path")]; return cells.some(c=>c.getAttribute("fill")==="#E89A16") ? "yes":"no" })()')" "yes"
ok "trend line is Drona red" "$(ev '(() => { const c=[...document.querySelectorAll(".recharts-curve")]; return c.some(x=>x.getAttribute("stroke")==="#A91518") ? "yes":"no" })()')" "yes"
ok "gold route divider present" "$(ev '(() => { const svgs=[...document.querySelectorAll("svg")]; return svgs.some(s=>s.getAttribute("viewBox")==="0 0 200 8") ? "yes":"no" })()')" "yes"
$AB screenshot download/redesign-03-dashboard.png >/dev/null 2>&1

echo "== E. MIS workspace =="
$AB find role button click --name "Centralized MIS" >/dev/null 2>&1
sleep 5
ok "workspace strip: single source of truth" "$(ev 'document.body.textContent.includes("Single source of truth") ? "yes":"no"')" "yes"
ok "centralized database record count" "$(ev 'document.body.textContent.includes("records in the centralized database") ? "yes":"no"')" "yes"
ok "grid rows render" "$(ev '(() => { const n=document.querySelectorAll(".ag-row").length; return n>0?"yes":"no" })()')" "yes"
ok "grid header theme is warm beige (--ag var)" "$(ev '(() => { const el=document.querySelector(".ag-root-wrapper") || document.querySelector("[class*=ag-theme]"); if(!el) return "no-grid"; return getComputedStyle(el).getPropertyValue("--ag-header-background-color").trim() })()')" "#F4F0EA"
ok "grid accent is Drona red" "$(ev '(() => { const el=document.querySelector(".ag-root-wrapper") || document.querySelector("[class*=ag-theme]"); if(!el) return "no-grid"; return getComputedStyle(el).getPropertyValue("--ag-accent-color").trim() })()')" "#A91518"
ok "formula bar with fx chip" "$(ev '(() => { const fx=[...document.querySelectorAll("span")].find(s=>s.textContent.trim()==="fx" && s.title && s.title.includes("Bucket")); return fx?"yes":"no" })()')" "yes"
ok "export button (gold, full total)" "$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>/^Export [0-9,]+ Records?$/.test(x.textContent.trim())); return b?b.textContent.trim():"MISSING" })()')" "Export 340 Records"
ok "export button styled gold (brand-gold class)" "$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>/^Export [0-9,]+ Records?$/.test(x.textContent.trim())); if(!b) return "MISSING"; return b.className.toString().includes("brand-gold") ? "yes" : "no" })()')" "yes"
ok "Add MIS Entry styled Drona red" "$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Add MIS Entry"); if(!b) return "MISSING"; return getComputedStyle(b).backgroundColor })()')" "rgb(169, 21, 24)"
ok "footer showing-count" "$(ev 'document.body.textContent.includes("Showing") && document.body.textContent.includes("of") ? "yes":"no"')" "yes"
$AB screenshot download/redesign-04-mis.png >/dev/null 2>&1

echo "== F. global search (header → workspace) =="
setinput 'input[placeholder="Search the MIS…"]' "HISAR"
$AB press Enter >/dev/null 2>&1
sleep 5
ok "global search jumps to MIS workspace" "$(ev '(() => { const t=[...document.querySelectorAll("header h1")].map(h=>h.textContent.trim()); return t.includes("Centralized MIS Workspace")?"yes":"no:"+t.join("|") })()')" "yes"
ok "search term lands in workspace search box" "$(ev '(() => { const i=document.querySelector("input[aria-label=\"Search records\"]"); return i?i.value:"no-input" })()')" "HISAR"
TOTAL_S=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export ([0-9,]+) Records?$/.test(x.trim())); const m=t&&t.match(/Export ([0-9,]+) Records?/); return m?m[1].replace(/,/g,""):"-1" })()')
ok "filtered total (HISAR → 5, case-insensitive)" "$TOTAL_S" "5"
# clear search via the workspace box clear button
ev '(() => { const b=document.querySelector("button[aria-label=\"Clear search\"]"); if(b){b.click(); return "cleared"} return "no-btn" })()' >/dev/null
sleep 4
TOTAL_C=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export ([0-9,]+) Records?$/.test(x.trim())); const m=t&&t.match(/Export ([0-9,]+) Records?/); return m?m[1].replace(/,/g,""):"-1" })()')
ok "clear search restores full total" "$TOTAL_C" "340"

echo "== G. filterwise export regression =="
# intercept export POSTs
ev '(() => {
  window.__exportCalls = [];
  const orig = window.fetch;
  window.fetch = async function(...args) {
    const [url, init] = args;
    const u = typeof url === "string" ? url : (url && url.url) || "";
    if (u.includes("/api/export")) {
      const entry = { url: u, body: null, status: null, fileName: null, bytes: null };
      try { entry.body = init && init.body ? JSON.parse(String(init.body)) : null } catch(e) { entry.body = String(init && init.body) }
      const res = await orig.apply(this, args);
      entry.status = res.status;
      entry.fileName = res.headers.get("x-file-name");
      entry.bytes = res.headers.get("content-length");
      window.__exportCalls.push(entry);
      return res;
    }
    return orig.apply(this, args);
  };
  return "patched";
})()' >/dev/null
# structured filter: Destination = HISAR
$AB press Escape >/dev/null 2>&1; sleep 0.5
$AB find role button click --name "Filters" >/dev/null 2>&1
sleep 1.5
setinput 'input[placeholder="e.g. Delhi"]' "HISAR"
sleep 0.5
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim()==="Apply filters"); if(!b) return "no-apply"; b.click(); return "applied" })()' >/dev/null
sleep 4
TOTAL_F=$(ev '(() => { const t=[...document.querySelectorAll("body *")].map(x=>x.textContent).find(x=>/^Export ([0-9,]+) Records?$/.test(x.trim())); const m=t&&t.match(/Export ([0-9,]+) Records?/); return m?m[1].replace(/,/g,""):"-1" })()')
ok "structured filter applies (340 → 5)" "$TOTAL_F" "5"
# export via real clicks (Radix)
$AB press Escape >/dev/null 2>&1; sleep 0.5
EXPORTBTN=$(ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>/^Export [0-9,]+ Records?$/.test(x.textContent.trim())); return b ? b.textContent.trim() : "MISSING" })()')
$AB find role button click --name "$EXPORTBTN" >/dev/null 2>&1
sleep 1.5
ok "export dropdown opens" "$(ev 'document.querySelector("[role=menu]") ? "open" : "closed"')" "open"
$AB find role menuitem click --name "Download .xlsx" >/dev/null 2>&1
sleep 4
CALL=$(ev '(() => { const c=window.__exportCalls && window.__exportCalls[0]; if(!c) return "NO-CALL"; return JSON.stringify({status:c.status, fileName:c.fileName, bytes:Number(c.bytes), filter:c.body && c.body.filterModel}) })()')
okc "export POST 200" "$CALL" '"status":200'
okc "xlsx filename header" "$CALL" 'MIS_Export_'
okc "filterModel carried (destination)" "$CALL" 'destination'
okc "filter value HISAR" "$CALL" 'HISAR'
ok "xlsx bytes > 5KB" "$(python3 -c "
import json
try:
  d=json.loads('''$CALL'''); b=d.get('bytes') or 0; print('yes' if b and b>5000 else 'no:'+str(b))
except Exception: print('parse-fail')")" "yes"
# clear the structured filter via the chips-row "clear all" (lowercase)
ev '(() => { const b=[...document.querySelectorAll("button")].find(x=>x.textContent.trim().toLowerCase()==="clear all"); if(!b) return "no-clear"; b.click(); return "cleared" })()' >/dev/null
sleep 4
$AB press Escape >/dev/null 2>&1
sleep 0.5

echo "== H. other views =="
$AB find role button click --name "Reports & Summaries" >/dev/null 2>&1
sleep 4
okc "reports view renders tabs" "$(ev 'document.body.textContent')" "Pending Deliveries"
okc "reports table renders" "$(ev '(() => { const n=document.querySelectorAll("table tbody tr").length; return n>0?"rows:"+n:"no-rows" })()')" "rows:"
$AB find role button click --name "Import / Export" >/dev/null 2>&1
sleep 4
okc "import/export view renders" "$(ev 'document.body.textContent')" "Import Excel"
$AB find role button click --name "Audit Trail" >/dev/null 2>&1
sleep 4
okc "audit view renders" "$(ev 'document.body.textContent')" "Audit trail"
$AB find role button click --name "Users & Settings" >/dev/null 2>&1
sleep 4
okc "settings view renders" "$(ev 'document.body.textContent')" "MIS Fields"
$AB screenshot download/redesign-05-settings.png >/dev/null 2>&1

echo "== I. dark mode + mobile drawer =="
$AB press Escape >/dev/null 2>&1
sleep 0.5
# dark mode
$AB find role button click --name "Toggle theme" >/dev/null 2>&1
sleep 2
ok "dark theme applied" "$(ev 'document.documentElement.classList.contains("dark") ? "yes":"no"')" "yes"
ok "dark background is warm charcoal" "$(ev 'getComputedStyle(document.body).backgroundColor')" "rgb(33, 30, 27)"
ok "sidebar adapts (darker charcoal)" "$(ev '(() => { const a=document.querySelector("aside"); return a?getComputedStyle(a).backgroundColor:"no-aside" })()')" "rgb(28, 26, 23)"
$AB screenshot download/redesign-06-dark.png >/dev/null 2>&1
$AB find role button click --name "Toggle theme" >/dev/null 2>&1
sleep 2
ok "light theme restored" "$(ev 'getComputedStyle(document.body).backgroundColor')" "rgb(250, 250, 248)"
# mobile drawer
$AB set viewport 390 844 >/dev/null 2>&1
sleep 2
ok "hamburger visible on mobile" "$(ev '(() => { const b=[...document.querySelectorAll("header button")].find(x=>x.getAttribute("aria-label")==="Open navigation"); if(!b) return "no-btn"; return getComputedStyle(b).display==="none"?"hidden":"visible" })()')" "visible"
ok "desktop sidebar hidden on mobile" "$(ev '(() => { const a=document.querySelector("aside"); if(!a) return "no-aside"; return getComputedStyle(a).display==="none"?"hidden":"visible" })()')" "hidden"
$AB find role button click --name "Open navigation" >/dev/null 2>&1
sleep 2
okc "mobile drawer opens with nav" "$(ev '(() => { const nav=[...document.querySelectorAll("[role=dialog] nav button, [data-state=open] nav button")]; return nav.length>0?"yes("+nav.length+")":"no" })()')" "yes("
$AB screenshot download/redesign-07-mobile.png >/dev/null 2>&1
$AB press Escape >/dev/null 2>&1
sleep 1
$AB set viewport 1440 900 >/dev/null 2>&1
sleep 1

echo ""
echo "================================"
echo "REDESIGN BROWSER E2E: $PASS pass / $FAIL fail"
echo "================================"
[ "$FAIL" = "0" ] && echo "ALL GREEN" || echo "FAILURES PRESENT"
