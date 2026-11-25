// One-off: translates the Data Explorer / Data Doctor block of datamods.ts that the literal tokenizer cannot read
// (a regex literal /[",\n\r]/ confuses it). Exact replacements; fails if a source string is missing. Idempotent.
"use strict";
const fs = require("fs"), path = require("path");
const p = path.resolve(__dirname, "..", "..", "frontend", "src", "mc", "modules", "datamods.ts");
let s = fs.readFileSync(p, "utf8");
const pairs = [
    ['c.toast("Export is not available.", "info")', 'c.toast("Export indisponible.", "info")'],
    ['`Exported ${rows.length} rows to ${name}.csv` : "The export was cancelled."', '`${rows.length} lignes exportées dans ${name}.csv` : "L\'export a été annulé."'],
    ['c.store.audit("Data Explorer", "Exported", `${name}.csv (${rows.length} rows)`)', 'c.store.audit("Explorateur de données", "Exporté", `${name}.csv (${rows.length} lignes)`)'],
    ['title(el, "Data Explorer", "Every table of the model, read-only. Search, sort, choose columns, paginate, inspect a row with its links, export what you see.")', 'title(el, "Explorateur de données", "Toutes les tables, en lecture seule. Recherchez, triez, choisissez les colonnes, paginez, inspectez une ligne et ses liens, exportez ce que vous voyez.")'],
    ['card("Tables", { icon: "Database", sub: `${TABLES.length} tables · salary never loaded` })', 'card("Tables", { icon: "Database", sub: `${TABLES.length} tables · salaires jamais chargés` })'],
    ['card("Global search", { icon: "Search", sub: "Searches every text value of every table (first 8 hits per table)" })', 'card("Recherche globale", { icon: "Search", sub: "Cherche dans toutes les valeurs texte de toutes les tables (8 premiers résultats par table)" })'],
    ['"Search all tables, e.g. O00004, Sfax, Overdue…"', '"Rechercher dans toutes les tables, ex. O00004, Sfax, En retard…"'],
    ['empty(`No value contains “${gq.q}”.`, "SearchX")', 'empty(`Aucune valeur ne contient « ${gq.q} ».`, "SearchX")'],
    ['sub: `Key: ${KEYS[sel]} · ${cols.length} columns · click a row to inspect, a blue id to open its record`', 'sub: `Clé : ${KEYS[sel]} · ${cols.length} colonnes · cliquez sur une ligne pour l\'inspecter, sur un identifiant bleu pour ouvrir sa fiche`'],
    ['btn("Export CSV", { small: true, icon: "Download", title: "Exports the rows that match the search, with visible columns"', 'btn("Exporter en CSV", { small: true, icon: "Download", title: "Exporte les lignes qui correspondent à la recherche, avec les colonnes visibles"'],
    ['h("h4", null, "Lineage")', 'h("h4", null, "Traçabilité")'],
    ["`CSV ${sel}.csv → php artisan mc:import (typed columns, foreign keys checked) → MySQL table '${sel}' → GET /api/feeds → this dashboard.", "`CSV ${sel}.csv → php artisan mc:import (colonnes typées, traduction, clés étrangères vérifiées) → table MySQL '${sel}' → GET /api/feeds → ce tableau de bord."],
    ['`Referenced by: ${refs.map(x => `${label(x.t)} (${x.n})`).join(", ")}` : "Not referenced by other tables."', '`Référencé par : ${refs.map(x => `${label(x.t)} (${x.n})`).join(", ")}` : "Référencé par aucune autre table."'],
    ['btn("Open inspector", { small: true, icon: "Eye"', 'btn("Ouvrir la fiche", { small: true, icon: "Eye"'],
    ['i.issue_status === "Open" || i.issue_status === "Under Review"); // same rule as the DAX measure "Open Quality Issues"', 'i.issue_status === "Ouvert" || i.issue_status === "En revue"); // same rule as the DAX measure "Open Quality Issues"'],
    ['title(el, "Data Doctor", "Automated checks on the loaded data plus the registered data-quality issues. Findings are signals that require review, not conclusions."', 'title(el, "Docteur des données", "Contrôles automatiques des données chargées et problèmes de qualité enregistrés. Les constats sont des signaux à vérifier, pas des conclusions."'],
    ['st("Check score", ', 'st("Score des contrôles", '],
    ['st("Failing checks", ', 'st("Contrôles en échec", '],
    ['st("Failing rows", ', 'st("Lignes en échec", '],
    ['st("Open registered issues", ', 'st("Problèmes enregistrés ouverts", '],
    ['`Score formula: ${r.formula}. The model\'s "Data Quality Score" measure uses the registered issues instead: 100 × (1 − weighted open issues ÷ weighted all issues).`', '`Formule du score : ${r.formula}. La mesure « Quality Score » de Power BI utilise plutôt les problèmes enregistrés : 100 × (1 − problèmes ouverts pondérés ÷ tous les problèmes pondérés).`']
];
let n = 0;
for (const [a, b] of pairs) { if (s.includes(b)) { continue; } if (!s.includes(a)) { throw new Error("not found: " + a.slice(0, 70)); } s = s.replace(a, b); n++; }
fs.writeFileSync(p, s); console.log(`datamods.ts: ${n} replacements`);
