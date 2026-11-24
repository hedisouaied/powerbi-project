// Regenerates the measure catalogue table in docs/02_model_and_measures.md from dax/measures.dax
// (between the "<!-- measures:start -->" and "<!-- measures:end -->" markers).  Usage: node tools/gen-measure-doc.js
"use strict";
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..");
const dax = fs.readFileSync(path.join(root, "dax", "measures.dax"), "utf8").replace(/\r/g, "");
const rows = [];
const re = /^-- measure: (.+?) \| (.+?) \| (.+)\n((?:-- .*\n)*)/gm;
let m;
while ((m = re.exec(dax))) {
    const desc = m[4].split("\n").map(l => l.replace(/^-- ?/, "").trim()).filter(Boolean).join(" ");
    rows.push(`| ${m[3].trim()} | **${m[1].trim()}** | \`${m[2].trim().replace(/\|/g, "\\|")}\` | ${desc.replace(/\|/g, "\\|")} |`);
}
const table = ["| Folder | Measure | Format | Meaning |", "|---|---|---|---|", ...rows].join("\n");
const doc = path.join(root, "docs", "02_model_and_measures.md");
const text = fs.readFileSync(doc, "utf8");
const out = text.replace(/<!-- measures:start -->[\s\S]*<!-- measures:end -->/, `<!-- measures:start -->\n${table}\n<!-- measures:end -->`);
fs.writeFileSync(doc, out);
console.log(`${rows.length} measures written to docs/02_model_and_measures.md`);
