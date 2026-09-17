#!/bin/bash
# login-film-visual-check.sh — dark mode + mobile views of the new
# film-stage login page (screenshots for review).
set -u
cd /home/z/my-project
AB="agent-browser"
ev() { $AB eval "$1" 2>/dev/null | python3 -c "import sys,json
raw=sys.stdin.read().strip()
try: print(json.loads(raw))
except Exception: print(raw)"; }

$AB cookies clear >/dev/null 2>&1
$AB set viewport 1440 900 >/dev/null 2>&1
$AB open http://localhost:81/ >/dev/null 2>&1
$AB wait --load networkidle >/dev/null 2>&1
sleep 3

echo "== dark mode login =="
$AB find role button click --name "Toggle theme" >/dev/null 2>&1 || $AB eval 'document.documentElement.classList.add("dark")' >/dev/null 2>&1
sleep 2
ok_dark="$(ev 'document.documentElement.classList.contains("dark") ? "yes":"no"')"
echo "dark applied: $ok_dark"
ok_play="$(ev '(() => { const v=document.querySelector("video"); return v && !v.paused && v.currentTime > 0.5 ? "still-playing" : "stopped" })()')"
echo "film in dark: $ok_play"
ok_plate="$(ev '(() => { const plate=[...document.querySelectorAll("div")].find(d=>getComputedStyle(d).backgroundColor==="rgb(253, 253, 253)"); return plate ? "plate-present" : "no-plate" })()')"
echo "warm-white plate in dark: $ok_plate"
$AB screenshot download/login-film-dark.png >/dev/null 2>&1
# back to light
$AB eval 'document.documentElement.classList.remove("dark")' >/dev/null 2>&1; sleep 1

echo "== mobile login =="
$AB set viewport 390 844 >/dev/null 2>&1
sleep 2
ok_hero="$(ev '(() => { const v=document.querySelector("video"); if(!v) return "no-video"; const r=v.getBoundingClientRect(); return r.width>100 && r.height>40 && r.top>=0 && r.top<400 ? "film-hero-visible" : "hero-off:"+Math.round(r.top) })()')"
echo "mobile film hero: $ok_hero"
ok_form="$(ev '(() => { const i=document.querySelector("input[type=email]"); if(!i) return "no-email"; const r=i.getBoundingClientRect(); return r.top<844 ? "form-below-reachable" : "form-off-screen" })()')"
echo "mobile form reachable: $ok_form"
$AB screenshot download/login-film-mobile.png >/dev/null 2>&1

echo "== desktop light =="
$AB set viewport 1440 900 >/dev/null 2>&1
sleep 1
$AB screenshot download/login-film-light.png >/dev/null 2>&1
echo "screenshots: download/login-film-{light,dark,mobile}.png"
