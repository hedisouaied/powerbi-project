// Proves the French translation changed no result: runs the original English engine (exercice3) on the English data
// and the translated engine (exercice4/frontend/src/mc) on the French data (same translation as mc:import), then
// compares every number and identifier they produce. Text labels are ignored (they are supposed to differ).
// Usage: node tools/i18n/equivalence.js
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), { execFileSync } = require("child_process");
const ex4 = path.resolve(__dirname, "..", ".."), ex3 = path.resolve(ex4, "..", "exercice3");
const tsc = path.join(ex4, "frontend", "node_modules", "typescript", "bin", "tsc");
function build(srcCore, out) {
    execFileSync(process.execPath, [tsc, path.join(srcCore, "data.ts"), path.join(srcCore, "engine.ts"), "--outDir", out, "--module", "commonjs", "--target", "es2020", "--skipLibCheck", "--strict", "false"], { stdio: "inherit" });
    return { D: require(path.join(out, "data.js")), E: require(path.join(out, "engine.js")) };
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mc-eq-"));
const en = build(path.join(ex3, "visuals", "missionControl", "src", "core"), path.join(tmp, "en"));
const fr = build(path.join(ex4, "frontend", "src", "mc", "core"), path.join(tmp, "fr"));
const feeds = require(path.join(ex3, "tools", "csv-feeds.js"));
const tr = require(path.join(ex4, "backend", "database", "data", "translations_fr.json"));
const { translate } = require("./check-values.js");
const keep = new Set(tr.keep);

function dataset(mod, french) {
    const d = mod.D.emptyDataset();
    mod.D.TABLES.forEach(t => {
        const f = JSON.parse(feeds[t]);
        if (french) { f.r = f.r.map(r => r.map((v, i) => (/_id$/.test(f.c[i]) || keep.has(`${t}.${f.c[i]}`) || /^\d{4}-\d\d-\d\d/.test(String(v)) ? v : translate(v)))); }
        d[t] = mod.D.decode(JSON.stringify(f));
    });
    return d;
}
function run(mod, french) {
    const E = mod.E, ix = new mod.D.Index(dataset(mod, french)), out = {};
    const ctx = key => ({ p: E.period(key, ix.ref, ix.first), dept: "" });
    E.PERIODS.forEach(p => { out[`kpis.${p.key}`] = E.kpis(ix, ctx(p.key)); out[`health.${p.key}`] = E.deptHealth(ix, ctx(p.key)); out[`changed.${p.key}`] = E.whatChanged(E.kpis(ix, ctx(p.key)), E.kpis(ix, { p: E.previous(ctx(p.key).p), dept: "" })).length; });
    ix.d.departments.forEach(dp => { out[`kpis.12m.${dp.department_id}`] = E.kpis(ix, { p: E.period("12m", ix.ref, ix.first), dept: dp.department_id }); });
    out.company = E.companyHealth(E.deptHealth(ix, ctx("12m")));
    out.queue = E.missionQueue(ix).map(q => [q.id, q.score, q.type.length > 0]);
    out.risk = E.riskByCategory(ix).slice().sort((p, q) => q.exposure - p.exposure); // sorted by name in the UI: French names sort differently
    out.anomalies = E.anomalies(ix).map(a => [a.id, a.record]);
    out.doctor = E.dataDoctor(ix);
    out.forecast = E.forecast(E.monthly(ix, { p: E.period("all", ix.ref, ix.first), dept: "" }, k => k.netRevenue));
    out.rootcause = E.decomposeRevenue(ix, ctx("12m"), { p: E.previous(ctx("12m").p), dept: "" });
    const b = E.baseline(ix); out.baseline = b;
    out.scenarios = ix.d.scenarios.map(s => E.simulate(b, E.scenarioInputs(s)));
    out.crisis = ["revenue", "cost", "churn", "supplier", "system"].map(t => E.crisis(ix, b, t, 0.2));
    const ev = E.expandEvents(ix.d.calendar_events, "2026-01-01", "2026-12-31"); out.events = ev.length; out.conflicts = E.conflicts(ev).length;
    out.snapshots = ["2025-06-30", "2026-03-31", ix.ref].map(dt => E.snapshot(ix, dt));
    const g = E.graph(ix); out.graph = [g.nodes.length, g.edges.length, g.edges.filter(e => /ynth/.test(e.basis)).length];
    return out;
}
/** Keeps numbers, booleans and identifiers; drops free text, which is supposed to change. */
function shape(v) {
    if (Array.isArray(v)) { return v.map(shape); }
    if (v && typeof v === "object") { const o = {}; Object.keys(v).sort().forEach(k => { o[k] = shape(v[k]); }); return o; }
    if (typeof v === "string") { return /^[A-Z]{1,4}\d{2,}$|^\d{4}-\d\d/.test(v) ? v : "·"; }
    return typeof v === "number" ? Math.round(v * 1e6) / 1e6 : v;
}
const a = run(en, false), b = run(fr, true);
let diff = 0;
for (const k of Object.keys(a)) {
    const x = JSON.stringify(shape(a[k])), y = JSON.stringify(shape(b[k]));
    if (x !== y) { diff++; let i = 0; while (x[i] === y[i]) { i++; } console.log(`DIFF ${k}\n   en: …${x.slice(Math.max(0, i - 60), i + 80)}\n   fr: …${y.slice(Math.max(0, i - 60), i + 80)}`); }
}
console.log(`${Object.keys(a).length} result groups compared · ${diff} difference(s) · revenue 12m: en ${a["kpis.12m"].netRevenue} / fr ${b["kpis.12m"].netRevenue} · queue ${a.queue.length}/${b.queue.length} · anomalies ${a.anomalies.length}/${b.anomalies.length}`);
fs.rmSync(tmp, { recursive: true, force: true });
process.exit(diff ? 1 : 0);
