// French number/date formats (30,90 M TND · 43,9 % · 22 nov. 2026), chart axis labels, and French keywords for the
// rule-based assistant. Exact replacements, idempotent.
"use strict";
const fs = require("fs"), path = require("path");
const mc = path.resolve(__dirname, "..", "..", "frontend", "src", "mc");
function patch(rel, pairs) {
    const p = path.join(mc, rel); let s = fs.readFileSync(p, "utf8"); let n = 0;
    for (const [a, b] of pairs) { if (s.includes(b)) { continue; } if (!s.includes(a)) { throw new Error(`${rel}: not found: ${a.slice(0, 70)}`); } s = s.replace(a, b); n++; }
    fs.writeFileSync(p, s); console.log(`${rel}: ${n}`);
}
patch("core/ui.ts", [
    ["return (a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0)) + unit;",
     "return (a >= 1e6 ? `${(v / 1e6).toFixed(2).replace(\".\", \",\")} M` : a >= 1e3 ? `${(v / 1e3).toFixed(1).replace(\".\", \",\")} k` : v.toFixed(0)) + unit;"],
    ["`${(v * 100).toFixed(d)}%`)", "`${(v * 100).toFixed(d).replace(\".\", \",\")} %`)"],
    ["`${v > 0 ? \"+\" : \"\"}${(v * 100).toFixed(d)}%`)", "`${v > 0 ? \"+\" : \"\"}${(v * 100).toFixed(d).replace(\".\", \",\")} %`)"],
    ["[\"Jan\", \"Feb\", \"Mar\", \"Apr\", \"May\", \"Jun\", \"Jul\", \"Aug\", \"Sep\", \"Oct\", \"Nov\", \"Dec\"][Number(m) - 1]", "[\"janv.\", \"févr.\", \"mars\", \"avr.\", \"mai\", \"juin\", \"juil.\", \"août\", \"sept.\", \"oct.\", \"nov.\", \"déc.\"][Number(m) - 1]"]
]);
patch("core/charts.ts", [
    ["return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v));", "return a >= 1e6 ? `${(v / 1e6).toFixed(1).replace(\".\", \",\")} M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)} k` : String(Math.round(v));"]
]);
patch("modules/intel.ts", [
    ["/change|month|compar|happen|performance/.test(l)", "/change|month|compar|happen|performance|chang|mois|évolu|variation|passé/.test(l)"],
    ["/risk|department.*(open|highest)|exposure/.test(l)", "/risk|department.*(open|highest)|exposure|risque|départements?.*(ouvert|plus)|exposition/.test(l)"],
    ["/margin/.test(l)", "/margin|marge/.test(l)"],
    ["/customer.*risk|churn|at risk|at-risk/.test(l)", "/customer.*risk|churn|at risk|at-risk|clients?.*risque|attrition|à risque/.test(l)"],
    ["/investigat|next|anomal|suspic|unusual/.test(l)", "/investigat|next|anomal|suspic|unusual|examiner|enquêt|priorit|inhabituel/.test(l)"],
    ["/collect|payment|overdue|cash/.test(l)", "/collect|payment|overdue|cash|encaiss|paiement|retard|trésorerie/.test(l)"],
    ["/revenue|sales/.test(l)", "/revenue|sales|chiffre d'affaires|\\bca\\b|ventes/.test(l)"]
]);
