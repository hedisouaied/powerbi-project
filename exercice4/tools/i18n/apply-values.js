// Replaces the English data values used by the dashboard code (statuses, priorities, types… in comparisons, sets,
// maps and labels) with their French translation, so the code matches the French data in MySQL.
// Icon names are left alone (icon("Calendar") is an icon, "Calendar" in data is a notification category).
// Usage: node tools/i18n/apply-values.js   (idempotent: French values are not touched again)
"use strict";
const fs = require("fs"), path = require("path");
const { literals } = require("./extract.js");
const tr = require(path.resolve(__dirname, "..", "..", "backend", "database", "data", "translations_fr.json"));
const dir = path.resolve(__dirname, "..", "..", "frontend", "src", "mc");
const values = Object.fromEntries(Object.entries(tr.values).filter(([en, fr]) => en !== fr));
// English words that are also UI verbs/labels with another meaning in the code
const SPECIAL = [[/btn\(\s*$/, "Open", "Ouvrir"], [/\|\|\s*$/, "Open", "Ouvrir"]];
const ICON_CONTEXT = /(icon|iconBtn)\(\s*$|icon:\s*$|ICONS\[\s*$/;

let total = 0;
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { walk(p); } else if (f.endsWith(".ts")) { files.push(p); } } })(dir);
for (const file of files) {
    let s = fs.readFileSync(file, "utf8"); let n = 0;
    // 1. quoted literals equal to a data value
    const lits = literals(s).filter(l => l.q !== "`" && Object.prototype.hasOwnProperty.call(values, l.text));
    for (const l of lits.sort((a, b) => b.start - a.start)) {
        const before = s.slice(Math.max(0, l.start - 12), l.start);
        if (ICON_CONTEXT.test(before)) { continue; }
        const special = SPECIAL.find(([re, en]) => en === l.text && re.test(before));
        const fr = special ? special[2] : values[l.text];
        s = s.slice(0, l.start) + l.q + fr + l.q + s.slice(l.end); n++;
    }
    // 1b. quoted data values inside ${…} expressions of template literals (`${x.status === "Critical" ? …}`)
    for (const l of literals(s).filter(x => x.q === "`").sort((a, b) => b.start - a.start)) {
        const inner = l.text.replace(/(\$\{[^}]*?)"([^"\n]+)"/g, (m, pre, v) => {
            if (!Object.prototype.hasOwnProperty.call(values, v) || ICON_CONTEXT.test(pre.slice(-12))) { return m; }
            n++; return `${pre}"${values[v]}"`;
        });
        if (inner !== l.text) { s = s.slice(0, l.start + 1) + inner + s.slice(l.end - 1); }
    }
    // 2. unquoted object keys equal to a one-word data value ({ Critical: 1, Customer: "accent" })
    s = s.replace(/([{,]\s*)([A-Z][A-Za-z]+):(?=\s)/g, (m, pre, key) => {
        if (!Object.prototype.hasOwnProperty.call(values, key)) { return m; }
        n++; return `${pre}"${values[key]}":`;
    });
    if (n) { fs.writeFileSync(file, s); console.log(`${path.relative(dir, file)}: ${n}`); total += n; }
}
console.log(`${total} replacements`);
