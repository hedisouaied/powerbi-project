// One-time adaptation of the exercice3 visual code (copied to frontend/src/mc) for the web app:
// real persistence through the Laravel API, signed-in user, browser downloads, and wording without Power BI.
// Every replacement must match exactly once, so the script fails loudly if the source drifts.
"use strict";
const fs = require("fs"), path = require("path");
const root = path.resolve(__dirname, "..", "frontend", "src", "mc");
function patch(file, pairs) {
    const p = path.join(root, file); let s = fs.readFileSync(p, "utf8");
    for (const [a, b] of pairs) { const n = s.split(a).length - 1; if (n === 0 && s.includes(b)) { continue; } if (n !== 1) { throw new Error(`${file}: expected 1 match, found ${n}: ${a.slice(0, 80)}`); } s = s.replace(a, b); }
    fs.writeFileSync(p, s); console.log(`patched ${file} (${pairs.length})`);
}

patch("core/data.ts", [
    ["export function decode(text: string | undefined | null): Row[] {\n    if (!text) { return []; }\n    try {\n",
     "export function decode(text: string | { c: string[]; r: unknown[][] } | undefined | null): Row[] {\n    if (!text) { return []; }\n    if (typeof text === \"object\") { return Array.isArray(text.c) && Array.isArray(text.r) ? text.r.map(r => { const o: Row = {}; text.c.forEach((c, i) => { o[c] = r[i] ?? null; }); return o; }) : []; }\n    try {\n"]
]);

patch("core/state.ts", [
    [" *  - Workspace edits (tasks, events, decisions, approvals, comments, case status, notification state, acknowledgements):\n *    session-only by default (\"Demo session\"); persisted in the report (object \"workspace\") only when the user turns on\n *    \"Keep my edits in this report\". Never written to the CSV files or the semantic model.",
     " *  - Web app: table edits (tasks, events, decisions, approvals, comments, notifications, cases…) are written to MySQL\n *    through the Laravel API (`sync`); preferences and workspace extras (acknowledgements, reviewed checks) are saved\n *    on the signed-in user's account."],
    ["import { Row, TableName, TablePatch, Workspace } from \"./data\";", "import { KEYS, Row, TableName, TablePatch, Workspace } from \"./data\";"],
    ["        if (wsJson !== this.savedWs && this.prefs.persistEdits) {", "        if (wsJson !== this.savedWs) {"],
    ["    public saveWs(): void {\n        if (!this.prefs.persistEdits) { return; }\n        this.savedWs = JSON.stringify({ ws: this.ws, extras: this.extras });",
     "    /** Web app: writes every table edit to the database (set by the React shell). */\n    public sync: ((op: \"add\" | \"change\" | \"remove\", table: TableName, id: string, row: Row) => void) | null = null;\n\n    public saveWs(): void {\n        this.savedWs = JSON.stringify({ ws: {}, extras: this.extras });"],
    ["    public add(t: TableName, row: Row, module: string, detail: string): void { this.patch(t).added.push(row); this.audit(module, \"Created\", detail); this.saveWs(); }\n    public change(t: TableName, id: string, fields: Row, module: string, detail: string): void { const p = this.patch(t); p.changed[id] = { ...(p.changed[id] ?? {}), ...fields }; this.audit(module, \"Updated\", detail); this.saveWs(); }\n    public remove(t: TableName, id: string, module: string, detail: string): void { this.patch(t).removed.push(id); this.audit(module, \"Deleted\", detail); this.saveWs(); }",
     "    public add(t: TableName, row: Row, module: string, detail: string): void { this.patch(t).added.push(row); this.audit(module, \"Created\", detail); this.saveWs(); this.sync?.(\"add\", t, String(row[KEYS[t]]), row); }\n    public change(t: TableName, id: string, fields: Row, module: string, detail: string): void { const p = this.patch(t); p.changed[id] = { ...(p.changed[id] ?? {}), ...fields }; this.audit(module, \"Updated\", detail); this.saveWs(); this.sync?.(\"change\", t, id, fields); }\n    public remove(t: TableName, id: string, module: string, detail: string): void { this.patch(t).removed.push(id); this.audit(module, \"Deleted\", detail); this.saveWs(); this.sync?.(\"remove\", t, id, {}); }\n    /** Undo a local patch when the server rejected the write. */\n    public revert(op: \"add\" | \"change\" | \"remove\", t: TableName, id: string): void { const p = this.patch(t); if (op === \"add\") { p.added = p.added.filter(r => String(r[KEYS[t]]) !== id); } else if (op === \"change\") { delete p.changed[id]; } else { p.removed = p.removed.filter(x => x !== id); } }"]
]);

patch("core/ui.ts", [
    ["    return persisted ? chip(\"Saved in this report\", \"info\", \"Kept in the report's own settings (Ctrl+S). Not written to the CSV files or the data model.\")",
     "    return persisted ? chip(\"Saved to the database\", \"good\", \"Written to MySQL through the API and recorded in the activity log.\")"]
]);

patch("app.ts", [
    ["    public feedIssues: string[] = [];", "    public feedIssues: string[] = [];\n    /** Signed-in user and sign-out (set by the React shell). */\n    public user: { name: string; email: string; role: string } = { name: \"Analyst\", email: \"\", role: \"analyst\" };\n    public onLogout: () => void = () => undefined;"],
    ["Numbers that use them show as zero. Refresh the data in Power BI (Home › Refresh); if it persists, see Data › Sources.", "Numbers that use them show as zero. Reload the page; if it persists, run php artisan mc:import --check on the server."],
    ["            persisted: prefs.persistEdits, go:", "            persisted: true, go:"],
    ["                h(\"div\", { class: \"mc-profile\", title: \"Power BI does not share the viewer's identity with custom visuals\" }, h(\"div\", \"mc-avatar\", icon(\"User\", 16)), h(\"div\", null, h(\"div\", \"mc-profile-name\", \"Report viewer\"), h(\"div\", \"mc-profile-role\", \"Analyst workspace\")))));",
     "                h(\"div\", { class: \"mc-profile\", title: this.user.email }, h(\"div\", \"mc-avatar\", this.user.name.split(\" \").map(w => w[0]).join(\"\").slice(0, 2).toUpperCase() || icon(\"User\", 16)), h(\"div\", null, h(\"div\", \"mc-profile-name\", this.user.name), h(\"div\", \"mc-profile-role\", `${this.user.role[0].toUpperCase()}${this.user.role.slice(1)} workspace`))),\n                iconBtn(\"LogOut\", \"Sign out\", () => this.onLogout())));"],
    ["            h(\"div\", \"mc-palette-foot\", \"↑ ↓ to move · Enter to open · Esc to close · Ctrl+K works when the visual has focus (Power BI may keep Ctrl+K for itself otherwise — use this search box).\")));",
     "            h(\"div\", \"mc-palette-foot\", \"↑ ↓ to move · Enter to open · Esc to close · Ctrl+K from anywhere in the app.\")));"],
    ["    private onKey(e: KeyboardEvent): void {", "    public onKey(e: KeyboardEvent): void {"],
    ["h(\"div\", \"mc-live\", h(\"span\", \"mc-live-dot\"), \"Model loaded\")", "h(\"div\", \"mc-live\", h(\"span\", \"mc-live-dot\"), \"Connected to MySQL\")"]
]);

patch("core/ui.ts", [["Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap\n} from \"lucide\";", "Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap, LogOut\n} from \"lucide\";"],
    ["    Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap\n};", "    Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap, LogOut\n};"]]);

patch("modules/command.ts", [
    ["Print / PDF: a custom visual cannot generate files by itself; use Power BI's F", "Print / PDF: use your browser's Print (Ctrl+P) and choose Save as PDF; use Power BI's F"],
    ["Output: use Power BI File › Export › Export to PDF, or select the ", "Output: print this page (Ctrl+P → Save as PDF), or select the "]
]);
// tidy the leftover tail of the first replacement (the original sentence continues after "use Power BI's F")
{ const p = path.join(root, "modules/command.ts"); let s = fs.readFileSync(p, "utf8"); s = s.replace(/; use Power BI's File[^"]*"/, "\""); fs.writeFileSync(p, s); }

patch("modules/datamods.ts", [
    ["if (!c.app.exporter) { c.toast(\"Export is not allowed by this Power BI host (admin setting or the service's export policy).\", \"info\"); return; }", "if (!c.app.exporter) { c.toast(\"Export is not available.\", \"info\"); return; }"],
    ["`CSV ${sel}.csv → Power Query ${sel}.pq (clean text, typed columns) → table '${sel}' → measure \"Feed ${sel}\" → this visual.", "`CSV ${sel}.csv → php artisan mc:import (typed columns, foreign keys checked) → MySQL table '${sel}' → GET /api/feeds → this dashboard."],
    ["`“Mark reviewed” is ${c.persisted ? \"saved in this report\" : \"session-only (turn on “Keep my edits in this report” in Settings to keep it)\"}.`", "\"“Mark reviewed” is saved on your account.\""],
    ["[\"Funnel\", \"Power Query\", \"powerquery/*.pq · trims text with fnCleanText", "[\"Funnel\", \"Import\", \"php artisan mc:import · trims text"],
    ["const save = (msg = \"Preference saved in this report\")", "const save = (msg = \"Preference saved on your account\")"],
    ["\"Preferences are saved in this report (the visual's own settings). Data edits follow the rule below.\"", "\"Preferences are saved on your account; data edits are written to the database.\""]
]);
// Settings › Edits & storage, Integrations and Limitations: web wording
{
    const p = path.join(root, "modules/datamods.ts"); let s = fs.readFileSync(p, "utf8");
    const a = s.indexOf("    } else if (tab === \"data\") {"), b = s.indexOf("    } else {\n        const a = card(\"Keyboard shortcuts\"");
    if (a < 0 || b < 0) { throw new Error("datamods settings block not found"); }
    s = s.slice(0, a) + `    } else if (tab === "data") {
        const a = card("Where your edits go", { icon: "Save" });
        a.body.append(h("div", "mc-small", "Tasks, calendar events, approvals, decisions, comments, notification state and case status are written to MySQL through the Laravel API as soon as you save them. Every change is also recorded in activity_log with your name."),
            h("div", "mc-hint", icon("Info", 14), "Foreign keys are enforced: a change that points to a project, employee or department that does not exist is refused and undone on screen."),
            h("div", "mc-row-gap", chip(\`\${c.store.editCount()} changes made in this session\`, "info")));
        g.appendChild(a.el);
        const b = card("Storage classification", { icon: "Layers" });
        const t = h("table", "mc-table", h("thead", null, h("tr", null, h("th", null, "What"), h("th", null, "Where"), h("th", null, "Survives sign-out"))));
        const tb = h("tbody"); t.appendChild(tb);
        ([["Theme, accent, density, font, motion, sidebar, landing page, KPI cards, widget layout, watchlist, saved scenarios", "Your account (users.preferences)", "Yes"],
            ["Tasks, events, approvals, decisions, comments, case status, notification read state", "MySQL tables", "Yes, for every user"],
            ["Acknowledged anomalies, reviewed data checks", "Your account (users.workspace)", "Yes"],
            ["Selected page, filters, period, open drawers, search text, simulator sliders, sandbox edits, time machine position", "Memory", "No"]] as Array<[string, string, string]>).forEach(r => tb.appendChild(h("tr", null, ...r.map(x => h("td", null, x)))));
        b.body.appendChild(h("div", "mc-table-scroll", t));
        g.appendChild(b.el);
    } else if (tab === "integrations") {
        const a = card("AI assistant provider", { icon: "Bot", sub: "Disabled — demo mode" });
        const key = h("input", { class: "mc-input", type: "password", value: "sk-demo-0000-PLACEHOLDER-NOT-A-REAL-KEY", disabled: true, "aria-label": "API key (placeholder)" }) as HTMLInputElement;
        a.body.append(formGrid2([["Provider", h("span", null, "Rule-based local assistant (active)")], ["External LLM", chip("Not connected", "warn")], ["API key", key]]),
            h("div", "mc-hint", icon("Lock", 14), "The field shows a fake placeholder and is disabled. A real key would live only in the Laravel backend (.env, never in the browser); the assistant interface (AssistantAdapter) is ready for that adapter."));
        g.appendChild(a.el);
        const b = card("Other integrations", { icon: "Plug" });
        [["Email notifications", "Disabled — would use Laravel Mail"], ["Data refresh", "php artisan mc:import reloads the CSVs"], ["Map tiles", "Not used — schematic map avoids external calls"]].forEach(([n, s2]) => b.body.appendChild(h("div", "mc-ins-row", h("b", null, n), chip(s2, "muted"))));
        g.appendChild(b.el);
` + s.slice(b);
    s = s.replace("[\"Ctrl + K\", \"Open the command palette (when the visual has focus)\"]", "[\"Ctrl + K\", \"Open the command palette\"]");
    const lim0 = s.indexOf("[\"Synthetic data, currency TND;"), lim1 = s.indexOf("]\n            .forEach(t => b.body.appendChild(h(\"div\", \"mc-li\"");
    if (lim0 < 0 || lim1 < 0) { throw new Error("limitations not found"); }
    s = s.slice(0, lim0) + `["Synthetic data, currency TND; the reference date is the latest order date, not today.", "The AI assistant is rule-based: it answers from computed metrics and cites its sources; it does not generate free text.",
            "The map is a schematic of the regions in the data, not a geographic projection.", "Forecasts are statistical baselines (moving average, linear trend, seasonal naive) with backtest error, not predictions of the future.",
            "Collaboration is not live: other users see your changes after they reload."` + s.slice(lim1);
    fs.writeFileSync(p, s); console.log("patched datamods settings");
}
patch("modules/intel.ts", [["via the WebAccess privilege. Keys are never stored in the visual.", "on the Laravel side. Keys are never sent to the browser."]]);
