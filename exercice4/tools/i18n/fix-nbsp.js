// Puts a real no-break space before % and before the M / k units in the formatters (30,90 M TND · 43,9 %).
"use strict";
const fs = require("fs"), path = require("path");
const p = path.resolve(__dirname, "..", "..", "frontend", "src", "mc", "core", "ui.ts");
const NB = " ";
let s = fs.readFileSync(p, "utf8");
s = s.split('replace(".", ",")}00a0%`').join(`replace(".", ",")}${NB}%\``);
s = s.split('replace(".", ",")} M`').join(`replace(".", ",")}${NB}M\``);
s = s.split('replace(".", ",")} k`').join(`replace(".", ",")}${NB}k\``);
fs.writeFileSync(p, s);
console.log("broken left:", (s.match(/00a0%/g) || []).length, "· no-break spaces:", (s.match(/ /g) || []).length);
