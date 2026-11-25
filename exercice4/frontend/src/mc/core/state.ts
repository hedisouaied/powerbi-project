"use strict";

/**
 * Application state.
 *  - Prefs (theme, accent, density, font, landing page, KPI choice, dashboard layout, watchlist, saved scenarios):
 *    saved on the signed-in user (PUT /api/me/preferences).
 *  - Web app: table edits (tasks, events, decisions, approvals, comments, notifications, cases…) are written to MySQL
 *    through the Laravel API (`sync`); preferences and workspace extras (acknowledgements, reviewed checks) are saved
 *    on the signed-in user's account.
 *  - Navigation, selection, filters, open panels: session only.
 */

import { KEYS, Row, TableName, TablePatch, Workspace } from "./data";
import { PeriodKey, ScenarioInputs } from "./engine";
import { AccentName, ThemeName } from "./theme";

export interface Widget { id: string; size: "s" | "m" | "l" }
export const DEFAULT_WIDGETS: Widget[] = [
    { id: "kpis", size: "l" }, { id: "hero", size: "m" }, { id: "health", size: "s" }, { id: "assistant", size: "s" },
    { id: "sales", size: "m" }, { id: "geo", size: "s" }, { id: "radar", size: "s" }, { id: "calendar", size: "s" },
    { id: "missions", size: "s" }, { id: "tasks", size: "m" }, { id: "actions", size: "s" }, { id: "crisis", size: "s" },
    { id: "matrix", size: "l" }, { id: "changed", size: "m" }, { id: "ticker", size: "l" }
];
export const ALL_KPIS = ["netRevenue", "gm", "orders", "aov", "collectionRate", "openIncidents", "atRiskCustomers", "projectCompletion"];

export interface Prefs {
    theme: ThemeName; accent: AccentName; density: "comfortable" | "compact"; fontScale: number; landing: string; kpis: string[];
    widgets: Widget[]; watchlist: string[]; scenarios: Array<{ name: string; inputs: ScenarioInputs; saved: string }>;
    persistEdits: boolean; motion: "auto" | "reduced"; sidebar: "expanded" | "collapsed";
}
export const DEFAULT_PREFS: Prefs = {
    theme: "dark", accent: "gold", density: "comfortable", fontScale: 1, landing: "command", kpis: ALL_KPIS.slice(0, 4),
    widgets: DEFAULT_WIDGETS, watchlist: ["netRevenue", "gm", "collectionRate", "openIncidents"], scenarios: [], persistEdits: false, motion: "auto", sidebar: "expanded"
};

export interface Extras { acks: string[]; reviewed: string[]; log: Array<{ time: string; module: string; action: string; detail: string }> }
export interface Stored { ws: Workspace; extras: Extras }

export class Store {
    public prefs: Prefs = JSON.parse(JSON.stringify(DEFAULT_PREFS));
    public ws: Workspace = {};
    public extras: Extras = { acks: [], reviewed: [], log: [] };
    private savedPrefs = "";
    private savedWs = "";

    constructor(private readonly persist: (object: string, json: string) => void) { }

    /** Called on every update with what the report holds. Returns true when something changed. */
    public load(prefsJson: string, wsJson: string): boolean {
        let changed = false;
        if (prefsJson !== this.savedPrefs) {
            this.savedPrefs = prefsJson; changed = true;
            try { this.prefs = { ...JSON.parse(JSON.stringify(DEFAULT_PREFS)), ...(prefsJson ? JSON.parse(prefsJson) : {}) }; } catch { /* keep defaults */ }
            if (!this.prefs.widgets?.length) { this.prefs.widgets = DEFAULT_WIDGETS; }
        }
        if (wsJson !== this.savedWs) {
            this.savedWs = wsJson; changed = true;
            try { const s = wsJson ? JSON.parse(wsJson) as Stored : { ws: {}, extras: { acks: [], reviewed: [], log: [] } }; this.ws = s.ws ?? {}; this.extras = { acks: [], reviewed: [], log: [], ...(s.extras ?? {}) }; } catch { /* ignore */ }
        }
        return changed;
    }

    public savePrefs(): void { this.savedPrefs = JSON.stringify(this.prefs); this.persist("prefs", this.savedPrefs); }
    /** Web app: writes every table edit to the database (set by the React shell). */
    public sync: ((op: "add" | "change" | "remove", table: TableName, id: string, row: Row) => void) | null = null;

    public saveWs(): void {
        this.savedWs = JSON.stringify({ ws: {}, extras: this.extras });
        this.persist("workspace", this.savedWs);
    }
    public clearSavedWs(): void { this.savedWs = ""; this.persist("workspace", ""); }

    private patch(t: TableName): TablePatch { const p = this.ws[t] ?? { added: [], changed: {}, removed: [] }; this.ws[t] = p; return p; }
    public add(t: TableName, row: Row, module: string, detail: string): void { this.patch(t).added.push(row); this.audit(module, "Créé", detail); this.saveWs(); this.sync?.("add", t, String(row[KEYS[t]]), row); }
    public change(t: TableName, id: string, fields: Row, module: string, detail: string): void { const p = this.patch(t); p.changed[id] = { ...(p.changed[id] ?? {}), ...fields }; this.audit(module, "Mis à jour", detail); this.saveWs(); this.sync?.("change", t, id, fields); }
    public remove(t: TableName, id: string, module: string, detail: string): void { this.patch(t).removed.push(id); this.audit(module, "Supprimé", detail); this.saveWs(); this.sync?.("remove", t, id, {}); }
    /** Undo a local patch when the server rejected the write. */
    public revert(op: "add" | "change" | "remove", t: TableName, id: string): void { const p = this.patch(t); if (op === "add") { p.added = p.added.filter(r => String(r[KEYS[t]]) !== id); } else if (op === "change") { delete p.changed[id]; } else { p.removed = p.removed.filter(x => x !== id); } }
    public toggle(list: "acks" | "reviewed", id: string, module: string): void {
        const l = this.extras[list]; const i = l.indexOf(id);
        if (i >= 0) { l.splice(i, 1); } else { l.push(id); }
        this.audit(module, i >= 0 ? "Rouvert" : list === "acks" ? "Pris en compte" : "Marqué comme examiné", id); this.saveWs();
    }
    public audit(module: string, action: string, detail: string): void {
        const d = new Date(); const p = (n: number): string => String(n).padStart(2, "0");
        this.extras.log.unshift({ time: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`, module, action, detail });
        this.extras.log = this.extras.log.slice(0, 200);
    }
    public editCount(): number { return Object.values(this.ws).reduce((s, p) => s + (p ? p.added.length + Object.keys(p.changed).length + p.removed.length : 0), 0) + this.extras.acks.length + this.extras.reviewed.length; }
    public resetWs(): void { this.ws = {}; this.extras = { acks: [], reviewed: [], log: [] }; this.saveWs(); }
}

/** Session-only UI state shared by the modules. */
export interface Session {
    route: string; history: string[]; periodKey: PeriodKey; dept: string;
    selection: { type: string; id: string } | null;
    palette: boolean; paletteQ: string; paletteIdx: number; recent: string[];
    notifOpen: boolean; editLayout: boolean;
    assistant: Array<{ who: "user" | "bot"; text: string; cites?: string[] }>;
    m: Record<string, any>;
}
export function newSession(landing: string): Session {
    return { route: landing, history: [], periodKey: "12m", dept: "", selection: null, palette: false, paletteQ: "", paletteIdx: 0, recent: [], notifOpen: false, editLayout: false, assistant: [], m: {} };
}
