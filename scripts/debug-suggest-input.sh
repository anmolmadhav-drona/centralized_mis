#!/bin/bash
# Debug — does the native-setter + input event reach React's onChange in SuggestInput?
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

# instrument fetch + input listener
ev '
(() => {
  window.__suggestLog = [];
  const orig = window.fetch;
  window.fetch = async (...args) => {
    const url = String(args[0]);
    if (url.includes("/api/records/suggest")) window.__suggestLog.push(url.split("?")[1]);
    return orig(...args);
  };
  const i = document.getElementById("f-partyName");
  i.addEventListener("input", (e) => { window.__nativeInputFired = true; });
  return "instrumented:" + (i ? "input-found" : "no-input");
})()'

# run the native-set sequence
echo "== eval return: $(ev '(() => {
  const i = document.getElementById("f-partyName");
  if (!i) return "no-input";
  i.focus();
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  if (!set) return "no-descriptor";
  set.call(i, "Ghumman");
  i.dispatchEvent(new Event("input", { bubbles: true }));
  return "ok value=" + i.value;
})()')"

sleep 2
echo "== after 2s: $(ev '(() => {
  const i = document.getElementById("f-partyName");
  const items = [...document.querySelectorAll("[data-radix-popper-content-wrapper] button")].map(b=>b.textContent.trim()).slice(0,4);
  return JSON.stringify({ value: i.value, nativeInputFired: window.__nativeInputFired, suggestLog: window.__suggestLog, popover: items });
})()')"

# also try KeyboardEvent-based input as alternative
echo "== keyboard-event attempt: $(ev '(() => {
  const i = document.getElementById("f-destination");
  if (!i) return "no-input";
  i.focus();
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  set.call(i, "delhi");
  i.dispatchEvent(new KeyboardEvent("input", { bubbles: true, key: "a" }));
  return "ok value=" + i.value;
})()')"
sleep 2
echo "== dest after 2s: $(ev '(() => {
  const i = document.getElementById("f-destination");
  return JSON.stringify({ value: i.value, suggestLog: window.__suggestLog });
})()')"
