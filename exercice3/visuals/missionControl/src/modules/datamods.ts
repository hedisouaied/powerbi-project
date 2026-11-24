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
    sales_orders: "Sales orders", sales_order_items: "Order lines", customers: "Customers", products: "Products", suppliers: "Suppliers", employees: "Employees (no salary)",
    departments: "Departments", payments: "Payments", expenses: "Expenses", inventory_snapshots: "Inventory snapshots", incidents: "Incidents", alerts: "Alerts",
    tasks: "Tasks", projects: "Projects", calendar_events: "Calendar events", approval_requests: "Approvals", decisions: "Decisions", risk_register: "Risk register",
    missions: "Missions", strategic_goals: "Strategic goals", kpi_targets: "KPI targets", scenarios: "Scenarios", notifications: "Notifications",
    collaboration_comments: "Comments", customer_interactions: "Customer interactions", investigation_cases: "Investigation cases", investigation_evidence: "Evidence",
    entity_relationships: "Entity relationships", data_quality_issues: "Data quality issues", data_sources: "Data sources", activity_log: "Activity log"
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
    if (!c.app.exporter) { c.toast("Export is not allowed by this Power BI host (admin setting or the service's export policy).", "info"); return; }
    const ok = await c.app.exporter(`${name}.csv`, csv(cols, rows));
    c.toast(ok ? `Exported ${rows.length} rows to ${name}.csv` : "The export was cancelled or blocked by Power BI.", ok ? "good" : "info");
    if (ok) { c.store.audit("Data Explorer", "Exported", `${name}.csv (${rows.length} rows)`); }
}

// ------------------------------------------------------------------ Data Explorer (5)
export function explorer(c: Ctx, el: HTMLElement): void {
    const sel = c.m<TableName>("exTable", () => "sales_orders");
    const st = c.m<Record<string, TableState>>("exState", () => ({}));
    const gq = c.m<{ q: string }>("exGlobal", () => ({ q: "" }));
    const row = c.s.m.exRow as Row | undefined;
    title(el, "Data Explorer", "Every table of the model, read-only. Search, sort, choose columns, paginate, inspect a row with its links, export what you see.");
    const g = h("div", "mc-grid mc-g-explorer"); el.appendChild(g);
    // table list
    const side = card("Tables", { icon: "Database", sub: `${TABLES.length} tables · salary never loaded` });
    TABLES.slice().sort((a, b) => label(a).localeCompare(label(b))).forEach(t => {
        const b = h("button", { class: `mc-list-btn${t === sel ? " mc-on" : ""}`, type: "button" }, h("span", null, label(t)), h("span", "mc-muted mc-small", fmt.int(c.d[t].length)));
        b.onclick = (): void => { c.s.m.exTable = t; c.s.m.exRow = undefined; c.rerender(); }; side.body.appendChild(b);
    });
    g.appendChild(side.el);
    const main = h("div", "mc-col-stack"); g.appendChild(main);
    // global search across tables
    const gs = card("Global search", { icon: "Search", sub: "Searches every text value of every table (first 8 hits per table)" });
    gs.body.appendChild(h("label", "mc-search-box", icon("Search", 14), input(gq.q, v => { gq.q = v; c.rerender(); }, "Search all tables, e.g. O00004, Sfax, Overdue…", "search", "ex-global")));
    if (gq.q.trim().length >= 2) {
        const q = gq.q.trim().toLowerCase(); let total = 0;
        const res = h("div", "mc-global-res");
        TABLES.forEach(t => {
            const hits = c.d[t].filter(r => Object.values(r).some(v => v !== null && String(v).toLowerCase().includes(q)));
            if (!hits.length) { return; } total += hits.length;
            res.appendChild(h("div", "mc-global-group", h("b", null, `${label(t)} · ${hits.length}`), ...hits.slice(0, 8).map(r => { const b = h("button", { type: "button", class: "mc-link" }, String(r[KEYS[t]])); b.onclick = (): void => { c.s.m.exTable = t; c.s.m.exRow = r; c.rerender(); }; return b; })));
        });
        gs.body.appendChild(total ? res : empty(`No value contains “${gq.q}”.`, "SearchX"));
    }
    main.appendChild(gs.el);
    // table
    const rows = c.d[sel];
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const ts = st[sel] ?? (st[sel] = newTableState(cols[0] ?? "", false, 14));
    const defs: Array<Col<Row>> = cols.map(k => ({ key: k, label: k, get: r => r[k], num: typeof rows[0][k] === "number" && !/_id$/.test(k), render: (r: Row): any => (FK[k] && r[k] ? (() => { const b = h("button", { type: "button", class: "mc-link" }, String(r[k])); b.onclick = (e): void => { e.stopPropagation(); c.select(FK[k].type, String(r[k])); }; return b; })() : typeof r[k] === "number" && !/_id$/.test(k) ? (Number.isInteger(r[k]) ? fmt.int(r[k]) : fmt.money2(r[k])) : r[k]) }));
    const filtered = (): Row[] => { if (!ts.q) { return rows; } const q = ts.q.toLowerCase(); return rows.filter(r => cols.some(k => String(r[k] ?? "").toLowerCase().includes(q))); };
    const tc = card(label(sel), { icon: "Table", sub: `Key: ${KEYS[sel]} · ${cols.length} columns · click a row to inspect, a blue id to open its record`, actions: [
        btn("Export CSV", { small: true, icon: "Download", title: "Exports the rows that match the search, with visible columns", onClick: () => { void exportCsv(c, sel, cols.filter(k => !ts.hidden.includes(k)), filtered()); } })] });
    tc.body.appendChild(dataTable(defs, rows, ts, () => c.rerender(), { chooser: true, id: `ex-${sel}`, onRow: r => { c.s.m.exRow = r; c.rerender(); }, active: r => !!row && r[KEYS[sel]] === row[KEYS[sel]] && r === row }));
    main.appendChild(tc.el);
    if (row) {
        const body = h("div", "mc-col-stack");
        const ent = entityOf(sel, row);
        body.appendChild(h("div", "mc-kv", ...Object.keys(row).map(k => h("div", "mc-kv-row", h("span", "mc-muted", k), FK[k] && row[k] ? (() => { const b = h("button", { type: "button", class: "mc-link" }, `${row[k]} · ${c.ix.entityLabel(FK[k].type[0].toUpperCase() + FK[k].type.slice(1), String(row[k]))}`); b.onclick = (): void => c.select(FK[k].type, String(row[k])); return b; })() : h("b", null, row[k] === null || row[k] === "" ? "—" : String(row[k]))))));
        // lineage: where this row comes from, and what references it
        const src = c.d.data_sources.find(s => String(s.source_files ?? "").includes(sel));
        body.appendChild(h("h4", null, "Lineage"));
        body.appendChild(h("div", "mc-small", `CSV ${sel}.csv → Power Query ${sel}.pq (clean text, typed columns) → table '${sel}' → measure "Feed ${sel}" → this visual.${src ? ` Registered source: ${src.source_name} (${src.source_type}, ${src.refresh_frequency_label}).` : ""}`));
        const key = String(row[KEYS[sel]]); const fkName = Object.keys(FK).find(k => FK[k].table === sel && k === KEYS[sel]);
        if (fkName) {
            const refs = TABLES.filter(t => t !== sel && c.d[t].length && Object.prototype.hasOwnProperty.call(c.d[t][0], fkName)).map(t => ({ t, n: c.d[t].filter(r => String(r[fkName]) === key).length })).filter(x => x.n);
            body.appendChild(h("div", "mc-small", refs.length ? `Referenced by: ${refs.map(x => `${label(x.t)} (${x.n})`).join(", ")}` : "Not referenced by other tables."));
        }
        drawer(c.overlay, `${label(sel)} · ${key}`, body, () => { c.s.m.exRow = undefined; c.rerender(); }, { icon: "Table", width: 460, actions: ent ? [btn("Open inspector", { small: true, icon: "Eye", onClick: () => { c.s.m.exRow = undefined; c.select(ent.type, ent.id); } })] : [] });
    }
}

// ------------------------------------------------------------------ Data Doctor
export function doctor(c: Ctx, el: HTMLElement): void {
    const r = dataDoctor(c.ix);
    const tab = c.m<string>("docTab", () => "checks");
    const reviewed = new Set(c.store.extras.reviewed);
    const issues = c.d.data_quality_issues;
    const openIssues = issues.filter(i => i.issue_status === "Open" || i.issue_status === "Under Review"); // same rule as the DAX measure "Open Quality Issues"
    title(el, "Data Doctor", "Automated checks on the loaded data plus the registered data-quality issues. Findings are signals that require review, not conclusions.", chip(`Score ${r.score}`, r.score >= 90 ? "good" : r.score >= 70 ? "warn" : "bad"));
    const top = h("div", "mc-grid mc-g-4"); el.appendChild(top);
    const st = (l: string, v: string, tone = ""): HTMLElement => h("div", `mc-stat-card ${tone}`, h("span", null, l), h("b", null, v));
    top.append(st("Check score", `${r.score} / 100`, r.score >= 90 ? "mc-tone-good" : "mc-tone-warn"), st("Failing checks", String(r.checks.filter(x => x.count).length)), st("Failing rows", fmt.int(r.checks.reduce((a, x) => a + x.count, 0))), st("Open registered issues", `${openIssues.length} / ${issues.length}`));
    el.appendChild(h("div", "mc-hint", icon("Info", 14), `Score formula: ${r.formula}. The model's "Data Quality Score" measure uses the registered issues instead: 100 × (1 − weighted open issues ÷ weighted all issues).`));
    el.appendChild(tabs([{ id: "checks", label: "Automated checks", count: r.checks.length }, { id: "issues", label: "Registered issues", count: issues.length }, { id: "tables", label: "Completeness by table" }], tab, v => { c.s.m.docTab = v; c.rerender(); }));
    if (tab === "checks") {
        const list = h("div", "mc-col-stack"); el.appendChild(list);
        r.checks.forEach(ch => {
            const done = reviewed.has(ch.id);
            const cd = card(`${ch.check}`, { icon: ch.count ? "TriangleAlert" : "CircleCheck", sub: `${ch.table} · rule: ${ch.formula}`, cls: done ? "mc-dim" : "", actions: [chip(ch.severity, ch.severity === "Critical" ? "bad" : ch.severity === "High" ? "warn" : "info"), chip(`${ch.count} rows`, ch.count ? "warn" : "good"),
                ch.count ? btn(done ? "Reopen" : "Mark reviewed", { small: true, icon: done ? "RotateCcw" : "Check", onClick: () => { c.store.toggle("reviewed", ch.id, "Data Doctor"); c.toast(done ? "Check reopened" : "Marked as reviewed"); c.rerender(); } }) : null].filter(Boolean) as Node[] });
            if (ch.count) {
                const ex = h("div", "mc-row-gap mc-wrap", h("span", "mc-small mc-muted", "Examples:"));
                ch.examples.forEach(id => { const b = h("button", { type: "button", class: "mc-link" }, id); const type = ch.table === "sales_orders" || ch.table === "payments" ? "order" : ch.table === "projects" ? "project" : ch.table === "tasks" ? "task" : ""; b.onclick = (): void => { if (type) { c.select(type, id); } else { c.s.m.exTable = ch.table; c.s.m.exGlobal = { q: id }; c.go("explorer"); } }; ex.appendChild(b); });
                cd.body.appendChild(ex);
            }
            list.appendChild(cd.el);
        });
        el.appendChild(h("div", "mc-small mc-muted", `“Mark reviewed” is ${c.persisted ? "saved in this report" : "session-only (turn on “Keep my edits in this report” in Settings to keep it)"}.`));
    } else if (tab === "issues") {
        const ts = c.m<TableState>("docIssues", () => newTableState("detected_date", true, 14));
        const cols: Array<Col<Row>> = [
            { key: "issue_id", label: "Issue", get: x => x.issue_id }, { key: "source_table", label: "Table", get: x => x.source_table },
            { key: "issue_type", label: "Type", get: x => x.issue_type }, { key: "severity", label: "Severity", get: x => x.severity, render: x => chip(x.severity, x.severity === "Critical" ? "bad" : x.severity === "High" ? "warn" : "info") },
            { key: "issue_status", label: "Status", get: x => x.issue_status, render: x => chip(x.issue_status, x.issue_status === "Fixed" ? "good" : x.issue_status === "Accepted" ? "info" : "warn") },
            { key: "detected_date", label: "Detected", get: x => x.detected_date, render: x => fmt.date(x.detected_date) }, { key: "issue_description", label: "Description", get: x => x.issue_description }];
        el.appendChild(dataTable(cols, issues, ts, () => c.rerender(), { chooser: true, id: "doc-issues", onRow: x => { c.s.m.exTable = x.source_table; c.go("explorer"); } }));
    } else {
        const g = h("div", "mc-grid mc-g-3"); el.appendChild(g);
        TABLES.forEach(t => {
            const rows = c.d[t]; if (!rows.length) { return; }
            const cols = Object.keys(rows[0]); const cells = rows.length * cols.length;
            const blanks = cols.map(k => ({ k, n: rows.filter(r => r[k] === null || r[k] === "").length })).filter(x => x.n);
            const filled = 1 - blanks.reduce((a, x) => a + x.n, 0) / cells;
            const cd = card(label(t), { icon: "Table", sub: `${fmt.int(rows.length)} rows · ${cols.length} columns` });
            cd.body.append(h("div", "mc-row-gap", h("b", null, fmt.pct(filled, 2)), h("span", "mc-small mc-muted", "cells filled")), bar(filled, filled > 0.99 ? "good" : "warn"));
            if (blanks.length) { cd.body.appendChild(h("div", "mc-small mc-muted", blanks.map(x => `${x.k}: ${x.n} blank`).join(" · "))); }
            g.appendChild(cd.el);
        });
    }
}

// ------------------------------------------------------------------ Data Sources & lineage
export function sources(c: Ctx, el: HTMLElement): void {
    title(el, "Data Sources & Lineage", `Data loaded at the last model refresh; reference date ${fmt.date(c.ix.ref)} (latest order). Synthetic demo data in TND.`);
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const reg = card("Registered sources", { icon: "Plug", sub: "From data_sources.csv · statuses are as recorded in the file, not live checks" });
    c.d.data_sources.forEach(s => reg.body.appendChild(h("div", "mc-ins-row", h("div", null, h("b", null, s.source_name), h("div", "mc-small mc-muted", `${s.source_type} · ${s.connection_location} · ${s.refresh_frequency_label}`), h("div", "mc-small mc-muted", `Files: ${s.source_files}`)), chip(s.connection_status, String(s.connection_status).startsWith("Connected") ? "good" : "warn"))));
    if (!c.d.data_sources.length) { reg.body.appendChild(empty("No data source rows.")); }
    g.appendChild(reg.el);
    const lin = card("Pipeline", { icon: "Route" });
    const steps: Array<[string, string, string]> = [["FileText", "CSV files", "Mission_Control_Enterprise/*.csv (UTF-8, 31 tables + dim_date)"], ["Funnel", "Power Query", "powerquery/*.pq · trims text with fnCleanText, types each column, keeps nulls"],
        ["Database", "Semantic model", "32 tables, 61 relationships (12 inactive to avoid ambiguous paths), 62 catalogue measures, dim_date marked as date table"],
        ["Braces", "Feed measures", "One “Feed <table>” measure per table returns compact JSON {c, r}; salary columns are excluded"], ["LayoutDashboard", "This visual", "Decodes the feeds, computes KPIs in TypeScript (verified against the DAX measures by tools/test-engine.ps1)"]];
    steps.forEach(([ic, t, d], i) => lin.body.appendChild(h("div", "mc-step", h("div", "mc-step-n", icon(ic, 15)), h("div", null, h("b", null, `${i + 1}. ${t}`), h("div", "mc-small mc-muted", d)))));
    g.appendChild(lin.el);
    const ts = c.m<TableState>("srcTables", () => newTableState("rows", true, 16));
    const rows = TABLES.map(t => ({ t, label: label(t), rows: c.d[t].length, cols: c.d[t].length ? Object.keys(c.d[t][0]).length : 0, size: c.app.feedSizes[t] ?? 0, key: KEYS[t] }));
    const tc = card("Loaded tables", { icon: "Table", sub: `${fmt.int(rows.reduce((a, r) => a + r.rows, 0))} rows · feed payload ${fmt.compact(rows.reduce((a, r) => a + r.size, 0), " chars")}` });
    tc.body.appendChild(dataTable<typeof rows[number]>([
        { key: "label", label: "Table", get: r => r.label }, { key: "rows", label: "Rows", get: r => r.rows, num: true, render: r => fmt.int(r.rows) },
        { key: "cols", label: "Columns", get: r => r.cols, num: true }, { key: "key", label: "Key", get: r => r.key }, { key: "size", label: "Feed size", get: r => r.size, num: true, render: r => (r.size ? fmt.compact(r.size, " ch") : "—") }],
    rows, ts, () => c.rerender(), { search: true, id: "src", onRow: r => { c.s.m.exTable = r.t; c.go("explorer"); } }));
    el.appendChild(tc.el);
}

// ------------------------------------------------------------------ Settings / Personalization (4) + Help
export function settings(c: Ctx, el: HTMLElement): void {
    const p = c.store.prefs;
    const save = (msg = "Preference saved in this report"): void => { c.store.savePrefs(); c.toast(msg); c.rerender(); };
    const tab = c.m<string>("setTab", () => "look");
    title(el, "Settings & Help", "Preferences are saved in this report (the visual's own settings). Data edits follow the rule below.");
    el.appendChild(tabs([{ id: "look", label: "Appearance", icon: "Palette" }, { id: "layout", label: "Layout & KPIs", icon: "LayoutGrid" }, { id: "data", label: "Edits & storage", icon: "Save" }, { id: "integrations", label: "Integrations", icon: "Plug" }, { id: "help", label: "Help & limitations", icon: "CircleQuestionMark" }], tab, v => { c.s.m.setTab = v; c.rerender(); }));
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    if (tab === "look") {
        const a = card("Theme", { icon: "Palette" });
        const seg = (opts: Array<[string, string]>, cur: string, on: (v: string) => void): HTMLElement => h("div", "mc-seg", ...opts.map(([v, l]) => { const b = h("button", { type: "button", class: `mc-seg-btn${cur === v ? " mc-on" : ""}`, "aria-pressed": cur === v ? "true" : "false" }, l); b.onclick = (): void => on(v); return b; }));
        a.body.append(h("div", "mc-field-label", "Mode"), seg([["dark", "Dark"], ["light", "Light"]], p.theme, v => { p.theme = v as any; save(); }),
            h("div", "mc-field-label", "Accent"), h("div", "mc-row-gap", ...(["gold", "teal", "blue", "violet"] as const).map(x => { const b = h("button", { type: "button", class: `mc-swatch mc-sw-${x}${p.accent === x ? " mc-on" : ""}`, "aria-label": `${x} accent`, title: x }); b.onclick = (): void => { p.accent = x; save(); }; return b; })),
            h("div", "mc-field-label", "Density"), seg([["comfortable", "Comfortable"], ["compact", "Compact"]], p.density, v => { p.density = v as any; save(); }),
            range(p.fontScale, 0.85, 1.25, 0.05, v => { p.fontScale = v; }, "Font size", v => `${Math.round(v * 100)}%`), btn("Apply font size", { small: true, onClick: () => save() }),
            h("div", "mc-field-label", "Motion"), seg([["auto", "Smooth (follows the system setting)"], ["reduced", "Reduced"]], p.motion, v => { p.motion = v as any; save(); }),
            h("div", "mc-small mc-muted", "Reduced motion turns off count-ups, page transitions, flowing edges and pulses. It is also applied automatically when the operating system asks for reduced motion."));
        g.appendChild(a.el);
        const b = card("Navigation", { icon: "PanelLeft" });
        b.body.append(select(ROUTES.map(r => ({ value: r.id, label: `${r.group} › ${r.label}` })), p.landing, v => { p.landing = v; save("Landing page saved"); }, "Landing page when the report opens"),
            h("div", "mc-field-label", "Sidebar"), seg([["expanded", "Expanded"], ["collapsed", "Icons only"]], p.sidebar, v => { p.sidebar = v as any; save(); }));
        g.appendChild(b.el);
    } else if (tab === "layout") {
        const a = card("Command Center KPIs", { icon: "Gauge", sub: "Choose up to 6 KPI cards" });
        ALL_KPIS.forEach(k => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = p.kpis.includes(k); cb.onchange = (): void => { p.kpis = cb.checked ? Array.from(new Set(p.kpis.concat(k))).slice(0, 6) : p.kpis.filter(x => x !== k); save(); }; a.body.appendChild(h("label", "mc-check", cb, KPI_DEFS[k]?.label ?? k)); });
        g.appendChild(a.el);
        const b = card("Dashboard widgets", { icon: "LayoutGrid", sub: "Reorder, resize and remove widgets with “Edit layout” on the Command Center" });
        b.body.appendChild(h("div", "mc-small", `${p.widgets.length} widgets: ${p.widgets.map(w => `${w.id} (${w.size.toUpperCase()})`).join(", ")}`));
        b.body.appendChild(h("div", "mc-row-gap", btn("Open the Command Center", { small: true, icon: "LayoutDashboard", onClick: () => c.go("command") }), btn("Reset layout", { small: true, icon: "RotateCcw", onClick: () => { p.widgets = DEFAULT_WIDGETS.map(w => ({ ...w })); save("Layout reset"); } })));
        g.appendChild(b.el);
        const w = card("Watchlist (Financial Terminal)", { icon: "Star" });
        ALL_KPIS.forEach(k => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = p.watchlist.includes(k); cb.onchange = (): void => { p.watchlist = cb.checked ? Array.from(new Set(p.watchlist.concat(k))) : p.watchlist.filter(x => x !== k); save(); }; w.body.appendChild(h("label", "mc-check", cb, KPI_DEFS[k]?.label ?? k)); });
        g.appendChild(w.el);
        const r = card("Reset everything", { icon: "RotateCcw" });
        r.body.append(h("div", "mc-small mc-muted", `Saved scenarios: ${p.scenarios.length}. Resetting restores the default theme, layout, KPIs and watchlist; data edits are not touched.`), btn("Reset all preferences", { kind: "danger", small: true, onClick: () => { const keep = p.persistEdits; Object.assign(p, JSON.parse(JSON.stringify(DEFAULT_PREFS)), { persistEdits: keep }); save("Preferences reset"); } }));
        g.appendChild(r.el);
    } else if (tab === "data") {
        const a = card("Where your edits go", { icon: "Save" });
        const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = p.persistEdits;
        cb.onchange = (): void => { p.persistEdits = cb.checked; c.store.savePrefs(); if (cb.checked) { c.store.saveWs(); c.toast("Edits will be kept in this report — save the report (Ctrl+S) to keep them"); } else { c.store.clearSavedWs(); c.toast("Edits are session-only again; the saved copy was cleared", "info"); } c.rerender(); };
        a.body.append(h("label", "mc-check mc-big", cb, h("b", null, "Keep my edits in this report")),
            h("div", "mc-small", p.persistEdits ? "On — tasks, events, approvals, decisions, comments, case status, acknowledgements and review marks are stored in this visual's settings inside the .pbix / .pbip. Save the report to keep them." : "Off — edits live in memory only (“Demo session — not saved”). They disappear on refresh or reopen."),
            h("div", "mc-hint", icon("Info", 14), "Edits are never written back to the CSV files or the semantic model: Power BI custom visuals have no supported way to write to a data source without an external backend, which this project intentionally does not use. KPIs computed in DAX therefore show the original data; this visual shows the data with your edits applied."),
            h("div", "mc-row-gap", chip(`${c.store.editCount()} edits in this session`, "info"), btn("Discard all edits", { kind: "danger", small: true, icon: "Trash", disabled: !c.store.editCount(), onClick: () => { c.store.resetWs(); c.toast("All edits discarded", "info"); c.rerender(); } })));
        g.appendChild(a.el);
        const b = card("Storage classification", { icon: "Layers" });
        const t = h("table", "mc-table", h("thead", null, h("tr", null, h("th", null, "What"), h("th", null, "Where"), h("th", null, "Survives reopen"))));
        const tb = h("tbody"); t.appendChild(tb);
        ([["Theme, accent, density, font, motion, sidebar, landing page, KPI cards, widget layout, watchlist, saved scenarios", "Visual settings (prefs)", "Yes, after saving the report"],
            ["Tasks, events, approvals, decisions, comments, case notes/status, notification read state, acknowledgements, reviewed checks", p.persistEdits ? "Visual settings (workspace)" : "Memory", p.persistEdits ? "Yes, after saving the report" : "No"],
            ["Selected page, filters, period, open drawers, search text, simulator sliders, sandbox edits, time machine position", "Memory", "No"],
            ["Source data and DAX measures", "CSV → semantic model", "Unchanged by the visual"]] as Array<[string, string, string]>).forEach(r => tb.appendChild(h("tr", null, ...r.map(x => h("td", null, x)))));
        b.body.appendChild(h("div", "mc-table-scroll", t));
        g.appendChild(b.el);
    } else if (tab === "integrations") {
        const a = card("AI assistant provider", { icon: "Bot", sub: "Disabled — demo mode" });
        const key = h("input", { class: "mc-input", type: "password", value: "sk-demo-0000-PLACEHOLDER-NOT-A-REAL-KEY", disabled: true, "aria-label": "API key (placeholder)" }) as HTMLInputElement;
        a.body.append(formGrid2([["Provider", h("span", null, "Rule-based local assistant (active)")], ["External LLM", chip("Not connected", "warn")], ["API key", key]]),
            h("div", "mc-hint", icon("Lock", 14), "The field shows a fake placeholder and is disabled. No key is stored in the report, and the visual makes no network calls (no WebAccess privilege). Connecting a real model needs a backend proxy that keeps the key server-side; see docs/INTEGRATIONS.md. The assistant interface (AssistantAdapter) is ready for that adapter."));
        g.appendChild(a.el);
        const b = card("Other integrations", { icon: "Plug" });
        [["Email / Teams notifications", "Disabled — needs Power Automate or a backend"], ["Live data refresh", "Use Power BI scheduled refresh on the dataset"], ["Write-back to source", "Not supported without a backend (by design)"], ["Map tiles", "Not used — schematic map avoids external calls"]].forEach(([n, s]) => b.body.appendChild(h("div", "mc-ins-row", h("b", null, n), chip(s, "muted"))));
        g.appendChild(b.el);
    } else {
        const a = card("Keyboard shortcuts", { icon: "Keyboard" });
        [["Ctrl + K", "Open the command palette (when the visual has focus)"], ["↑ ↓ Enter", "Move and open in the palette"], ["Esc", "Close palette, drawer or inspector"], ["Tab / Shift+Tab", "Move between controls"], ["Enter", "Open the focused row, node or card"], ["← →", "Previous / next slide (Storytelling) · move a focused task card (Kanban)"]].forEach(([k, d]) => a.body.appendChild(h("div", "mc-ins-row", h("kbd", null, k), h("span", null, d))));
        g.appendChild(a.el);
        const b = card("Limitations", { icon: "Info" });
        ["Synthetic data, currency TND; the reference date is the latest order date, not today.", "Custom visuals cannot write to the data source; edits are session-only or saved in the report's visual settings.", "The viewer's identity is not available to custom visuals, so “Report viewer” is a generic profile.",
            "The AI assistant is rule-based: it answers from computed metrics and cites its sources; it does not generate free text.", "Power BI may intercept Ctrl+K before the visual receives it; the header search opens the same palette.", "CSV export depends on the tenant's export setting; Desktop asks where to save.",
            "The map is a schematic of the regions in the data, not a geographic projection.", "Forecasts are statistical baselines (moving average, linear trend, seasonal naive) with backtest error, not predictions of the future."]
            .forEach(t => b.body.appendChild(h("div", "mc-li", icon("ChevronRight", 12), t)));
        g.appendChild(b.el);
        const n = card("Module map", { icon: "Map" });
        NAV.forEach(gr => n.body.appendChild(h("div", "mc-ins-row", h("b", null, gr.group), h("span", "mc-small", gr.items.map(i => `${i.label}${i.feature ? ` (#${i.feature})` : ""}`).join(" · ")))));
        g.appendChild(n.el);
    }
}
function formGrid2(rows: Array<[string, Node]>): HTMLElement { return h("div", "mc-kv", ...rows.map(([l, n]) => h("div", "mc-kv-row", h("span", "mc-muted", l), n))); }
