// Lists the user-facing English strings in the frontend (string and template literals), for translation.
// Usage: node tools/i18n/extract.js [out.json]   -> { "<literal source text>": count }
"use strict";
const fs = require("fs"), path = require("path");
const src = path.resolve(__dirname, "..", "..", "frontend", "src");
const files = [];
(function walk(d) { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) { walk(p); } else if (/\.(ts|tsx)$/.test(f)) { files.push(p); } } })(src);

/** Tokenizes string/template literals (handles escapes and nested ${...} in templates). */
function literals(s) {
    const out = [];
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (ch === "/" && s[i + 1] === "/") { while (i < s.length && s[i] !== "\n") { i++; } continue; }
        if (ch === "/" && s[i + 1] === "*") { i = s.indexOf("*/", i + 2) + 1; continue; }
        if (ch === '"' || ch === "'") {
            let j = i + 1; while (j < s.length && s[j] !== ch && s[j] !== "\n") { if (s[j] === "\\") { j++; } j++; }
            out.push({ q: ch, start: i, end: j + 1, text: s.slice(i + 1, j) }); i = j; continue;
        }
        if (ch === "`") {
            let j = i + 1, depth = 0;
            while (j < s.length) { if (s[j] === "\\") { j += 2; continue; } if (depth === 0 && s[j] === "`") { break; } if (s[j] === "$" && s[j + 1] === "{") { depth++; j += 2; continue; } if (depth > 0 && s[j] === "}") { depth--; } j++; }
            out.push({ q: "`", start: i, end: j + 1, text: s.slice(i + 1, j) }); i = j; continue;
        }
    }
    return out;
}
function isUi(t) {
    if (!/[A-Za-z]{2}/.test(t)) { return false; }
    if (/^mc-|^[a-z0-9_.\-\/:#]+$|^[A-Z][A-Za-z0-9]+$|^https?:/.test(t)) { return /^[A-Z][a-z]+$/.test(t); }
    return true;
}
module.exports = { literals, isUi, files };
if (require.main === module) {
    const map = {};
    for (const f of files) { const s = fs.readFileSync(f, "utf8"); for (const l of literals(s)) { if (isUi(l.text)) { map[l.text] = (map[l.text] || 0) + 1; } } }
    const out = process.argv[2]; if (out) { fs.writeFileSync(out, JSON.stringify(map, null, 1)); }
    console.log(Object.keys(map).length, "strings,", Object.keys(map).join("").length, "chars");
}
