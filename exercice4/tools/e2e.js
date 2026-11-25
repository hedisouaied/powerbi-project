// End-to-end test of the running web app (http://localhost:8000/app/) in a hidden Chrome, with real input events.
// Signs in, checks the dashboard numbers, creates a task through the UI and verifies it in MySQL (via the API),
// switches theme and verifies it survives a reload, signs out. Saves screenshots. Never touches the user's screen.
// Usage: node tools/e2e.js [outDir] [email] [password]
"use strict";
const { spawn } = require("child_process");
const fs = require("fs"), path = require("path"), os = require("os");
const out = process.argv[2] || path.join(os.tmpdir(), "mc-web-e2e");
const EMAIL = process.argv[3] || "demo@missioncontrol.local", PASS = process.argv[4] || "Demo12345";
const BASE = process.env.MC_BASE || "http://localhost:8000/app/", W = 1600, H = 900, PORT = 9341;
fs.mkdirSync(out, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = []; const ok = (name, cond, info = "") => { results.push(`${cond ? "ok  " : "FAIL"} ${name}${cond || !info ? "" : " (" + info + ")"}`); };

(async () => {
    const chrome = spawn("C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", ["--headless=new", `--remote-debugging-port=${PORT}`, `--window-size=${W},${H}`, "--hide-scrollbars",
        `--user-data-dir=${path.join(out, "profile-" + Date.now())}`, "about:blank"], { stdio: "ignore" });
    let targets; for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); if (targets.length) { break; } } catch { /* starting */ } await sleep(200); }
    const ws = new WebSocket(targets.find(t => t.type === "page").webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r));
    let id = 0; const pending = new Map(); const errors = [];
    ws.addEventListener("message", ev => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m.result ?? m.error); pending.delete(m.id); }
        if (m.method === "Runtime.exceptionThrown") { errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text); } });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const js = async e => (await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value;
    const waitFor = async (e, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(e)) { return true; } await sleep(150); } return false; };
    const shot = async name => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(out, name), Buffer.from(r.data, "base64")); };
    const center = async sel => js(`(() => { const e = ${sel}; if (!e) return null; e.scrollIntoView({block:'nearest'}); const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const click = async sel => { const p = await center(sel); if (!p) { return false; } for (const type of ["mousePressed", "mouseReleased"]) { await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: 1 }); } await sleep(300); return true; };
    const type = async (sel, text) => { await click(sel); await js(`(() => { const e = ${sel}; if (e && e.select) e.select(); })()`); await send("Input.insertText", { text }); await sleep(150); };
    const byText = (sel, t) => `Array.from(document.querySelectorAll(${JSON.stringify(sel)})).find(e => e.textContent.trim() === ${JSON.stringify(t)} || e.title === ${JSON.stringify(t)})`;

    await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
    await send("Runtime.enable"); await send("Page.enable");
    await send("Page.navigate", { url: BASE });
    ok("login page shows", await waitFor("!!document.querySelector('.auth-card')"));
    await sleep(600); await shot("01-login.png");
    ok("sign-in form is prefilled with the demo account", await js("document.querySelector('input[type=email]').value === 'demo@missioncontrol.local' && document.querySelector('input[type=password]').value.length > 0"));
    // wrong password
    await type("document.querySelector('input[type=email]')", EMAIL); await type("document.querySelector('input[type=password]')", "wrong-pass9");
    await click("document.querySelector('.auth-submit')");
    ok("wrong password is refused", await waitFor("!!document.querySelector('.auth-field em, .auth-error')"));
    // sign in
    await js("document.querySelector('input[type=password]').select()"); await send("Input.insertText", { text: PASS });
    await click("document.querySelector('.auth-submit')");
    ok("dashboard loads after sign-in", await waitFor("!!document.querySelector('.mc-kpi-value')", 30000));
    await sleep(2500);
    const kpi = await js("document.querySelector('.mc-kpi-value')?.textContent ?? document.body.innerText.slice(0, 300)");
    ok("CA total (12 mois) = 30,90 M TND, comme dans Power BI", /^30,90\sM\sTND$/.test(kpi), kpi);
    ok("bandeau : 120 incidents · 31 critiques", (await js("document.querySelector('.mc-ribbon')?.textContent ?? ''")).includes("120 · 31 critiques"));
    ok("signed-in user in the header", (await js("document.querySelector('.mc-profile-name')?.textContent ?? ''")).length > 0);
    ok("no feed issue banner", !(await js("!!document.querySelector('.mc-feed-alert')")));
    await shot("02-dashboard-dark.png");
    // every module renders
    const modErr = await js(`(async () => { const out = []; for (const t of Array.from(document.querySelectorAll('.mc-nav')).map(b => b.title)) { Array.from(document.querySelectorAll('.mc-nav')).find(b => b.title === t).click(); await new Promise(r => setTimeout(r, 30)); const e = document.querySelector('.mc-error-box'); if (e) out.push(t + ': ' + e.textContent.slice(0, 80)); } return out; })()`);
    ok("all 33 modules render", modErr.length === 0, modErr.join("; "));
    // create a task through the UI
    const title = `Web task ${Date.now() % 100000}`;
    await click(byText(".mc-nav", "Gestionnaire de tâches")); await sleep(300);
    await click(byText(".mc-btn", "Nouvelle tâche")); await sleep(300);
    await type("document.querySelector('[data-focus=\"tf-title\"]')", title);
    await click(byText(".mc-modal-actions .mc-btn", "Créer")); await sleep(1500);
    ok("task visible on the board", (await js("(document.querySelector('.mc-outlet')?.textContent ?? '')")).includes(title));
    const inDb = await js(`fetch('/api/feeds', { headers: { Authorization: 'Bearer ' + localStorage.getItem('mc.token'), Accept: 'application/json' } }).then(r => r.json()).then(j => j.feeds.tasks.r.some(r => r.includes(${JSON.stringify(title)})))`);
    ok("task saved in MySQL (returned by the API)", inDb === true);
    await shot("03-task-created.png");
    // theme persists across reload (preferences saved on the account)
    await click("document.querySelector('.mc-theme-switch [title=\"Thème clair\"]')"); await sleep(1200);
    await send("Page.reload"); await waitFor("!!document.querySelector('.mc-kpi-value')", 30000); await sleep(1500);
    ok("light theme kept after reload", await js("!!document.querySelector('.mc-theme-light')"));
    await click(byText(".mc-nav", "Gestionnaire de tâches")); await sleep(300); await type("document.querySelector('[data-focus=\"task-q\"]')", title); await sleep(500);
    ok("new task found with the board search after reload", (await js("(document.querySelector('.mc-outlet')?.textContent ?? '')")).includes(title));
    await click(byText(".mc-nav", "Centre de commande")); await sleep(1500); await shot("04-dashboard-light.png");
    // remove the test task again (the API deletes it from MySQL)
    const del = await js(`(async () => { const h = { Authorization: 'Bearer ' + localStorage.getItem('mc.token'), Accept: 'application/json' }; const j = await (await fetch('/api/feeds', { headers: h })).json(); const f = j.feeds.tasks; const row = f.r.find(r => r.includes(${JSON.stringify(title)})); if (!row) return false; const id = row[f.c.indexOf('task_id')]; return (await fetch('/api/tables/tasks/' + id, { method: 'DELETE', headers: h })).ok; })()`);
    ok("test task deleted through the API", del === true);
    // restore dark for the next run, then sign out
    await click("document.querySelector('.mc-theme-switch [title=\"Thème sombre\"]')"); await sleep(1000);
    await click("document.querySelector('[title=\"Se déconnecter\"]')");
    ok("sign-out returns to the login page", await waitFor("!!document.querySelector('.auth-card')"));
    ok("token removed", !(await js("localStorage.getItem('mc.token')")));
    ok("no JavaScript errors", errors.length === 0, errors.join(" | ").slice(0, 300));
    ws.close(); chrome.kill();
    console.log(results.join("\n")); const f = results.filter(r => r.startsWith("FAIL")).length;
    console.log(`${f ? "FAILED" : "PASS"} ${results.length - f}/${results.length} · screenshots in ${out}`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
