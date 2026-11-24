// Builds the same columnar JSON feeds as the "Feed <table>" DAX measures, but straight from the CSV files,
// so the visual can be previewed/tested without Power BI Desktop. Types come from tools/schema.txt
// (S text, D date, T datetime, I/N/C/P numbers, B boolean) and the same columns are dropped (salary never sent).
// Usage: node csv-feeds.js <out.js>   -> writes  window.FEEDS = { table: "<json string>", ... }
"use strict";
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "Mission_Control_Enterprise");
const DROP = { employees: ["monthly_salary_tnd"], sales_order_items: ["order_line_id"], payments: ["customer_id"], inventory_snapshots: ["inventory_snapshot_id"], kpi_targets: ["target_id"], calendar_events: ["data_origin"], expenses: ["reference_code"] };
const feeds = JSON.parse(fs.readFileSync(path.join(__dirname, "feeds.json"), "utf8").replace(/^﻿/, ""));
const schema = {};
fs.readFileSync(path.join(__dirname, "schema.txt"), "utf8").split(/\r?\n/).forEach(l => {
    const [t, ...cols] = l.trim().split(/\s+/); if (!t) { return; }
    schema[t] = cols.map(c => { const i = c.lastIndexOf(":"); return [c.slice(0, i), c.slice(i + 1)]; });
});

function parseCsv(text) {
    const rows = []; let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else { q = false; } } else { cell += ch; } continue; }
        if (ch === '"') { q = true; } else if (ch === ",") { row.push(cell); cell = ""; } else if (ch === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; } else { cell += ch; }
    }
    if (cell || row.length) { row.push(cell.replace(/\r$/, "")); rows.push(row); }
    return rows.filter(r => r.length > 1 || r[0]);
}
function value(v, t) {
    const s = (v ?? "").trim().replace(/\s+/g, " ");
    if (t === "B") { return /^(true|1|yes)$/i.test(s); }
    if (s === "") { return null; }
    switch (t) {
        case "S": return s;
        case "D": return s.slice(0, 10);
        case "T": return s.replace("T", " ").slice(0, 16);
        default: { const n = Number(s); return isNaN(n) ? null : Math.round(n * 10000) / 10000; }
    }
}
const out = {};
feeds.forEach(t => {
    const rows = parseCsv(fs.readFileSync(path.join(dataDir, `${t}.csv`), "utf8").replace(/^﻿/, ""));
    const head = rows[0].map(h => h.trim());
    const types = Object.fromEntries(schema[t] ?? []);
    const cols = (schema[t] ?? head.map(h => [h, "S"])).map(([c]) => c).filter(c => head.includes(c) && !(DROP[t] ?? []).includes(c));
    const idx = cols.map(c => head.indexOf(c));
    out[t] = JSON.stringify({ c: cols, r: rows.slice(1).map(r => idx.map((i, k) => value(r[i], types[cols[k]]))) });
});
const target = process.argv[2];
if (target) { fs.writeFileSync(target, "window.FEEDS = " + JSON.stringify(out) + ";\n"); }
console.log(`${feeds.length} feeds, ${Object.values(out).reduce((a, s) => a + s.length, 0)} chars`);
module.exports = out;
