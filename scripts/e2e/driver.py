"""End-to-end driver for Memosa 3.0 (pairs with the `e2e` cargo feature).

Build:   npx tauri build --features e2e --bundles app
Launch:  HOME=<throwaway home> MEMOSA_E2E_DIR=<this dir>/cmd \
           target/release/bundle/macos/Memosa.app/Contents/MacOS/memosa
Use:     import driver as t; t.step("Library", "opens", "await T.click('Library','.v3-nav'); return 1")

Steps run JavaScript inside the real webview and click real DOM elements
(with a hit test at the element's center), so no OS input events are posted
and the Mac needs no Accessibility permission. Every step waits until the
Mac has been idle for 120 s; if a person comes back mid-run the test
window is hidden at once and the run waits until they have been away 5 min.
Use a throwaway HOME with made-up data; never point it at real recordings.
"""
import os, json, time, subprocess, itertools, sys
import Quartz
from AppKit import NSWorkspace, NSBitmapImageRep, NSPNGFileType
from Quartz import CGWindowListCopyWindowInfo, kCGWindowListOptionAll, kCGNullWindowID
E = os.environ.get("MEMOSA_E2E_HOME_DIR") or os.path.dirname(os.path.abspath(__file__))
CMD = os.environ.get("MEMOSA_E2E_CMD") or os.path.join(E, "cmd"); SHOTS = os.path.join(E, "shots")
_n = itertools.count(int(time.time()) % 100000 * 100)
LOG = os.path.join(E, "log.jsonl")

def idle():
    out = subprocess.run(["ioreg","-c","IOHIDSystem"],capture_output=True,text=True).stdout
    for l in out.splitlines():
        if "HIDIdleTime" in l: return int(l.split()[-1]) // 1_000_000_000
    return 0
HIDDEN = [False]
def guard():
    # A person at the Mac: hide the test window at once, wait until they have
    # been away 5 minutes, then bring it back and carry on.
    while True:
        i = idle(); front = NSWorkspace.sharedWorkspace().frontmostApplication().localizedName()
        if i >= (300 if HIDDEN[0] else 120):
            if HIDDEN[0]:
                _send("vis", "show"); time.sleep(1); HIDDEN[0] = False
            return front
        if not HIDDEN[0]:
            _send("vis", "hide", timeout=5); HIDDEN[0] = True
        print(f"[guard] user active (idle {i}s, front {front}); window hidden, waiting", flush=True); time.sleep(20)

PRE = r"""
const T = window.__t || (window.__t = {
  sleep: ms => new Promise(r => setTimeout(r, ms)),
  vis: el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; },
  all: sel => [...document.querySelectorAll(sel)].filter(e => T.vis(e)),
  find: (text, sel) => {
    const els = T.all(sel || 'button, [role=tab], .v3-omni, input, a');
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    return els.find(e => norm(e.innerText) === text || e.title === text || e.getAttribute('aria-label') === text)
        || els.find(e => norm(e.innerText).includes(text) || (e.title || '').includes(text));
  },
  need: (text, sel) => { const e = T.find(text, sel); if (!e) throw new Error('not found: ' + text); return e; },
  click: async (target, sel) => {
    const el = typeof target === 'string' ? T.need(target, sel) : target;
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!hit || !(el === hit || el.contains(hit))) throw new Error('covered: ' + (el.innerText || el.title).slice(0, 40) + ' under ' + (hit && (hit.className || hit.tagName)));
    if (el.disabled) throw new Error('disabled: ' + (el.innerText || '').slice(0, 40));
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, clientX: x, clientY: y }));
    el.click(); await T.sleep(250); return (el.innerText || el.title || '').trim().slice(0, 60);
  },
  type: async (el, text) => {
    if (typeof el === 'string') el = document.querySelector(el);
    el.focus();
    const set = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set; set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true })); await T.sleep(120); return el.value;
  },
  key: async (key, opts = {}, el) => { (el || document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...opts })); await T.sleep(250); },
  text: sel => (document.querySelector(sel || '.v3') || {}).innerText || '',
  until: async (fn, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await T.sleep(200); } throw new Error('timeout waiting'); },
});
"""
def _send(ext, body, timeout=30):
    n = f"{next(_n):010d}"; tmp = os.path.join(CMD, n + ".tmp")
    open(tmp, "w").write(body); os.rename(tmp, os.path.join(CMD, f"{n}.{ext}"))
    res = os.path.join(CMD, f"res-{n}.json"); t0 = time.time()
    while time.time() - t0 < timeout:
        if os.path.exists(res):
            r = json.load(open(res)); os.remove(res); return r
        time.sleep(0.1)
    return {"ok": False, "value": "TIMEOUT"}
def js(code, timeout=30):
    guard(); return _send("js", PRE + code, timeout)
def pjs(code, timeout=30):
    guard(); return _send("pjs", PRE + code, timeout)
def size(w, h): guard(); r = _send("size", f"{w} {h}"); time.sleep(0.8); return r
def theme(t): guard(); r = _send("theme", t); time.sleep(0.6); return r
def pick(p): open(os.path.join(CMD, "pick"), "w").write(p)

def win_id():
    ws = [w for w in CGWindowListCopyWindowInfo(kCGWindowListOptionAll, kCGNullWindowID)
          if w.get("kCGWindowOwnerName") == "Memosa" and w.get("kCGWindowName") == "Memosa"]
    ws.sort(key=lambda w: -w["kCGWindowBounds"]["Width"] * w["kCGWindowBounds"]["Height"])
    return ws[0]["kCGWindowNumber"]
def shot(name):
    wid = win_id()
    img = Quartz.CGWindowListCreateImage(Quartz.CGRectNull, Quartz.kCGWindowListOptionIncludingWindow, wid, Quartz.kCGWindowImageBoundsIgnoreFraming)
    rep = NSBitmapImageRep.alloc().initWithCGImage_(img)
    p = os.path.join(SHOTS, name + ".png"); rep.representationUsingType_properties_(NSPNGFileType, None).writeToFile_atomically_(p, True); return p

RESULTS = []
def step(area, name, code, expect=None, timeout=30, snap=None, pill=False):
    r = (pjs if pill else js)(code, timeout); ok = r.get("ok") and (expect is None or expect(r.get("value")))
    rec = {"area": area, "step": name, "pass": bool(ok), "value": r.get("value")}
    if snap: rec["shot"] = shot(snap)
    RESULTS.append(rec); open(LOG, "a").write(json.dumps(rec) + "\n")
    print(("PASS " if ok else "FAIL ") + f"[{area}] {name}: " + json.dumps(r.get("value"))[:300], flush=True)
    return r.get("value")
