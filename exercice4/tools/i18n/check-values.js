// Checks backend/database/data/translations_fr.json against the CSV data:
//  - every text value of every translated column gets a French value (or is the same word in French),
//  - no column maps two different English values to the same French value (the dashboard compares them).
"use strict";
const path = require("path");
const ex3tools = path.resolve(__dirname, "..", "..", "..", "exercice3", "tools");
const feeds = require(path.join(ex3tools, "csv-feeds.js"));
const tr = require(path.resolve(__dirname, "..", "..", "backend", "database", "data", "translations_fr.json"));
const SAME = new Set(["Marketing", "Finance", "Budget", "KPI", "Mention", "Question", "Chat", "CSV", "Info", "Maintenance", "Innovation", "Incident", "Commercial", "Direct", "Services", "France", "15 minutes"]);
const keep = new Set(tr.keep);
const patterns = tr.patterns.map(([re, rep]) => [new RegExp(re), rep]);
function translate(v) {
    if (typeof v !== "string") { return v; }
    if (Object.prototype.hasOwnProperty.call(tr.values, v)) { return tr.values[v]; }
    for (const [re, rep] of patterns) { if (re.test(v)) { return v.replace(re, rep); } }
    return v;
}
module.exports = { translate };
if (require.main === module) {
    let missing = 0, collisions = 0;
    for (const t of Object.keys(feeds)) {
        const f = JSON.parse(feeds[t]);
        f.c.forEach((c, i) => {
            if (/_id$/.test(c) || keep.has(`${t}.${c}`)) { return; }
            const vals = [...new Set(f.r.map(r => r[i]).filter(v => typeof v === "string" && !/^\d{4}-\d\d-\d\d/.test(v)))];
            if (!vals.length) { return; }
            const out = new Map();
            vals.forEach(v => {
                const fr = translate(v);
                if (fr === v && !SAME.has(v) && !/^O\d+|^REF-|^Maintenance \d+$/.test(v)) { missing++; if (missing <= 40) { console.log(`untranslated  ${t}.${c}: ${v}`); } }
                if (out.has(fr) && out.get(fr) !== v) { collisions++; console.log(`COLLISION     ${t}.${c}: "${out.get(fr)}" and "${v}" -> "${fr}"`); }
                out.set(fr, v);
            });
        });
    }
    console.log(`${missing} untranslated value(s), ${collisions} collision(s)`);
    process.exit(missing || collisions ? 1 : 0);
}
