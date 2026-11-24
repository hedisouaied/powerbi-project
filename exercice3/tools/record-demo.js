// Records a guided usage demo of the packaged Mission Control visual in a hidden (headless) Chrome:
// a visible cursor moves, clicks, types and drags with real input events; captions explain each step.
// Frames come from the Chrome screencast; ffmpeg turns them into an MP4. Never touches the user's screen.
// Usage: node record-demo.js <folder with preview-command.html> <out.mp4> <ffmpeg.exe>
"use strict";
const { spawn, execFileSync } = require("child_process");
const fs = require("fs"), path = require("path");
const [dir, outMp4, ffmpeg] = process.argv.slice(2);
const chrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const frames = path.join(dir, "frames"); fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames);
const W = 1600, H = 900, PORT = 9339;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    const proc = spawn(chrome, ["--headless=new", `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars", "--disable-gpu",
        `--user-data-dir=${path.join(dir, "rec-profile")}`, "--allow-file-access-from-files", "about:blank"], { stdio: "ignore" });
    let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) { break; } } catch { /* starting */ } await sleep(200); }
    const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener("open", r));
    let id = 0; const pending = new Map(); const shots = [];
    ws.addEventListener("message", ev => {
        const m = JSON.parse(ev.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
        if (m.method === "Page.screencastFrame") {
            const f = path.join(frames, `f${String(shots.length).padStart(5, "0")}.jpg`);
            fs.writeFileSync(f, Buffer.from(m.params.data, "base64")); shots.push({ f, t: m.params.metadata.timestamp });
            send("Page.screencastFrameAck", { sessionId: m.params.sessionId });
        }
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async expr => (await send("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }))?.result?.value;

    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send("Page.enable");
    await send("Page.navigate", { url: "file:///" + path.join(dir, "preview-command.html").replace(/\\/g, "/") });
    for (let i = 0; i < 100 && !(await js("!!document.querySelector('.mc-nav')")); i++) { await sleep(100); }
    // overlay: cursor + caption + click ripple
    await js(`(() => {
      const st = document.createElement('style'); st.textContent = \`
        #demo-cur{position:fixed;left:0;top:0;z-index:99999;pointer-events:none;transition:transform .7s cubic-bezier(.22,1,.36,1);filter:drop-shadow(0 2px 3px rgba(0,0,0,.5))}
        #demo-cap{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);z-index:99998;pointer-events:none;padding:12px 26px;border-radius:14px;
          background:rgba(8,9,12,.88);color:#fff;font:600 21px 'Segoe UI',sans-serif;border:1px solid #FFC53D;box-shadow:0 10px 30px rgba(0,0,0,.4);transition:opacity .3s;max-width:1300px;text-align:center}
        #demo-cap b{color:#FFC53D} .demo-ring{position:fixed;z-index:99997;width:36px;height:36px;margin:-18px 0 0 -18px;border-radius:50%;border:3px solid #FFC53D;pointer-events:none;animation:dr .5s ease-out forwards}
        @keyframes dr{from{transform:scale(.3);opacity:1}to{transform:scale(1.6);opacity:0}}\`; document.head.appendChild(st);
      const c = document.createElement('div'); c.id = 'demo-cur'; c.innerHTML = '<svg width="26" height="30" viewBox="0 0 26 30"><path d="M2 2 L2 24 L8 18 L12 28 L16 26 L12 16 L21 16 Z" fill="#fff" stroke="#111" stroke-width="1.6"/></svg>';
      c.style.transform = 'translate(800px,450px)'; document.body.appendChild(c);
      const p = document.createElement('div'); p.id = 'demo-cap'; p.style.opacity = 0; document.body.appendChild(p);
      window.__cap = (h) => { p.innerHTML = h; p.style.opacity = h ? 1 : 0; };
      window.__cur = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
      window.__ring = (x, y) => { const r = document.createElement('div'); r.className = 'demo-ring'; r.style.left = x + 'px'; r.style.top = y + 'px'; document.body.appendChild(r); setTimeout(() => r.remove(), 600); };
      window.__find = (sel, text, idx) => { let els = Array.from(document.querySelectorAll(sel)); if (text) { els = els.filter(e => e.textContent.trim() === text).concat(els.filter(e => e.textContent.includes(text) && e.textContent.trim() !== text)); }
        const e = els[idx || 0]; if (!e) { return null; } e.scrollIntoView({ block: 'nearest' }); const r = e.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; };
    })()`);
    await send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });

    let cx = 800, cy = 450;
    const cap = async (t, ms = 0) => { await js(`__cap(${JSON.stringify(t)})`); if (ms) { await sleep(ms); } };
    const move = async (x, y) => { await js(`__cur(${x},${y})`); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); cx = x; cy = y; await sleep(750); };
    const find = async (sel, text, idx) => js(`__find(${JSON.stringify(sel)}, ${JSON.stringify(text ?? "")}, ${idx ?? 0})`);
    const click = async (sel, text, idx, after = 900) => {
        const p = await find(sel, text, idx); if (!p) { console.log("not found:", sel, text ?? ""); return false; }
        await move(p.x, p.y); await js(`__ring(${p.x},${p.y})`);
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
        await sleep(after); return true;
    };
    const typeText = async (t) => { for (const ch of t) { await send("Input.insertText", { text: ch }); await sleep(90); } await sleep(400); };
    const key = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); await sleep(700); };
    const drag = async (x1, y1, x2, y2, steps = 25) => { await move(x1, y1); await send("Input.dispatchMouseEvent", { type: "mousePressed", x: x1, y: y1, button: "left", clickCount: 1 });
        for (let i = 1; i <= steps; i++) { const x = x1 + (x2 - x1) * i / steps, y = y1 + (y2 - y1) * i / steps; await js(`__cur(${x},${y})`); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 1 }); await sleep(45); }
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: x2, y: y2, button: "left", clickCount: 1 }); await sleep(600); };
    const nav = (label) => click(".mc-nav", label, 0, 1500);
    const scrollOutlet = async (px) => { await js(`document.querySelector('.mc-outlet').scrollBy({ top: ${px}, behavior: 'smooth' })`); await sleep(1300); };

    // ------------------------------------------------------------- the tour
    await cap("<b>MISSION CONTROL</b> · one Power BI page, one TypeScript visual — let's take a tour", 3500);
    await cap("<b>Command Center</b> · live KPI cards, business health, 3D campus, AI assistant", 1000);
    await move(420, 250); await sleep(900); await move(1050, 470); await sleep(900);
    await scrollOutlet(520); await sleep(800); await scrollOutlet(-520);
    await cap("<b>Theme switch</b> · one click from dark to light — saved inside the report", 600);
    await click(".mc-theme-switch [title='Light theme']", "", 0, 2200);
    await cap("<b>Customizable dashboard</b> · reorder, resize and remove widgets", 400);
    await click(".mc-btn", "Customize", 0, 1300);
    await click(".mc-size", "L", 1, 1500);
    await click(".mc-btn", "Reset layout", 0, 1200);
    await click(".mc-btn", "Done", 0, 1000);
    await cap("<b>Global search</b> · Ctrl+K palette: modules, customers, orders, projects…", 300);
    await click(".mc-search", "", 0, 900);
    await typeText("O00004");
    await sleep(700); await key("Enter", "Enter", 13); await sleep(1800);
    await cap("<b>Entity inspector</b> · the order opens with its lines, payment and anomaly flags", 2500);
    await click(".mc-drawer [title='Close']", "", 0, 900);

    await nav("Task Manager"); await cap("<b>Task Manager</b> · Kanban board with create / edit / delete and validation", 300);
    await click(".mc-btn", "New task", 0, 1100);
    await click("[data-focus='tf-title']", "", 0, 400); await typeText("Prepare Q4 board review");
    await click(".mc-modal-actions .mc-btn", "Create", 0, 1800);
    await cap("New task added — clearly labelled as a demo-session edit", 2200);

    await nav("Calendar"); await cap("<b>Calendar</b> · month, week, agenda and timeline views with conflict detection", 300);
    await click(".mc-tab", "Week", 0, 1600); await click(".mc-tab", "Agenda", 0, 1600); await click(".mc-tab", "Month", 0, 1200);

    await nav("AI Assistant"); await cap("<b>AI Business Assistant</b> · rule-based answers grounded in the data, with sources", 300);
    await click("button", "What changed this month?", 0, 2600);
    await click("button", "Which customers are at risk?", 0, 2800);

    await nav("Business Detective"); await cap("<b>Business Detective</b> · cases, evidence board and timeline — neutral, data-computed findings", 300); await move(1300, 450); await sleep(1500); await scrollOutlet(380); await sleep(800);

    await nav("Network Graph"); await cap("<b>Network graph</b> · relationships between customers, suppliers, projects and people", 300); await sleep(600);
    await click(".mc-node", "", 3, 1800);

    await nav("What-If & Scenario Lab"); await cap("<b>What-If simulator</b> · move a lever, every output and the profit bridge update instantly", 300);
    const r = await find(".mc-range", "", 0);
    if (r) { await drag(r.x, r.y, r.x + 120, r.y, 20); await sleep(1500); }
    await click(".mc-btn", "Reset", 0, 1000);

    await nav("Crisis Simulator"); await cap("<b>Crisis simulator</b> · apply a shock, see exposure, impact and recovery levers", 300); await click(".mc-tab", "Cost surge", 0, 1800); await click(".mc-tab", "Supplier disruption", 0, 1800);

    await nav("Time Machine"); await cap("<b>Time Machine</b> · replay the business history frame by frame", 300); await click(".mc-btn", "Play", 0, 4200); await click(".mc-btn", "Pause", 0, 900);

    await nav("Digital Twin 2D/3D"); await cap("<b>3D digital twin</b> · drag to rotate, click a building to inspect the department", 300); await click(".mc-tab", "3D environment", 0, 1500);
    const sc = await find(".mc-scene", "", 0);
    if (sc) { await drag(sc.x - 150, sc.y + 40, sc.x + 120, sc.y + 10, 30); await sleep(800); }
    await click(".mc-block .mc-top", "", 1, 2400);
    await click(".mc-drawer [title='Close']", "", 0, 900);

    await nav("Geo Intelligence"); await cap("<b>Geo intelligence</b> · Tunisian regions compared — click to drill into customers", 300); await click(".mc-tile", "Sfax", 0, 1800); await click(".mc-tab", "At-risk share", 0, 1800);

    await nav("Data Explorer"); await cap("<b>Data Explorer</b> · 31 tables: search, sort, columns, row inspector, CSV export", 300); await click("[data-focus='ex-global']", "", 0, 300); await typeText("Sfax"); await sleep(1200);
    await click(".mc-table tbody tr", "", 3, 2200); await click(".mc-drawer [title='Close']", "", 0, 800);

    await nav("Data Doctor"); await cap("<b>Data Doctor</b> · automated quality checks with a transparent score formula", 300); await sleep(1500);

    await nav("Settings & Help"); await cap("<b>Settings</b> · accents, density, motion — and an honest view of what is saved where", 300); await click(".mc-swatch.mc-sw-teal", "", 0, 1600); await click(".mc-swatch.mc-sw-gold", "", 0, 1300);
    await click(".mc-tab", "Edits & storage", 0, 2200);

    await nav("Command Center");
    await cap("<b>29 / 29 features · 33 modules</b> · Power BI · TypeScript · DAX · Power Query", 3500);
    await cap("", 600);

    await send("Page.stopScreencast"); await sleep(500);
    ws.close(); proc.kill();
    // frames -> constant-rate video
    const lines = ["ffconcat version 1.0"];
    shots.forEach((s, i) => { const d = i < shots.length - 1 ? Math.max(0.001, shots[i + 1].t - s.t) : 1; lines.push(`file '${s.f.replace(/\\/g, "/")}'`, `duration ${d.toFixed(4)}`); });
    lines.push(`file '${shots[shots.length - 1].f.replace(/\\/g, "/")}'`);
    fs.writeFileSync(path.join(dir, "frames.ffconcat"), lines.join("\n"));
    execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", path.join(dir, "frames.ffconcat"),
        "-vf", "fps=30,scale=1920:1080:flags=lanczos,format=yuv420p", "-c:v", "libx264", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", outMp4]);
    console.log(`${shots.length} frames, ${(shots[shots.length - 1].t - shots[0].t).toFixed(1)} s -> ${outMp4}`);
})().catch(e => { console.error(e); process.exit(1); });
