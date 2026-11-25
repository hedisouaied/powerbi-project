// Lists the English UI strings still in the frontend (after the data values were translated), without icon names,
// CSS classes and technical strings. Writes tools/i18n/ui-todo.txt, one JSON-encoded literal per line.
"use strict";
const fs = require("fs"), path = require("path");
const { literals, files } = require("./extract.js");
const ui = fs.readFileSync(path.resolve(__dirname, "..", "..", "frontend", "src", "mc", "core", "ui.ts"), "utf8");
const icons = new Set((ui.match(/const ICONS[\s\S]*?\};/)[0].match(/[A-Z][A-Za-z0-9]+/g)));
["SearchX", "Braces", "LogOut", "Cuboid", "Rotate3d", "ChartGantt", "SquareKanban"].forEach(i => icons.add(i));
const done = fs.existsSync(path.join(__dirname, "ui.fr.json")) ? JSON.parse(fs.readFileSync(path.join(__dirname, "ui.fr.json"), "utf8")) : {};
const tech = [/^mc-|\smc-|^auth-|var\(--|px\b|translate\(|rotate|scale\(|^\/|^https?:|^[a-z]+\/[a-z+.-]+|^data:|charset|application\//, /^[#.@]/];
function isEnglishUi(t) {
    if (!/[A-Za-z]{2}/.test(t)) { return false; }
    if (icons.has(t)) { return false; }
    if (tech.some(re => re.test(t))) { return false; }
    if (/[À-ÿŒœ]/.test(t)) { return false; }                       // already French
    if (/^[a-z0-9_.\-:]+$/.test(t)) { return false; }               // keys, events, classes
    if (/^[A-Z][A-Za-z0-9]+$/.test(t) && /[a-z][A-Z]/.test(t)) { return false; } // PascalCase identifiers
    if (/^\$\{[^}]+\}$/.test(t.trim())) { return false; }
    const plain = t.replace(/\$\{[^}]*\}/g, "");                    // text outside ${…}
    return /[A-Za-z]{2}/.test(plain);
}
const seen = new Map();
for (const f of files) { const s = fs.readFileSync(f, "utf8"); for (const l of literals(s)) { if (isEnglishUi(l.text) && !(l.text in done)) { seen.set(l.text, (seen.get(l.text) || 0) + 1); } } }
const lines = [...seen.keys()].map(k => JSON.stringify(k));
fs.writeFileSync(path.join(__dirname, "ui-todo.txt"), lines.join("\n") + "\n");
console.log(`${lines.length} strings to translate, ${lines.join("").length} chars → tools/i18n/ui-todo.txt`);
module.exports = { isEnglishUi };
