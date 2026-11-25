"use strict";

/** Data modules: Data Explorer (5), Data Doctor, Data Sources & lineage, Settings / Personalization (4) with Help & limitations. */
import type { Ctx } from "../app";
import { NAV, ROUTES } from "../app";
import { KEYS, Row, TABLES, TableName } from "../core/data";
import { dataDoctor } from "../core/engine";
import { ALL_KPIS, DEFAULT_PREFS, DEFAULT_WIDGETS } from "../core/state";
import { bar, btn, card, chip, Col, dataTable, drawer, empty, fmt, h, icon, input, newTableState, range, select, TableState, tabs } from "../core/ui";
import { KPI_DEFS } from "./inspector";

function title(el: HTMLElement, t: string, sub: string, ...extra: Array<Node | null>): void { el.appendChild(h("div", "mc-page-title", h("h1", null, t), h("span", "mc-muted", sub), h("div", "mc-row-gap mc-push", ...extra))); }

const LABEL: Partial<Record<TableName, string>> = {
    sales_orders: "Commandes", sales_order_items: "Lignes de commande", customers: "Clients", products: "Produits", suppliers: "Fournisseurs", employees: "Employés (sans salaire)",
    departments: "Départements", payments: "Paiements", expenses: "Dépenses", inventory_snapshots: "Relevés de stock", incidents: "Incidents", alerts: "Alertes",
    tasks: "Tâches", projects: "Projets", calendar_events: "Événements du calendrier", approval_requests: "Approbations", decisions: "Décisions", risk_register: "Registre des risques",
    missions: "Missions", strategic_goals: "Objectifs stratégiques", kpi_targets: "Objectifs KPI", scenarios: "Scénarios", notifications: "Notifications",
    collaboration_comments: "Commentaires", customer_interactions: "Interactions clients", investigation_cases: "Dossiers d'enquête", investigation_evidence: "Preuves",
    entity_relationships: "Relations entre entités", data_quality_issues: "Problèmes de qualité des données", data_sources: "Sources de données", activity_log: "Journal d'activité"
};
const label = (t: TableName): string => LABEL[t] ?? t;

/** Inspectable entity for a row (opens the global inspector) — used for lineage links. */
function entityOf(t: TableName, r: Row): { type: string; id: string } | null {
    const map: Partial<Record<TableName, string>> = { customers: "customer", products: "product", suppliers: "supplier", departments: "department", employees: "employee", projects: "project", tasks: "task", sales_orders: "order", alerts: "alert", incidents: "incident", risk_register: "risk" };
    const type = map[t]; return type ? { type, id: String(r[KEYS[t]]) } : null;
}
const FK: Record<string, { type: string; table: TableName }> = {
    customer_id: { type: "customer", table: "customers" }, product_id: { type: "product", table: "products" }, supplier_id: { type: "supplier", table: "suppliers" },
    department_id: { type: "department", table: "departments" }, project_id: { type: "project", table: "projects" }, order_id: { type: "order", table: "sales_orders" },
    employee_id: { type: "employee", table: "employees" }, sales_owner_id: { type: "employee", table: "employees" }, assignee_employee_id: { type: "employee", table: "employees" },
    owner_employee_id: { type: "employee", table: "employees" }, project_owner_id: { type: "employee", table: "employees" }, incident_owner_id: { type: "employee", table: "employees" },
    requester_employee_id: { type: "employee", table: "employees" }, approver_employee_id: { type: "employee", table: "employees" }, decision_owner_id: { type: "employee", table: "employees" },
    manager_id: { type: "employee", table: "employees" }, related_project_id: { type: "project", table: "projects" }, related_task_id: { type: "task", table: "tasks" }
};

function csv(cols: string[], rows: Row[]): string {
    const q = (v: unknown): string => { const s = v === null || v === undefined ? "" : String(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    return [cols.join(","), ...rows.map(r => cols.map(c => q(r[c])).join(","))].join("\r\n");
}
async function exportCsv(c: Ctx, name: string, cols: string[], rows: Row[]): Promise<void> {
    if (!c.app.exporter) { c.toast("Export indisponible.", "info"); return; }
    const ok = await c.app.exporter(`${name}.csv`, csv(cols, rows));
    c.toast(ok ? `${rows.length} lignes exportées dans ${name}.csv` : "L'export a été annulé.", ok ? "good" : "info");
    if (ok) { c.store.audit("Explorateur de données", "Exporté", `${name}.csv (${rows.length} lignes)`); }
}

// ------------------------------------------------------------------ Data Explorer (5)
export function explorer(c: Ctx, el: HTMLElement): void {
    const sel = c.m<TableName>("exTable", () => "sales_orders");
    const st = c.m<Record<string, TableState>>("exState", () => ({}));
    const gq = c.m<{ q: string }>("exGlobal", () => ({ q: "" }));
    const row = c.s.m.exRow as Row | undefined;
    title(el, "Explorateur de données", "Toutes les tables, en lecture seule. Recherchez, triez, choisissez les colonnes, paginez, inspectez une ligne et ses liens, exportez ce que vous voyez.");
    const g = h("div", "mc-grid mc-g-explorer"); el.appendChild(g);
    // table list
    const side = card("Tables", { icon: "Database", sub: `${TABLES.length} tables · salaires jamais chargés` });
    TABLES.slice().sort((a, b) => label(a).localeCompare(label(b))).forEach(t => {
        const b = h("button", { class: `mc-list-btn${t === sel ? " mc-on" : ""}`, type: "button" }, h("span", null, label(t)), h("span", "mc-muted mc-small", fmt.int(c.d[t].length)));
        b.onclick = (): void => { c.s.m.exTable = t; c.s.m.exRow = undefined; c.rerender(); }; side.body.appendChild(b);
    });
    g.appendChild(side.el);
    const main = h("div", "mc-col-stack"); g.appendChild(main);
    // global search across tables
    const gs = card("Recherche globale", { icon: "Search", sub: "Cherche dans toutes les valeurs texte de toutes les tables (8 premiers résultats par table)" });
    gs.body.appendChild(h("label", "mc-search-box", icon("Search", 14), input(gq.q, v => { gq.q = v; c.rerender(); }, "Rechercher dans toutes les tables, ex. O00004, Sfax, En retard…", "search", "ex-global")));
    if (gq.q.trim().length >= 2) {
        const q = gq.q.trim().toLowerCase(); let total = 0;
        const res = h("div", "mc-global-res");
        TABLES.forEach(t => {
            const hits = c.d[t].filter(r => Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(q)));
            if (!hits.length) { return; } total += hits.length;
            res.appendChild(h("div", "mc-global-group", h("b", null, `${label(t)} · ${hits.length}`), ...hits.slice(0, 8).map(r => { const b = h("button", { type: "button", class: "mc-link" }, String(r[KEYS[t]])); b.onclick = (): void => { c.s.m.exTable = t; c.s.m.exRow = r; c.rerender(); }; return b; })));
        });
        gs.body.appendChild(total ? res : empty(`Aucune valeur ne contient « ${gq.q} ».`, "SearchX"));
    }
    main.appendChild(gs.el);
    // table
    const rows = c.d[sel];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const ts = st[sel] ?? (st[sel] = newTableState(cols[0] ?? "", false, 14));
    const defs: Array<Col<Row>> = cols.map(k => ({ key: k, label: k, get: r => r[k], num: typeof rows[0][k] === "number" && !/_id$/.test(k), render: (r: Row): any => (FK[k] && r[k] ? (() => { const b = h("button", { type: "button", class: "mc-link" }, String(r[k])); b.onclick = (e): void => { e.stopPropagation(); c.select(FK[k].type, String(r[k])); }; return b; })() : typeof r[k] === "number" && !/_id$/.test(k) ? (Number.isInteger(r[k]) ? fmt.int(r[k]) : fmt.money2(r[k])) : r[k]) }));
    const filtered = (): Row[] => { if (!ts.q) { return rows; } const q = ts.q.toLowerCase(); return rows.filter(r => cols.some(k => String(r[k] ?? "").toLowerCase().includes(q))); };
    const tc = card(label(sel), { icon: "Table", sub: `Clé : ${KEYS[sel]} · ${cols.length} colonnes · cliquez sur une ligne pour l'inspecter, sur un identifiant bleu pour ouvrir sa fiche`, actions: [
        btn("Exporter en CSV", { small: true, icon: "Download", title: "Exporte les lignes qui correspondent à la recherche, avec les colonnes visibles", onClick: () => { void exportCsv(c, sel, cols.filter(k => !ts.hidden.includes(k)), filtered()); } })] });
    tc.body.appendChild(dataTable(defs, rows, ts, () => c.rerender(), { chooser: true, id: `ex-${sel}`, onRow: r => { c.s.m.exRow = r; c.rerender(); }, active: r => !!row && r[KEYS[sel]] === row[KEYS[sel]] && r === row }));
    main.appendChild(tc.el);
    if (row) {
        const body = h("div", "mc-col-stack");
        const ent = entityOf(sel, row);
        body.appendChild(h("div", "mc-kv", ...Object.keys(row).map(k => h("div", "mc-kv-row", h("span", "mc-muted", k), FK[k] && row[k] ? (() => { const b = h("button", { type: "button", class: "mc-link" }, `${row[k]} · ${c.ix.entityLabel(FK[k].type[0].toUpperCase() + FK[k].type.slice(1), String(row[k]))}`); b.onclick = (): void => c.select(FK[k].type, String(row[k])); return b; })() : h("b", null, row[k] === null || row[k] === "" ? "—" : String(row[k]))))));
        // lineage: where this row comes from, and what references it
        const src = c.d.data_sources.find(s => String(s.source_files ?? "").includes(sel));
        body.appendChild(h("h4", null, "Traçabilité"));
        body.appendChild(h("div", "mc-small", `CSV ${sel}.csv → php artisan mc:import (colonnes typées, traduction, clés étrangères vérifiées) → table MySQL '${sel}' → GET /api/feeds → ce tableau de bord.${src ? ` Source enregistrée : ${src.source_name} (${src.source_type}, ${src.refresh_frequency_label}).` : ""}`));
        const key = String(row[KEYS[sel]]); const fkName = Object.keys(FK).find(k => FK[k].table === sel && k === KEYS[sel]);
        if (fkName) {
            const refs = TABLES.filter(t => t !== sel && c.d[t].length && Object.prototype.hasOwnProperty.call(c.d[t][0], fkName)).map(t => ({ t, n: c.d[t].filter(r => String(r[fkName]) === key).length })).filter(x => x.n);
            body.appendChild(h("div", "mc-small", refs.length ? `Référencé par : ${refs.map(x => `${label(x.t)} (${x.n})`).join(", ")}` : "Référencé par aucune autre table."));
        }
        drawer(c.overlay, `${label(sel)} · ${key}`, body, () => { c.s.m.exRow = undefined; c.rerender(); }, { icon: "Table", width: 460, actions: ent ? [btn("Ouvrir la fiche", { small: true, icon: "Eye", onClick: () => { c.s.m.exRow = undefined; c.select(ent.type, ent.id); } })] : [] });
    }
}

// ------------------------------------------------------------------ Data Doctor
export function doctor(c: Ctx, el: HTMLElement): void {
    const r = dataDoctor(c.ix);
    const tab = c.m<string>("docTab", () => "checks");
    const reviewed = new Set(c.store.extras.reviewed);
    const issues = c.d.data_quality_issues;
    const openIssues = issues.filter(i => i.issue_status === "Ouvert" || i.issue_status === "En revue"); // same rule as the DAX measure "Open Quality Issues"
    title(el, "Docteur des données", "Contrôles automatiques des données chargées et problèmes de qualité enregistrés. Les constats sont des signaux à vérifier, pas des conclusions.", chip(`Score ${r.score}`, r.score >= 90 ? "good" : r.score >= 70 ? "warn" : "bad"));
    const top = h("div", "mc-grid mc-g-4"); el.appendChild(top);
    const st = (l: string, v: string, tone = ""): HTMLElement => h("div", `mc-stat-card ${tone}`, h("span", null, l), h("b", null, v));
    top.append(st("Score des contrôles", `${r.score} / 100`, r.score >= 90 ? "mc-tone-good" : "mc-tone-warn"), st("Contrôles en échec", String(r.checks.filter(x => x.count).length)), st("Lignes en échec", fmt.int(r.checks.reduce((a, x) => a + x.count, 0))), st("Problèmes enregistrés ouverts", `${openIssues.length} / ${issues.length}`));
    el.appendChild(h("div", "mc-hint", icon("Info", 14), `Formule du score : ${r.formula}. La mesure « Quality Score » de Power BI utilise plutôt les problèmes enregistrés : 100 × (1 − problèmes ouverts pondérés ÷ tous les problèmes pondérés).`));
    el.appendChild(tabs([{ id: "checks", label: "Contrôles automatiques", count: r.checks.length }, { id: "issues", label: "Problèmes enregistrés", count: issues.length }, { id: "tables", label: "Complétude par table" }], tab, v => { c.s.m.docTab = v; c.rerender(); }));
    if (tab === "checks") {
        const list = h("div", "mc-col-stack"); el.appendChild(list);
        r.checks.forEach(ch => {
            const done = reviewed.has(ch.id);
            const cd = card(`${ch.check}`, { icon: ch.count ? "TriangleAlert" : "CircleCheck", sub: `${ch.table} · règle : ${ch.formula}`, cls: done ? "mc-dim" : "", actions: [chip(ch.severity, ch.severity === "Critique" ? "bad" : ch.severity === "Élevée" ? "warn" : "info"), chip(`${ch.count} lignes`, ch.count ? "warn" : "good"),
                ch.count ? btn(done ? "Rouvrir" : "Marquer comme examiné", { small: true, icon: done ? "RotateCcw" : "Check", onClick: () => { c.store.toggle("reviewed", ch.id, "Docteur des données"); c.toast(done ? "Contrôle rouvert" : "Marqué comme examiné"); c.rerender(); } }) : null].filter(Boolean) as Node[] });
            if (ch.count) {
                const ex = h("div", "mc-row-gap mc-wrap", h("span", "mc-small mc-muted", "Exemples :"));
                ch.examples.forEach(id => { const b = h("button", { type: "button", class: "mc-link" }, id); const type = ch.table === "sales_orders" || ch.table === "payments" ? "order" : ch.table === "projects" ? "project" : ch.table === "tasks" ? "task" : ""; b.onclick = (): void => { if (type) { c.select(type, id); } else { c.s.m.exTable = ch.table; c.s.m.exGlobal = { q: id }; c.go("explorer"); } }; ex.appendChild(b); });
                cd.body.appendChild(ex);
            }
            list.appendChild(cd.el);
        });
        el.appendChild(h("div", "mc-small mc-muted", "« Marquer comme examiné » est enregistré sur votre compte."));
    } else if (tab === "issues") {
        const ts = c.m<TableState>("docIssues", () => newTableState("detected_date", true, 14));
        const cols: Array<Col<Row>> = [
            { key: "issue_id", label: "Problème", get: x => x.issue_id }, { key: "source_table", label: "Table", get: x => x.source_table },
            { key: "issue_type", label: "Type", get: x => x.issue_type }, { key: "severity", label: "Gravité", get: x => x.severity, render: x => chip(x.severity, x.severity === "Critique" ? "bad" : x.severity === "Élevée" ? "warn" : "info") },
            { key: "issue_status", label: "Statut", get: x => x.issue_status, render: x => chip(x.issue_status, x.issue_status === "Corrigé" ? "good" : x.issue_status === "Accepté" ? "info" : "warn") },
            { key: "detected_date", label: "Détecté", get: x => x.detected_date, render: x => fmt.date(x.detected_date) }, { key: "issue_description", label: "Description", get: x => x.issue_description }];
        el.appendChild(dataTable(cols, issues, ts, () => c.rerender(), { chooser: true, id: "doc-issues", onRow: x => { c.s.m.exTable = x.source_table; c.go("explorer"); } }));
    } else {
        const g = h("div", "mc-grid mc-g-3"); el.appendChild(g);
        TABLES.forEach(t => {
            const rows = c.d[t]; if (!rows.length) { return; }
            const cols = Object.keys(rows[0]); const cells = rows.length * cols.length;
            const blanks = cols.map(k => ({ k, n: rows.filter(r => r[k] === null || r[k] === "").length })).filter(x => x.n);
            const filled = 1 - blanks.reduce((a, x) => a + x.n, 0) / cells;
            const cd = card(label(t), { icon: "Table", sub: `${fmt.int(rows.length)} lignes · ${cols.length} colonnes` });
            cd.body.append(h("div", "mc-row-gap", h("b", null, fmt.pct(filled, 2)), h("span", "mc-small mc-muted", "cellules renseignées")), bar(filled, filled > 0.99 ? "good" : "warn"));
            if (blanks.length) { cd.body.appendChild(h("div", "mc-small mc-muted", blanks.map(x => `${x.k} : ${x.n} vides`).join(" · "))); }
            g.appendChild(cd.el);
        });
    }
}

// ------------------------------------------------------------------ Data Sources & lineage
export function sources(c: Ctx, el: HTMLElement): void {
    title(el, "Sources et traçabilité des données", `Données chargées au dernier import ; date de référence ${fmt.date(c.ix.ref)} (dernière commande). Données de démonstration synthétiques en TND.`);
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const reg = card("Sources enregistrées", { icon: "Plug", sub: "Depuis data_sources.csv · statuts tels qu'enregistrés dans le fichier, pas des vérifications en direct" });
    c.d.data_sources.forEach(s => reg.body.appendChild(h("div", "mc-ins-row", h("div", null, h("b", null, s.source_name), h("div", "mc-small mc-muted", `${s.source_type} · ${s.connection_location} · ${s.refresh_frequency_label}`), h("div", "mc-small mc-muted", `Fichiers : ${s.source_files}`)), chip(s.connection_status, String(s.connection_status).startsWith("Connecté") ? "good" : "warn"))));
    if (!c.d.data_sources.length) { reg.body.appendChild(empty("Aucune source de données.")); }
    g.appendChild(reg.el);
    const lin = card("Chaîne de traitement", { icon: "Route" });
    const steps: Array<[string, string, string]> = [["FileText", "Fichiers CSV", "Mission_Control_Enterprise/*.csv (UTF-8, 31 tables + dim_date), traduits en français à l'import"], ["Funnel", "Import", "php artisan mc:import · nettoie le texte, type chaque colonne, conserve les valeurs nulles"],
        ["Database", "Base MySQL", "32 tables, 61 relations (54 clés étrangères, 7 liens de dates indexés), table de dates dim_date"],
        ["Braces", "API des flux", "GET /api/feeds renvoie chaque table en JSON compact {c, r} ; les salaires sont exclus"], ["LayoutDashboard", "Ce tableau de bord", "Décode les flux et calcule les KPI en TypeScript (mêmes résultats que les mesures DAX de Power BI)"]];
    steps.forEach(([ic, t, d], i) => lin.body.appendChild(h("div", "mc-step", h("div", "mc-step-n", icon(ic, 15)), h("div", null, h("b", null, `${i + 1}. ${t}`), h("div", "mc-small mc-muted", d)))));
    g.appendChild(lin.el);
    const ts = c.m<TableState>("srcTables", () => newTableState("rows", true, 16));
    const rows = TABLES.map(t => ({ t, label: label(t), rows: c.d[t].length, cols: c.d[t].length ? Object.keys(c.d[t][0]).length : 0, size: c.app.feedSizes[t] ?? 0, key: KEYS[t] }));
    const tc = card("Tables chargées", { icon: "Table", sub: `${fmt.int(rows.reduce((a, r) => a + r.rows, 0))} lignes · volume des flux ${fmt.compact(rows.reduce((a, r) => a + r.size, 0), " lignes")}` });
    tc.body.appendChild(dataTable<typeof rows[number]>([
        { key: "label", label: "Table", get: r => r.label }, { key: "rows", label: "Lignes", get: r => r.rows, num: true, render: r => fmt.int(r.rows) },
        { key: "cols", label: "Colonnes", get: r => r.cols, num: true }, { key: "key", label: "Clé", get: r => r.key }, { key: "size", label: "Taille du flux", get: r => r.size, num: true, render: r => (r.size ? fmt.compact(r.size, " l.") : "—") }],
    rows, ts, () => c.rerender(), { search: true, id: "src", onRow: r => { c.s.m.exTable = r.t; c.go("explorer"); } }));
    el.appendChild(tc.el);
}

// ------------------------------------------------------------------ Settings / Personalization (4) + Help
export function settings(c: Ctx, el: HTMLElement): void {
    const p = c.store.prefs;
    const save = (msg = "Préférence enregistrée sur votre compte"): void => { c.store.savePrefs(); c.toast(msg); c.rerender(); };
    const tab = c.m<string>("setTab", () => "look");
    title(el, "Paramètres et aide", "Les préférences sont enregistrées sur votre compte ; les modifications de données sont écrites dans la base.");
    el.appendChild(tabs([{ id: "look", label: "Apparence", icon: "Palette" }, { id: "layout", label: "Disposition et KPI", icon: "LayoutGrid" }, { id: "data", label: "Modifications et stockage", icon: "Save" }, { id: "integrations", label: "Intégrations", icon: "Plug" }, { id: "help", label: "Aide et limites", icon: "CircleQuestionMark" }], tab, v => { c.s.m.setTab = v; c.rerender(); }));
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    if (tab === "look") {
        const a = card("Thème", { icon: "Palette" });
        const seg = (opts: Array<[string, string]>, cur: string, on: (v: string) => void): HTMLElement => h("div", "mc-seg", ...opts.map(([v, l]) => { const b = h("button", { type: "button", class: `mc-seg-btn${cur === v ? " mc-on" : ""}`, "aria-pressed": cur === v ? "true" : "false" }, l); b.onclick = (): void => on(v); return b; }));
        a.body.append(h("div", "mc-field-label", "Mode"), seg([["dark", "Sombre"], ["light", "Clair"]], p.theme, v => { p.theme = v as any; save(); }),
            h("div", "mc-field-label", "Accent"), h("div", "mc-row-gap", ...(["gold", "teal", "blue", "violet"] as const).map(x => { const b = h("button", { type: "button", class: `mc-swatch mc-sw-${x}${p.accent === x ? " mc-on" : ""}`, "aria-label": `accent ${x}`, title: x }); b.onclick = (): void => { p.accent = x; save(); }; return b; })),
            h("div", "mc-field-label", "Densité"), seg([["comfortable", "Confortable"], ["compact", "Compacte"]], p.density, v => { p.density = v as any; save(); }),
            range(p.fontScale, 0.85, 1.25, 0.05, v => { p.fontScale = v; }, "Taille du texte", v => `${Math.round(v * 100)}%`), btn("Appliquer la taille du texte", { small: true, onClick: () => save() }),
            h("div", "mc-field-label", "Animations"), seg([["auto", "Fluides (suivent le réglage du système)"], ["reduced", "Réduites"]], p.motion, v => { p.motion = v as any; save(); }),
            h("div", "mc-small mc-muted", "Les animations réduites désactivent les compteurs animés, les transitions de page, les flux animés et les pulsations. Elles s'appliquent aussi automatiquement si le système le demande."));
        g.appendChild(a.el);
        const b = card("Navigation", { icon: "PanelLeft" });
        b.body.append(select(ROUTES.map(r => ({ value: r.id, label: `${r.group} › ${r.label}` })), p.landing, v => { p.landing = v; save("Page d'accueil enregistrée"); }, "Page d'accueil après connexion"),
            h("div", "mc-field-label", "Barre latérale"), seg([["expanded", "Dépliée"], ["collapsed", "Icônes seules"]], p.sidebar, v => { p.sidebar = v as any; save(); }));
        g.appendChild(b.el);
    } else if (tab === "layout") {
        const a = card("KPI du centre de commande", { icon: "Gauge", sub: "Choisissez jusqu'à 6 cartes KPI" });
        ALL_KPIS.forEach(k => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = p.kpis.includes(k); cb.onchange = (): void => { p.kpis = cb.checked ? Array.from(new Set(p.kpis.concat(k))).slice(0, 6) : p.kpis.filter(x => x !== k); save(); }; a.body.appendChild(h("label", "mc-check", cb, KPI_DEFS[k]?.label ?? k)); });
        g.appendChild(a.el);
        const b = card("Widgets du tableau de bord", { icon: "LayoutGrid", sub: "Réorganisez, redimensionnez et retirez les widgets avec « Personnaliser » dans le centre de commande" });
        b.body.appendChild(h("div", "mc-small", `${p.widgets.length} widgets : ${p.widgets.map(w => `${w.id} (${w.size.toUpperCase()})`).join(", ")}`));
        b.body.appendChild(h("div", "mc-row-gap", btn("Ouvrir le centre de commande", { small: true, icon: "LayoutDashboard", onClick: () => c.go("command") }), btn("Réinitialiser la disposition", { small: true, icon: "RotateCcw", onClick: () => { p.widgets = DEFAULT_WIDGETS.map(w => ({ ...w })); save("Disposition réinitialisée"); } })));
        g.appendChild(b.el);
        const w = card("Liste de suivi (terminal financier)", { icon: "Star" });
        ALL_KPIS.forEach(k => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = p.watchlist.includes(k); cb.onchange = (): void => { p.watchlist = cb.checked ? Array.from(new Set(p.watchlist.concat(k))) : p.watchlist.filter(x => x !== k); save(); }; w.body.appendChild(h("label", "mc-check", cb, KPI_DEFS[k]?.label ?? k)); });
        g.appendChild(w.el);
        const r = card("Tout réinitialiser", { icon: "RotateCcw" });
        r.body.append(h("div", "mc-small mc-muted", `Scénarios enregistrés : ${p.scenarios.length}. La réinitialisation rétablit le thème, la disposition, les KPI et la liste de suivi par défaut ; les données ne sont pas modifiées.`), btn("Réinitialiser toutes les préférences", { kind: "danger", small: true, onClick: () => { const keep = p.persistEdits; Object.assign(p, JSON.parse(JSON.stringify(DEFAULT_PREFS)), { persistEdits: keep }); save("Préférences réinitialisées"); } }));
        g.appendChild(r.el);
    } else if (tab === "data") {
        const a = card("Où vont vos modifications", { icon: "Save" });
        a.body.append(h("div", "mc-small", "Les tâches, événements, approbations, décisions, commentaires, états des notifications et statuts des dossiers sont écrits dans MySQL via l'API Laravel dès que vous les enregistrez. Chaque modification est aussi consignée dans activity_log avec votre nom."),
            h("div", "mc-hint", icon("Info", 14), "Les clés étrangères sont appliquées : une modification qui pointe vers un projet, un employé ou un département inexistant est refusée et annulée à l'écran."),
            h("div", "mc-row-gap", chip(`${c.store.editCount()} modifications dans cette session`, "info")));
        g.appendChild(a.el);
        const b = card("Classement du stockage", { icon: "Layers" });
        const t = h("table", "mc-table", h("thead", null, h("tr", null, h("th", null, "Quoi"), h("th", null, "Où"), h("th", null, "Conservé après déconnexion"))));
        const tb = h("tbody"); t.appendChild(tb);
        ([["Thème, accent, densité, texte, animations, barre latérale, page d'accueil, cartes KPI, disposition des widgets, liste de suivi, scénarios enregistrés", "Votre compte (users.preferences)", "Oui"],
            ["Tâches, événements, approbations, décisions, commentaires, statut des dossiers, état de lecture des notifications", "Tables MySQL", "Oui, pour tous les utilisateurs"],
            ["Anomalies prises en compte, contrôles de données examinés", "Votre compte (users.workspace)", "Oui"],
            ["Page affichée, filtres, période, panneaux ouverts, recherche, curseurs du simulateur, modifications du bac à sable, position de la machine à remonter le temps", "Mémoire", "Non"]] as Array<[string, string, string]>).forEach(r => tb.appendChild(h("tr", null, ...r.map(x => h("td", null, x)))));
        b.body.appendChild(h("div", "mc-table-scroll", t));
        g.appendChild(b.el);
    } else if (tab === "integrations") {
        const a = card("Fournisseur de l'assistant IA", { icon: "Bot", sub: "Désactivé — mode démo" });
        const key = h("input", { class: "mc-input", type: "password", value: "sk-demo-0000-PLACEHOLDER-NOT-A-REAL-KEY", disabled: true, "aria-label": "Clé API (exemple factice)" }) as HTMLInputElement;
        a.body.append(formGrid2([["Fournisseur", h("span", null, "Assistant local à base de règles (actif)")], ["LLM externe", chip("Non connecté", "warn")], ["Clé API", key]]),
            h("div", "mc-hint", icon("Lock", 14), "Le champ affiche une clé factice et il est désactivé. Une vraie clé serait uniquement stockée côté Laravel (.env, jamais dans le navigateur) ; l'interface de l'assistant (AssistantAdapter) est prête pour cet adaptateur."));
        g.appendChild(a.el);
        const b = card("Autres intégrations", { icon: "Plug" });
        [["Notifications par e-mail", "Désactivé — utiliserait Laravel Mail"], ["Actualisation des données", "php artisan mc:import recharge les CSV"], ["Fonds de carte", "Non utilisés — la carte schématique évite les appels externes"]].forEach(([n, s2]) => b.body.appendChild(h("div", "mc-ins-row", h("b", null, n), chip(s2, "muted"))));
        g.appendChild(b.el);
    } else {
        const a = card("Raccourcis clavier", { icon: "Keyboard" });
        [["Ctrl + K", "Ouvrir la palette de commandes"], ["↑ ↓ Entrée", "Naviguer et ouvrir dans la palette"], ["Échap", "Fermer la palette, le panneau ou l'inspecteur"], ["Tab / Maj+Tab", "Passer d'un contrôle à l'autre"], ["Enter", "Ouvrir la ligne, le nœud ou la carte sélectionnés"], ["← →", "Diapositive précédente / suivante (récit) · déplacer une tâche sélectionnée (Kanban)"]].forEach(([k, d]) => a.body.appendChild(h("div", "mc-ins-row", h("kbd", null, k), h("span", null, d))));
        g.appendChild(a.el);
        const b = card("Limites", { icon: "Info" });
        ["Données synthétiques, devise TND ; la date de référence est celle de la dernière commande, pas aujourd'hui.", "L'assistant IA fonctionne par règles : il répond à partir d'indicateurs calculés et cite ses sources ; il ne génère pas de texte libre.",
            "La carte est un schéma des régions présentes dans les données, pas une projection géographique.", "Les prévisions sont des références statistiques (moyenne mobile, tendance linéaire, naïf saisonnier) avec erreur de backtest, pas des prédictions de l'avenir.",
            "La collaboration n'est pas en temps réel : les autres utilisateurs voient vos modifications après rechargement."]
            .forEach(t => b.body.appendChild(h("div", "mc-li", icon("ChevronRight", 12), t)));
        g.appendChild(b.el);
        const n = card("Plan des modules", { icon: "Map" });
        NAV.forEach(gr => n.body.appendChild(h("div", "mc-ins-row", h("b", null, gr.group), h("span", "mc-small", gr.items.map(i => `${i.label}${i.feature ? ` (#${i.feature})` : ""}`).join(" · ")))));
        g.appendChild(n.el);
    }
}
function formGrid2(rows: Array<[string, Node]>): HTMLElement { return h("div", "mc-kv", ...rows.map(([l, n]) => h("div", "mc-kv-row", h("span", "mc-muted", l), n))); }
