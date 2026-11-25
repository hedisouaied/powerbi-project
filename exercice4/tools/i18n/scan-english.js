// Final check: lists literals (and raw source lines around regex-confused areas) that still contain common English
// words, ignoring identifiers, CSS and column names. Usage: node tools/i18n/scan-english.js
"use strict";
const fs = require("fs"), path = require("path");
const { files } = require("./extract.js");
const EN = /\b(the|and|of|is|are|with|without|for|from|into|than|this|that|these|your|you|no|not|only|per|rows?|items?|events?|orders?|customers?|tasks?|open|closed|days?|months?|weeks?|year|average|weights?|revenue|margin|cost|profit|impact|risk|score|status|change|selected|click|drag|show|shown|view|save|saved|loading|search|select|filter|history|demo|session|data|period|previous|next|total|value|values|amount)\b/i;
const IGNORE = /^(mc-|--mc|https?:|[a-z_]+\s*[<>=]|[a-z_]+ (not in|<|>)|rgba|#)/;
let n = 0;
for (const f of files) {
    const lines = fs.readFileSync(f, "utf8").split("\n");
    lines.forEach((line, i) => {
        const strings = line.match(/"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
        for (const raw of strings) {
            const t = raw.slice(1, -1).replace(/\$\{[^}]*\}/g, " ");
            if (t.length < 4 || IGNORE.test(t) || /^[a-z0-9_.\-\/:]+$/i.test(t.trim()) || /[A-Za-z]+_[a-z_]+/.test(t) && !/ [a-z]+ [a-z]+ [a-z]+/i.test(t.replace(/[A-Za-z]+_[a-z_]+/g, ""))) { continue; }
            if (EN.test(t) && !/[àâçéèêëîïôûùüÿœ]/i.test(t)) { n++; console.log(`${path.basename(f)}:${i + 1}  ${raw.slice(0, 150)}`); }
        }
    });
}
console.log(`${n} literal(s) still look English`);
