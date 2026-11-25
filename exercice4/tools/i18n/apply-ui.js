// Translates the interface: replaces every string/template literal whose exact text is a key of tools/i18n/ui.fr.*.json
// with its French value (expressions inside ${…} are part of the key, so they are preserved exactly).
// Usage: node tools/i18n/apply-ui.js   (idempotent)
"use strict";
const fs = require("fs"), path = require("path");
const { literals, files } = require("./extract.js");
const dict = {};
for (const f of fs.readdirSync(__dirname).filter(x => /^ui\.fr\.\d+\.json$/.test(x)).sort()) { Object.assign(dict, JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"))); }
let total = 0;
for (const file of files) {
    let s = fs.readFileSync(file, "utf8"); let n = 0;
    for (const l of literals(s).sort((a, b) => b.start - a.start)) {
        if (!Object.prototype.hasOwnProperty.call(dict, l.text) || dict[l.text] === l.text) { continue; }
        let fr = dict[l.text];
        if (l.q === '"') { fr = fr.replace(/(^|[^\\])"/g, '$1\\"'); }
        if (l.q === "'") { fr = fr.replace(/(^|[^\\])'/g, "$1\\'"); }
        s = s.slice(0, l.start + 1) + fr + s.slice(l.end - 1); n++;
    }
    if (n) { fs.writeFileSync(file, s); total += n; console.log(`${path.basename(file)}: ${n}`); }
}
fs.writeFileSync(path.join(__dirname, "ui.fr.json"), JSON.stringify(dict, null, 1));
console.log(`${total} strings translated (${Object.keys(dict).length} dictionary entries)`);
