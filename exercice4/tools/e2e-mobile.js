// Responsive test in a hidden Chrome emulating a phone and a tablet (touch, real taps). Signs in through the API,
// then checks: ☰ menu, drawer sidebar open/close, no horizontal page overflow in any of the 33 modules, calendar on
// Agenda on phones, full-screen task form. Saves screenshots. Usage: node tools/e2e-mobile.js [outDir]  (MC_BASE optional)
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const out = process.argv[2] || path.join(os.tmpdir(), "mc-web-mobile");
const BASE = process.env.MC_BASE || "http://localhost:8000/app/", PORT = 9343;
const DEVICES = [{ name: "phone", w: 390, h: 844 }, { name: "tablet", w: 820, h: 1180 }];
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, cond, info = "") => { results.push(`${cond ? "ok  " : "FAIL"} ${name}${cond || !info ? "" : " (" + info + ")"}`); };

(async () => {
    const login = await (await fetch(new URL("../api/auth/login", BASE), { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email: "demo@missioncontrol.local", password: "Demo12345" }) })).json();
    const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, "--hide-scrollbars", `--user-data-dir=${path.join(out, "profile-" + Date.now())}`, "about:blank"], { stdio: "ignore" });
    let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) { break; } } catch { /* starting */ } await sleep(200); }
    const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
    let id = 0; const pending = new Map(); const errors = [];
    ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); } if (m.method === "Runtime.exceptionThrown") { errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value;
    const waitFor = async (e, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(e)) { return true; } await sleep(150); } return false; };
    const shot = async name => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(out, name), Buffer.from(r.data, "base64")); };
    const tap = async sel => { const p = await js(`(() => { const e = ${sel}; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`); if (!p) { return false; }
        for (const type of ["touchStart", "touchEnd"]) { await send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: p.x, y: p.y }] }); } await sleep(450); return true; };
    const byText = (sel, t) => `Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(e => e.textContent.trim() === ${JSON.stringify(t)} || e.title === ${JSON.stringify(t)})`;

    await send("Runtime.enable"); await send("Page.enable");
    for (const d of DEVICES) {
        await send("Emulation.setDeviceMetricsOverride", { width: d.w, height: d.h, deviceScaleFactor: 1, mobile: true });
        await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
        await send("Page.navigate", { url: BASE }); await waitFor("document.readyState === 'complete'");
        await js(`localStorage.setItem("mc.token", ${JSON.stringify(login.token)})`);
        await send("Page.navigate", { url: BASE });
        ok(`${d.name}: dashboard loads`, await waitFor("!!document.querySelector('.mc-kpi-value')", 30000));
        await sleep(1800);
        ok(`${d.name}: no horizontal page scroll`, await js("document.documentElement.scrollWidth <= window.innerWidth + 1"));
        ok(`${d.name}: ☰ menu button visible`, await js("(() => { const b = document.querySelector('.mc-menu-btn'); return !!b && b.getBoundingClientRect().width > 0; })()"));
        ok(`${d.name}: sidebar hidden off-screen`, await js("document.querySelector('.mc-side').getBoundingClientRect().right <= 1"));
        await shot(`${d.name}-01-dashboard.png`);
        await tap("document.querySelector('.mc-menu-btn')");
        ok(`${d.name}: tap ☰ opens the sidebar`, await js("document.querySelector('.mc-side').getBoundingClientRect().left >= 0 && document.querySelector('.mc-app').classList.contains('mc-nav-open')"));
        await shot(`${d.name}-02-menu.png`);
        await tap(byText(".mc-nav", "Gestionnaire de tâches"));
        ok(`${d.name}: choosing a module closes the menu and opens it`, await js("!document.querySelector('.mc-app').classList.contains('mc-nav-open') && document.querySelector('.mc-crumb-on')?.textContent === 'Gestionnaire de tâches'"));
        await sleep(600); await shot(`${d.name}-03-tasks.png`);
        await tap(byText(".mc-btn", "Nouvelle tâche"));
        ok(`${d.name}: task form fits the screen`, await js("(() => { const m = document.querySelector('.mc-modal'); if (!m) return false; const r = m.getBoundingClientRect(); return r.left >= -1 && r.right <= window.innerWidth + 1; })()"));
        await shot(`${d.name}-04-task-form.png`);
        await tap("document.querySelector('.mc-modal [title=\"Fermer\"]')");
        // every module: renders, and nothing overflows the page horizontally
        const bad = await js(`(async () => { const out = []; for (const t of Array.from(document.querySelectorAll('.mc-nav')).map(b => b.title)) {
            Array.from(document.querySelectorAll('.mc-nav')).find(b => b.title === t).click(); await new Promise(r => setTimeout(r, 120));
            const o = document.querySelector('.mc-outlet'); const err = document.querySelector('.mc-error-box');
            if (err) out.push(t + ': error'); else if (o.scrollWidth > o.clientWidth + 2) { const R = o.getBoundingClientRect().right; const w = Array.from(o.querySelectorAll('*')).filter(e => e.getBoundingClientRect().right > R + 2 && !e.closest('.mc-table-scroll, .mc-kanban, .mc-gantt, .mc-tabs')); const top = w.find(e => !w.includes(e.parentElement)); out.push(t + ': +' + (o.scrollWidth - o.clientWidth) + 'px ' + (top ? top.tagName.toLowerCase() + '.' + String(top.className.baseVal ?? top.className).trim().split(/s+/).join('.') : '')); }
            if (document.documentElement.scrollWidth > window.innerWidth + 1) out.push(t + ': page scroll'); } return out; })()`);
        ok(`${d.name}: all 33 modules fit the width`, bad.length === 0, bad.join("; "));
        if (d.name === "phone") {
            await js("Array.from(document.querySelectorAll('.mc-nav')).find(b => b.title === 'Calendrier').click()"); await sleep(400);
            ok("phone: calendar opens on Agenda", await js("document.querySelector('.mc-tab-on')?.textContent.trim() === 'Agenda'"));
            await shot("phone-05-calendar.png");
            await js("Array.from(document.querySelectorAll('.mc-nav')).find(b => b.title === 'Explorateur de données').click()"); await sleep(500); await shot("phone-06-explorer.png");
        }
    }
    ok("no JavaScript errors", errors.length === 0, errors.join(" | ").slice(0, 300));
    ws.close(); chrome.kill();
    console.log(results.join("\n")); const f = results.filter(r => r.startsWith("FAIL")).length;
    console.log(`${f ? "FAILED" : "PASS"} ${results.length - f}/${results.length} · screenshots in ${out}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
