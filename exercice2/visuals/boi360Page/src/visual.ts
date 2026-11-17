"use strict";

/**
 * BOI 360 Page: one custom visual draws a whole report page (one visual per page).
 * The page kind (overview, sales, people, projects, tasks, finance, customers, actions) comes from the
 * "Page" format card. Data arrives as JSON text measures (one per table); filtering and the business
 * rules run in metrics.ts, which is tested against the DAX measures (tools/test-metrics.ps1).
 */

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";
import { axisStyle, ChartClick, ChartHost, glassTooltip, icon, IconName, linear, NEON, SERIES, TooltipRow, tooltipHtml } from "../../shared/neon";
import {
    daysBetween, Dataset, distinct, divide, EMPTY_DATASET, Employee, Expense, expenseKpis, filterEmployees, filterExpenses, filterLeave, filterProjects,
    filterSales, filterTargets, filterTasks, Filters, groupBy, isOpen, isOverBudget, isOverdue, isPastDeadline, leaveKpis, Lookup, month, monthRange,
    notCancelled, peopleKpis, periodMonths, Project, projectKpis, projectRisk, salesKpis, sum, targetKpis, Task, taskKpis
} from "./metrics";
import { ActionCenter } from "./actions";
import { VisualFormattingSettingsModel } from "./settings";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import DataView = powerbi.DataView;
import IDownloadService = powerbi.extensibility.IDownloadService;

// powerbi.PrivilegeStatus values (a const enum in the typings, not available at runtime).
const PRIVILEGE_ALLOWED = 0;

type PageKind = "overview" | "sales" | "people" | "projects" | "tasks" | "finance" | "customers" | "actions";

const W = 1280;
const H = 720;
const PAGES: Record<PageKind, { title: string; icon: IconName }> = {
    overview: { title: "Executive Overview", icon: "Gauge" },
    sales: { title: "Sales Performance", icon: "TrendingUp" },
    people: { title: "People & HR", icon: "Users" },
    projects: { title: "Project Portfolio", icon: "FolderKanban" },
    tasks: { title: "Task Operations", icon: "ClipboardList" },
    finance: { title: "Finance & Expenses", icon: "Wallet" },
    customers: { title: "Customer & Product", icon: "ShoppingCart" },
    actions: { title: "Management Action Center", icon: "ShieldAlert" }
};
const FEEDS: Array<[keyof Dataset | "meta", string]> = [
    ["meta", "meta"], ["departments", "departments"], ["employees", "employees"], ["customers", "customers"], ["products", "products"],
    ["sales", "sales"], ["targets", "targets"], ["projects", "projects"], ["tasks", "tasks"], ["expenses", "expenses"], ["leave", "leave"]
];
const STATUS_COLORS: Record<string, string> = {
    Paid: NEON.green, Pending: NEON.blue, Overdue: NEON.orange, Cancelled: NEON.pink,
    Approved: NEON.green, Rejected: NEON.pink, Submitted: NEON.blue,
    Completed: NEON.green, "In Progress": NEON.cyan, "On Hold": NEON.orange, Planned: NEON.violet,
    Done: NEON.green, "To Do": NEON.blue, Blocked: NEON.pink, Active: NEON.green, "On Leave": NEON.amber
};
const PRIORITY_ORDER = ["Critical", "High", "Medium", "Low"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

interface FilterDef { key: string; label: string; options: string[]; width?: number }
interface Kpi {
    label: string; value: string; note?: string; icon: IconName; tone?: string;
    /** numeric value + formatter: enables the count-up animation */
    num?: number | null; fmt?: (v: number) => string;
    /** monthly series (aligned with periodMonths) for the sparkline and the change vs previous month */
    spark?: number[]; deltaMode?: "pct" | "pts"; upIsGood?: boolean;
    /** 0..1 share drawn as an animated progress ring */
    ring?: number | null; ringColor?: string;
    /** subtle pulse for alerts */
    pulse?: boolean;
}
interface BarRow { name: string; value: number; color?: string; tip: TooltipRow[]; label?: string }
interface Column<T> { key: string; label: string; value: (row: T) => string | number | null; format?: (row: T) => string; align?: "right"; color?: (row: T) => string | undefined; width?: number }
interface TableState { sort: string; desc: boolean; search: string }

export class Visual implements IVisual {
    private host: IVisualHost;
    private root: HTMLElement;
    private page: HTMLElement;
    private charts = new ChartHost();
    private formattingSettings: VisualFormattingSettingsModel;
    private formattingSettingsService = new FormattingSettingsService();
    private kind: PageKind = "overview";
    private data: Dataset = EMPTY_DATASET;
    private lookup = new Lookup(EMPTY_DATASET);
    private dataKey = "";
    private filters: Filters = {};
    /** Filters of every view (the sidebar switches views inside this one visual) and the view on screen. */
    private viewFilters: Partial<Record<PageKind, Filters>> = {};
    private view: PageKind | "" = "";
    private persisted = "";
    private drawer = "";
    private tables = new Map<string, TableState>();
    private actions: ActionCenter;
    private viewport = { width: W, height: H };
    private body: HTMLElement;
    private animateNext = true;
    private lastKind = "";
    private countUps: Array<{ el: HTMLElement; target: number; fmt: (v: number) => string }> = [];
    private downloadService: IDownloadService;
    private toastText = "";
    private toastBad = false;
    private toastTimer = 0;

    constructor(options: VisualConstructorOptions) {
        this.host = options.host;
        this.downloadService = options.host.downloadService;
        this.root = options.element;
        this.root.classList.add("bx-host");
        this.page = document.createElement("div");
        this.page.className = "bx-page";
        this.root.appendChild(this.page);
        this.actions = new ActionCenter(() => this.render(), json => this.host.persistProperties({ merge: [{ objectName: "crud", selector: null as unknown as powerbi.data.Selector, properties: { changes: json } }] }));
    }

    public update(options: VisualUpdateOptions): void {
        const dataView: DataView | undefined = options.dataViews?.[0];
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(VisualFormattingSettingsModel, dataView);
        const configured = (this.formattingSettings.pageCard.kind.value || "overview").trim().toLowerCase() as PageKind;
        this.viewport = { width: options.viewport.width, height: options.viewport.height };
        this.readData(dataView);
        this.actions.restore(String(dataView?.metadata?.objects?.crud?.changes ?? ""));
        const saved = String(dataView?.metadata?.objects?.state?.filters ?? "");
        if (saved !== this.persisted) {
            this.persisted = saved;
            let state: { v?: PageKind; f?: Partial<Record<PageKind, Filters>> } = {};
            try { state = saved ? JSON.parse(saved) : {}; } catch { state = {}; }
            if (state && state.f) { this.viewFilters = state.f; this.view = state.v && PAGES[state.v] ? state.v : ""; }
            else { this.viewFilters = { [PAGES[configured] ? configured : "overview"]: (state as Filters) ?? {} }; this.view = ""; }
        }
        const kind = this.view || (PAGES[configured] ? configured : "overview");
        this.kind = kind;
        this.filters = { ...(this.viewFilters[kind] ?? {}) };
        if (this.kind !== this.lastKind) { this.lastKind = this.kind; this.animateNext = true; }
        this.render();
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }

    // ---------- data ----------

    private readData(dataView: DataView | undefined): void {
        const table = dataView?.table;
        const raw: Record<string, string> = {};
        table?.columns.forEach((column, index) => {
            const role = Object.keys(column.roles ?? {})[0];
            if (role) { raw[role] = String(table.rows?.[0]?.[index] ?? ""); }
        });
        const key = FEEDS.map(([, role]) => (raw[role] ?? "").length).join("|") + (raw.meta ?? "");
        if (key === this.dataKey) { return; }
        this.dataKey = key;
        const parse = <T>(text: string | undefined, fallback: T): T => { try { return text ? JSON.parse(text) as T : fallback; } catch { return fallback; } };
        const meta = parse<{ ref?: string }>(raw.meta, {});
        this.data = {
            ref: meta.ref ?? "",
            departments: parse(raw.departments, []), employees: parse(raw.employees, []), customers: parse(raw.customers, []),
            products: parse(raw.products, []), sales: parse(raw.sales, []), targets: parse(raw.targets, []), projects: parse(raw.projects, []),
            tasks: parse(raw.tasks, []), expenses: parse(raw.expenses, []), leave: parse(raw.leave, [])
        };
        this.lookup = new Lookup(this.data);
        this.animateNext = true;
        this.actions.load(this.data, this.lookup);
    }

    private setFilters(next: Filters): void {
        Object.keys(next).forEach(k => { if (!next[k]) { delete next[k]; } });
        this.filters = next;
        this.viewFilters[this.kind] = next;
        this.persisted = JSON.stringify({ v: this.kind, f: this.viewFilters });
        this.render();
        this.host.persistProperties({ merge: [{ objectName: "state", selector: null as unknown as powerbi.data.Selector, properties: { filters: this.persisted } }] });
    }

    private toggle(key: string, value: string): void {
        this.setFilters({ ...this.filters, [key]: this.filters[key] === value ? "" : value });
    }

    // ---------- page frame ----------

    private render(): void {
        this.charts.disposeAll();
        this.page.replaceChildren();
        this.countUps = [];
        const scale = Math.min(this.viewport.width / W, this.viewport.height / H);
        this.page.style.transform = `scale(${scale})`;
        this.root.style.overflow = "hidden";
        this.page.classList.toggle("bx-enter", this.animateNext);
        if (!this.data.sales.length && !this.data.employees.length) {
            this.el("div", "bx-empty", this.page, "Waiting for data: refresh the model (Home › Refresh).");
            return;
        }
        this.sidebar();
        this.body = this.el("div", "bx-main", this.page);
        this.header();
        switch (this.kind) {
            case "sales": this.renderSales(); break;
            case "people": this.renderPeople(); break;
            case "projects": this.renderProjects(); break;
            case "tasks": this.renderTasks(); break;
            case "finance": this.renderFinance(); break;
            case "customers": this.renderCustomers(); break;
            case "actions": this.actions.render(this.body); break;
            default: this.renderOverview();
        }
        if (this.drawer) { this.renderDrawer(this.drawer); }
        if (this.toastText) { const t = this.el("div", `ac-toast ${this.toastBad ? "ac-toast-bad" : "ac-toast-ok"}`, this.page); t.appendChild(icon(this.toastBad ? "TriangleAlert" : "Check", 14)); t.appendChild(document.createTextNode(" " + this.toastText)); }
        this.charts.flush();
        this.runCountUps(this.animateNext);
        this.animateNext = false;
    }

    /** Sidebar navigation: shows another view inside this same visual (Power BI has no page-navigation API for visuals). */
    private switchView(k: PageKind): void {
        if (k === this.kind) { return; }
        this.drawer = "";
        this.view = k;
        this.kind = k;
        this.lastKind = k;
        this.filters = { ...(this.viewFilters[k] ?? {}) };
        this.animateNext = true;
        this.persisted = JSON.stringify({ v: k, f: this.viewFilters });
        this.render();
        this.host.persistProperties({ merge: [{ objectName: "state", selector: null as unknown as powerbi.data.Selector, properties: { filters: this.persisted } }] });
    }

    /** Command-center sidebar: brand, the 8 views (active one in gold), model status. */
    private sidebar(): void {
        const side = this.el("aside", "bx-side", this.page);
        const brand = this.el("div", "bx-brand-block", side);
        brand.appendChild(this.logo());
        const words = this.el("div", "bx-brand-words", brand);
        this.el("div", "bx-brand", words, "BOI 360");
        this.el("div", "bx-brand-sub", words, "Operations Command Center");
        this.el("div", "bx-side-label", side, "Command views");
        const nav = this.el("nav", "bx-nav", side);
        (Object.keys(PAGES) as PageKind[]).forEach((k, i) => {
            const item = this.el("div", `bx-nav-item ${k === this.kind ? "bx-nav-on" : ""}`, nav);
            item.title = k === this.kind ? "You are here" : `Open ${PAGES[k].title}`;
            item.onclick = () => this.switchView(k);
            this.el("span", "bx-nav-num", item, String(i + 1).padStart(2, "0"));
            item.appendChild(icon(PAGES[k].icon, 14));
            this.el("span", "bx-nav-text", item, k === "actions" ? "Action Center" : PAGES[k].title);
        });
        const status = this.el("div", "bx-side-status", side);
        const live = this.el("div", "bx-live", status);
        this.el("span", "bx-live-dot", live);
        this.el("span", "", live, "Model connected");
        this.el("div", "bx-muted", status, `Data as of ${this.longDate(this.data.ref)}`);
        this.el("div", "bx-muted", status, "Import mode · refresh to update");
    }

    private logo(): SVGElement {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 40 40");
        svg.setAttribute("width", "38");
        svg.setAttribute("height", "38");
        svg.setAttribute("class", "bx-logo");
        const defs = document.createElementNS(ns, "defs");
        const grad = document.createElementNS(ns, "linearGradient");
        grad.setAttribute("id", "bxGold"); grad.setAttribute("x1", "0"); grad.setAttribute("y1", "0"); grad.setAttribute("x2", "1"); grad.setAttribute("y2", "1");
        [["0", "#FFF0A3"], ["0.5", "#FFD43B"], ["1", "#C98F12"]].forEach(([o, c]) => { const st = document.createElementNS(ns, "stop"); st.setAttribute("offset", o); st.setAttribute("stop-color", c); grad.appendChild(st); });
        defs.appendChild(grad); svg.appendChild(defs);
        const hex = document.createElementNS(ns, "polygon");
        hex.setAttribute("points", "20,2 36,11 36,29 20,38 4,29 4,11");
        hex.setAttribute("fill", "none"); hex.setAttribute("stroke", "url(#bxGold)"); hex.setAttribute("stroke-width", "2.2");
        svg.appendChild(hex);
        const inner = document.createElementNS(ns, "polygon");
        inner.setAttribute("points", "20,10 28,14.5 28,25.5 20,30 12,25.5 12,14.5");
        inner.setAttribute("fill", "url(#bxGold)"); inner.setAttribute("opacity", "0.9");
        svg.appendChild(inner);
        return svg;
    }

    private header(): void {
        const head = this.el("div", "bx-header", this.body);
        const left = this.el("div", "bx-title-block", head);
        this.el("div", "bx-eyebrow", left, `View ${(Object.keys(PAGES) as PageKind[]).indexOf(this.kind) + 1} of 8 · Business Operations Intelligence 360`);
        const titleRow = this.el("div", "bx-title-row", left);
        const badge = this.el("span", "bx-badge", titleRow);
        badge.appendChild(icon(PAGES[this.kind].icon, 16));
        this.el("span", "bx-title", titleRow, PAGES[this.kind].title);
        this.el("div", "bx-subtitle", left, `${this.filters.dept || "All departments"} · amounts in TND · ${Object.keys(this.filters).filter(k => this.filters[k]).length || "no"} filter(s) active`);
        const right = this.el("div", "bx-head-actions", head);
        const months = periodMonths(this.lookup, this.filters);
        const chip = (ic: IconName, label: string, value: string, cls = ""): void => {
            const c = this.el("div", `bx-chip ${cls}`, right);
            c.appendChild(icon(ic, 13));
            const t = this.el("div", "", c);
            this.el("div", "bx-chip-label", t, label);
            this.el("div", "bx-chip-value", t, value);
        };
        chip("CalendarRange", "Reporting period", months.length ? `${this.monthLabel(months[0])} – ${this.monthLabel(months[months.length - 1])}` : "No months");
        chip("Clock", "Data as of", this.longDate(this.data.ref));
        const ref = this.data.ref;
        const alerts = this.data.tasks.filter(t => isOverdue(t, ref)).length + this.data.projects.filter(p => projectRisk(p, ref)).length;
        const bell = this.el("div", `bx-bell ${alerts ? "bx-pulse" : ""}`, right);
        bell.appendChild(icon("ShieldAlert", 16));
        bell.title = `${alerts} open alerts: overdue tasks + projects at risk (whole company)`;
        if (alerts) { this.el("span", "bx-bell-count", bell, String(alerts)); }
        const user = this.el("div", "bx-user", right);
        user.title = "Report viewer (Power BI does not share the user's identity with custom visuals)";
        user.appendChild(icon("UserCheck", 15));
        const reset = this.el("button", "bx-reset", right);
        reset.appendChild(icon("RotateCcw", 13));
        reset.appendChild(document.createTextNode(" Reset"));
        reset.title = "Clear every filter on this page";
        reset.onclick = () => { this.drawer = ""; this.tables.forEach(t => { t.search = ""; }); this.setFilters({}); };
    }
    private filterBar(defs: FilterDef[], withPeriod = true): HTMLElement {
        const bar = this.el("div", "bx-filters", this.body);
        if (withPeriod) {
            const all = monthRange("2026-01", "2026-12");
            const cell = this.el("label", "bx-filter bx-period", bar);
            const lab = this.el("span", "bx-filter-label", cell);
            lab.appendChild(icon("CalendarRange", 12));
            lab.appendChild(document.createTextNode(" Period"));
            const row = this.el("div", "bx-period-row", cell);
            this.select(row, all.map(m => ({ value: m, label: this.monthLabel(m) })), this.filters.from ?? "", "From", v => this.setFilters({ ...this.filters, from: v }));
            this.el("span", "bx-period-sep", row, "→");
            this.select(row, all.map(m => ({ value: m, label: this.monthLabel(m) })), this.filters.to ?? "", "To", v => this.setFilters({ ...this.filters, to: v }));
        }
        defs.forEach(def => {
            const cell = this.el("label", "bx-filter", bar);
            if (def.width) { cell.style.width = `${def.width}px`; }
            this.el("span", "bx-filter-label", cell, def.label);
            this.select(cell, def.options.map(o => ({ value: o, label: o })), this.filters[def.key] ?? "", "All", v => this.setFilters({ ...this.filters, [def.key]: v }));
        });
        return bar;
    }

    /** Segmented buttons inside the filter bar (view presets, metric switch). */
    private segmented(bar: HTMLElement, label: string, options: Array<{ key: string; label: string; active: boolean; apply: () => void; title?: string }>): void {
        const cell = this.el("div", "bx-filter bx-seg-cell", bar);
        this.el("span", "bx-filter-label", cell, label);
        const row = this.el("div", "bx-seg", cell);
        options.forEach(o => {
            const b = this.el("button", `bx-seg-btn ${o.active ? "bx-seg-on" : ""}`, row, o.label);
            if (o.title) { b.title = o.title; }
            b.onclick = () => o.apply();
        });
    }

    private select(parent: HTMLElement, options: Array<{ value: string; label: string }>, value: string, allLabel: string, onChange: (v: string) => void): void {
        const select = this.el("select", "bx-select", parent) as HTMLSelectElement;
        const first = this.el("option", "", select, allLabel) as HTMLOptionElement;
        first.value = "";
        options.forEach(o => { const opt = this.el("option", "", select, o.label) as HTMLOptionElement; opt.value = o.value; });
        select.value = value;
        if (value) { select.classList.add("bx-select-on"); }
        select.onchange = () => onChange(select.value);
    }

    private kpis(cards: Kpi[]): void {
        const row = this.el("div", "bx-kpis", this.body);
        const months = periodMonths(this.lookup, this.filters);
        cards.forEach((k, i) => {
            const card = this.el("div", `bx-kpi ${k.tone ?? ""} ${k.pulse ? "bx-kpi-alert" : ""}`, row);
            card.style.animationDelay = `${i * 70}ms`;
            const top = this.el("div", "bx-kpi-top", card);
            const ic = this.el("span", "bx-kpi-icon", top);
            ic.appendChild(icon(k.icon, 13));
            this.el("span", "bx-kpi-label", top, k.label);
            if (k.pulse) { this.el("span", "bx-alert-dot", top); }
            const mid = this.el("div", "bx-kpi-mid", card);
            const value = this.el("div", "bx-kpi-value", mid, k.value);
            if (k.num !== undefined && k.num !== null && k.fmt) { this.countUps.push({ el: value, target: k.num, fmt: k.fmt }); }
            if (k.ring !== undefined) { mid.appendChild(this.ring(k.ring, k.ringColor ?? NEON.cyan)); }
            const foot = this.el("div", "bx-kpi-foot", card);
            const d = k.spark ? this.delta(months, k.spark, k.deltaMode ?? "pct") : null;
            if (d) {
                const good = d.value === 0 ? null : (d.value > 0) === (k.upIsGood ?? true);
                const pill = this.el("span", `bx-delta ${good === null ? "" : good ? "bx-delta-good" : "bx-delta-bad"}`, foot, `${d.value > 0 ? "▲" : d.value < 0 ? "▼" : "■"} ${d.text}`);
                pill.title = `Change ${d.label} (last complete month vs the month before)`;
            }
            if (k.note) { this.el("span", "bx-kpi-note", foot, d ? `${d.label} · ${k.note}` : k.note); }
            if (k.spark && k.spark.length > 1) { card.appendChild(this.spark(k.spark)); }
        });
    }

    /** Change of the last COMPLETE month of the period vs the month before (November 2026 is partial). */
    private delta(months: string[], series: number[], mode: "pct" | "pts"): { value: number; text: string; label: string } | null {
        const ref = this.data.ref;
        const refMonth = month(ref);
        const lastDay = new Date(Date.UTC(Number(ref.slice(0, 4)), Number(ref.slice(5, 7)), 0)).getUTCDate();
        const complete = (m: string): boolean => m < refMonth || (m === refMonth && Number(ref.slice(8, 10)) === lastDay);
        let i = months.length - 1;
        while (i >= 0 && !complete(months[i])) { i--; }
        if (i < 1) { return null; }
        const cur = series[i], prev = series[i - 1];
        if (cur === null || prev === null || cur === undefined || prev === undefined) { return null; }
        const short = (m: string): string => MONTHS[Number(m.slice(5, 7)) - 1];
        const label = `${short(months[i])} vs ${short(months[i - 1])}`;
        if (mode === "pts") { const v = (cur - prev) * 100; return { value: v, text: `${Math.abs(v).toFixed(1)} pts`, label }; }
        if (!prev) { return null; }
        const v = (cur - prev) / Math.abs(prev);
        return { value: v, text: `${Math.abs(v * 100).toFixed(1)}%`, label };
    }

    private spark(series: number[]): SVGElement {
        const ns = "http://www.w3.org/2000/svg";
        const w = 120, h = 22;
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.setAttribute("preserveAspectRatio", "none");
        svg.setAttribute("class", "bx-spark");
        const vals = series.map(v => v || 0);
        const min = Math.min(...vals), max = Math.max(...vals);
        const pts = vals.map((v, i) => [i * (w / Math.max(1, vals.length - 1)), h - 2 - ((v - min) / (max - min || 1)) * (h - 4)]);
        const area = document.createElementNS(ns, "path");
        area.setAttribute("d", `M0,${h} ` + pts.map(p => `L${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ") + ` L${w},${h} Z`);
        area.setAttribute("class", "bx-spark-area");
        svg.appendChild(area);
        const line = document.createElementNS(ns, "polyline");
        line.setAttribute("points", pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" "));
        line.setAttribute("class", "bx-spark-line");
        svg.appendChild(line);
        return svg;
    }

    private ring(share: number | null, color: string, size = 44): SVGElement {
        const ns = "http://www.w3.org/2000/svg";
        const r = size / 2 - 5, c = 2 * Math.PI * r;
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
        svg.setAttribute("width", String(size));
        svg.setAttribute("height", String(size));
        svg.setAttribute("class", "bx-ring");
        const track = document.createElementNS(ns, "circle");
        track.setAttribute("cx", String(size / 2)); track.setAttribute("cy", String(size / 2)); track.setAttribute("r", String(r));
        track.setAttribute("class", "bx-ring-track");
        svg.appendChild(track);
        const arc = document.createElementNS(ns, "circle");
        arc.setAttribute("cx", String(size / 2)); arc.setAttribute("cy", String(size / 2)); arc.setAttribute("r", String(r));
        arc.setAttribute("class", "bx-ring-arc");
        arc.setAttribute("stroke", color);
        arc.setAttribute("stroke-dasharray", c.toFixed(2));
        const target = c * (1 - Math.max(0, Math.min(1, share ?? 0)));
        arc.style.setProperty("--ring-from", c.toFixed(2));
        arc.style.setProperty("--ring-to", target.toFixed(2));
        arc.setAttribute("stroke-dashoffset", target.toFixed(2));
        arc.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
        svg.appendChild(arc);
        return svg;
    }

    /** Count-up of KPI values on first display (page or data change), 900 ms ease-out. */
    private runCountUps(animate: boolean): void {
        const items = this.countUps;
        if (!animate || !items.length) { return; }
        const start = performance.now();
        items.forEach(it => { it.el.textContent = it.fmt(0); });
        const step = (now: number): void => {
            const t = Math.min(1, (now - start) / 900);
            const e = 1 - Math.pow(1 - t, 3);
            items.forEach(it => { if (it.el.isConnected) { it.el.textContent = it.fmt(it.target * e); } });
            if (t < 1) { window.requestAnimationFrame(step); } else { items.forEach(it => { it.el.textContent = it.fmt(it.target); }); }
        };
        window.requestAnimationFrame(step);
    }

    /** Overview centrepiece: four real ratios as concentric animated rings around the revenue figure. */
    private healthCore(body: HTMLElement, center: { value: string; label: string }, rings: Array<{ label: string; value: number | null; color: string; text: string; note: string }>): void {
        const wrap = this.el("div", "bx-core", body);
        const ns = "http://www.w3.org/2000/svg";
        const size = 190;
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
        svg.setAttribute("class", "bx-core-svg");
        const mid = size / 2;
        // technical ticks around the outside
        for (let i = 0; i < 60; i++) {
            const a = (i / 60) * Math.PI * 2;
            const r1 = 90, r2 = i % 5 === 0 ? 84 : 87;
            const tick = document.createElementNS(ns, "line");
            tick.setAttribute("x1", (mid + r1 * Math.cos(a)).toFixed(1)); tick.setAttribute("y1", (mid + r1 * Math.sin(a)).toFixed(1));
            tick.setAttribute("x2", (mid + r2 * Math.cos(a)).toFixed(1)); tick.setAttribute("y2", (mid + r2 * Math.sin(a)).toFixed(1));
            tick.setAttribute("class", i % 5 === 0 ? "bx-tick bx-tick-major" : "bx-tick");
            svg.appendChild(tick);
        }
        rings.forEach((rg, i) => {
            const r = 74 - i * 13, c = 2 * Math.PI * r;
            const track = document.createElementNS(ns, "circle");
            track.setAttribute("cx", String(mid)); track.setAttribute("cy", String(mid)); track.setAttribute("r", String(r));
            track.setAttribute("class", "bx-core-track");
            svg.appendChild(track);
            const arc = document.createElementNS(ns, "circle");
            arc.setAttribute("cx", String(mid)); arc.setAttribute("cy", String(mid)); arc.setAttribute("r", String(r));
            arc.setAttribute("class", "bx-core-arc");
            arc.setAttribute("stroke", rg.color);
            arc.setAttribute("stroke-dasharray", c.toFixed(2));
            const target = c * (1 - Math.max(0, Math.min(1, rg.value ?? 0)));
            arc.style.setProperty("--ring-from", c.toFixed(2));
            arc.style.setProperty("--ring-to", target.toFixed(2));
            arc.style.animationDelay = `${150 + i * 120}ms`;
            arc.setAttribute("stroke-dashoffset", target.toFixed(2));
            arc.setAttribute("transform", `rotate(-90 ${mid} ${mid})`);
            const title = document.createElementNS(ns, "title");
            title.textContent = `${rg.label}: ${rg.text}`;
            arc.appendChild(title);
            svg.appendChild(arc);
        });
        const dial = this.el("div", "bx-core-dial", wrap);
        dial.appendChild(svg);
        const c = this.el("div", "bx-core-center", dial);
        this.el("div", "bx-core-value", c, center.value);
        this.el("div", "bx-core-label", c, center.label);
        const legend = this.el("div", "bx-core-legend", wrap);
        rings.forEach(rg => {
            const row = this.el("div", "bx-core-row", legend);
            const dot = this.el("span", "bx-core-dot", row);
            dot.style.background = rg.color;
            dot.style.boxShadow = `0 0 8px ${rg.color}`;
            const t = this.el("div", "", row);
            this.el("div", "bx-core-name", t, rg.label);
            this.el("div", "bx-core-note", t, rg.note);
            const v = this.el("div", "bx-core-val", row, rg.text);
            v.style.color = rg.color;
        });
    }
    private grid(columns: string, rowClass = "bx-row"): HTMLElement {
        const row = this.el("div", rowClass, this.body);
        row.style.gridTemplateColumns = columns;
        return row;
    }

    private card(parent: HTMLElement, title: string, subtitle: string, iconName: IconName): HTMLElement {
        const card = this.el("div", "bx-card", parent);
        const head = this.el("div", "bx-card-head", card);
        const t = this.el("div", "bx-card-title", head);
        t.appendChild(icon(iconName, 14));
        t.appendChild(document.createTextNode(" " + title));
        if (subtitle) { this.el("div", "bx-card-sub", head, subtitle); }
        return this.el("div", "bx-card-body", card);
    }

    // ---------- monthly series for sparklines (aligned with the period's months) ----------

    private series<T>(rows: T[], date: (r: T) => string, value: (r: T) => number): number[] {
        return periodMonths(this.lookup, this.filters).map(m => sum(rows.filter(r => month(date(r)) === m), value));
    }

    private ratioSeries<T>(rows: T[], date: (r: T) => string, num: (r: T) => number, den: (r: T) => number): number[] {
        return periodMonths(this.lookup, this.filters).map(m => { const g = rows.filter(r => month(date(r)) === m); return divide(sum(g, num), sum(g, den)) ?? 0; });
    }

    // ---------- pages ----------

    private renderOverview(): void {
        const L = this.lookup, f = this.filters, ref = this.data.ref;
        const bar = this.filterBar([{ key: "dept", label: "Department", options: this.deptNames() }]);
        const view = f.view || "executive";
        this.segmented(bar, "View (saved preset)", [
            { key: "executive", label: "Executive", active: view === "executive", title: "All departments, revenue & profit trend", apply: () => this.setFilters({ ...f, view: "executive", dept: "", metric: "" }) },
            { key: "sales", label: "Sales", active: view === "sales", title: "Sales department, cash collection trend", apply: () => this.setFilters({ ...f, view: "sales", dept: "Sales", metric: "cash" }) },
            { key: "operations", label: "Operations", active: view === "operations", title: "All departments, transactions & units trend (operations focus)", apply: () => this.setFilters({ ...f, view: "operations", dept: "", metric: "volume" }) }
        ]);
        const metric = f.metric || "revenue";
        this.segmented(bar, "Trend metric", [
            { key: "revenue", label: "Revenue & profit", active: metric === "revenue", apply: () => this.setFilters({ ...f, metric: "" }) },
            { key: "cash", label: "Collected vs receivables", active: metric === "cash", apply: () => this.setFilters({ ...f, metric: "cash" }) },
            { key: "volume", label: "Transactions & units", active: metric === "volume", apply: () => this.setFilters({ ...f, metric: "volume" }) }
        ]);
        const s = salesKpis(filterSales(L, f));
        const t = targetKpis(filterTargets(L, f));
        const x = expenseKpis(filterExpenses(L, f), L);
        const tasks = filterTasks(L, f);
        const k = taskKpis(tasks, ref);
        const projects = filterProjects(L, f);
        const all = filterSales(L, f);
        const sales = all.filter(notCancelled);
        const exp = filterExpenses(L, f).filter(e => e.st === "Approved");
        const atRisk = projects.filter(p => projectRisk(p, ref)).length;
        this.kpis([
            { label: "Revenue (excl. cancelled)", value: this.compact(s.revenue), num: s.revenue, fmt: v => this.compact(v), note: `${this.int(s.transactions)} transactions`, icon: "CircleDollarSign", spark: this.series(sales, r => r.d, r => r.r) },
            { label: "Profit", value: this.compact(s.profit), num: s.profit, fmt: v => this.compact(v), note: `margin ${this.pct(s.margin)}`, icon: "TrendingUp", tone: "bx-violet", spark: this.series(sales, r => r.d, r => r.pf) },
            { label: "Approved expenses", value: this.compact(x.approved), num: x.approved, fmt: v => this.compact(v), note: `${this.compact(x.pending)} pending`, icon: "Receipt", tone: "bx-blue", spark: this.series(exp, e => e.dt, e => e.a), upIsGood: false },
            { label: "Target achievement", value: this.pct(t.achievement), num: t.achievement, fmt: v => this.pct(v), note: `${t.below} sellers below target`, icon: "Target", tone: this.achTone(t.achievement), ring: t.achievement, ringColor: this.achColor(t.achievement) },
            { label: "Overdue tasks", value: this.int(k.overdue), num: k.overdue, fmt: v => this.int(v), note: `of ${this.int(k.open)} open tasks`, icon: "AlarmClock", tone: k.overdue ? "bx-bad" : "bx-good", ring: k.overdueRate, ringColor: NEON.pink, pulse: k.overdue > 0 },
            { label: "Projects at risk", value: this.int(atRisk), num: atRisk, fmt: v => this.int(v), note: `of ${projects.length} projects`, icon: "ShieldAlert", tone: "bx-warn", ring: divide(atRisk, projects.length), ringColor: NEON.orange, pulse: atRisk > 0 }
        ]);
        const r1 = this.grid("1.25fr 1.15fr 0.8fr");
        const months = periodMonths(L, f);
        const byMonth = (rows: typeof all, pick: (r: typeof all[number]) => number): number[] => months.map(m => sum(rows.filter(r => month(r.d) === m), pick));
        const trend = metric === "cash"
            ? { title: "Collected vs receivables by month", money: true, series: [
                { name: "Collected (Paid)", color: NEON.green, data: byMonth(all.filter(r => r.st === "Paid"), r => r.r) },
                { name: "Receivables (Pending + Overdue)", color: NEON.orange, data: byMonth(all.filter(r => r.st === "Pending" || r.st === "Overdue"), r => r.r) }] }
            : metric === "volume"
                ? { title: "Transactions & units by month", money: false, series: [
                    { name: "Transactions", color: NEON.cyan, data: byMonth(sales, () => 1) },
                    { name: "Units", color: NEON.violet, data: byMonth(sales, r => r.q) }] }
                : { title: "Revenue & profit by month", money: true, series: [
                    { name: "Revenue", color: NEON.cyan, data: byMonth(sales, r => r.r) },
                    { name: "Profit", color: NEON.violet, data: byMonth(sales, r => r.pf) }] };
        this.lineChart(this.card(r1, trend.title, "Click a month to filter the page · switch the metric above", "TrendingUp"), months, trend.series,
            m => this.setFilters({ ...f, from: m, to: m }), trend.money);
        const pk = projectKpis(projects, ref);
        this.healthCore(this.card(r1, "Business health core", "Four real ratios of the current selection", "Gauge"),
            { value: this.compact(s.revenue), label: "revenue" },
            [
                { label: "Target achievement", value: Math.min(1, t.achievement ?? 0), color: this.achColor(t.achievement), text: this.pct(t.achievement), note: "Actual ÷ target (targets file)" },
                { label: "Collection rate", value: s.collectionRate, color: NEON.cyan, text: this.pct(s.collectionRate), note: "Paid ÷ revenue" },
                { label: "Task completion", value: k.completion, color: NEON.violet, text: this.pct(k.completion), note: `${k.done} of ${k.tasks} tasks done` },
                { label: "Budget used", value: pk.utilization, color: this.utilColor(pk.utilization), text: this.pct(pk.utilization), note: "Project cost ÷ budget" }
            ]);
        this.donut(this.card(r1, "Projects by status", "Owning department filter applies", "FolderKanban"),
            groupBy(projects, p => p.st).map(g => ({ name: g.key, value: g.rows.length, color: STATUS_COLORS[g.key] })), String(projects.length), "projects");
        const r2 = this.grid("0.8fr 0.9fr 1.55fr");
        this.bars(this.card(r2, "Revenue by region", "Click a bar to filter", "MapPin"),
            groupBy(sales, r => r.rg).map(g => ({ name: g.key, value: sum(g.rows, r => r.r), tip: [{ label: "Transactions", value: this.int(g.rows.length) }] })),
            v => this.compact(v), p => this.toggle("region", p.name), f.region);
        this.bars(this.card(r2, "Approved expenses by department", "Click a department to drill through", "Building"),
            groupBy(exp, e => L.deptName(e.d)).map(g => ({ name: g.key, value: sum(g.rows, e => e.a), color: NEON.gold, tip: [{ label: "Claims", value: this.int(g.rows.length) }] })),
            v => this.compact(v), p => { this.drawer = p.name; this.render(); });
        this.riskTable(this.card(r2, "Top risks: projects over budget or past deadline", `As of ${this.longDate(ref)}`, "ShieldAlert"), projects);
    }
    private renderSales(): void {
        const L = this.lookup, f = this.filters;
        const sellers = distinct(this.data.sales.map(s => L.empName(s.s)));
        const bar = this.filterBar([
            { key: "seller", label: "Seller", options: sellers },
            { key: "category", label: "Product category", options: distinct(this.data.products.map(p => p.c)) },
            { key: "payment", label: "Payment status", options: distinct(this.data.sales.map(s => s.st)) },
            { key: "region", label: "Region", options: distinct(this.data.sales.map(s => s.rg)) }
        ]);
        const change = Number(f.whatIfTarget || 0) / 100;
        const commission = Number(f.commission || 0) / 100;
        const whatIf = this.el("div", "bx-filter bx-whatif", bar);
        this.el("span", "bx-filter-label", whatIf, "What-if (simulation, not saved)");
        const wrow = this.el("div", "bx-period-row", whatIf);
        this.select(wrow, [-30, -20, -10, -5, 5, 10, 20, 30].map(v => ({ value: String(v), label: `Target ${v > 0 ? "+" : ""}${v}%` })), f.whatIfTarget ?? "", "Target ±0%", v => this.setFilters({ ...f, whatIfTarget: v }));
        this.select(wrow, [1, 2, 3, 5, 7.5, 10].map(v => ({ value: String(v), label: `Commission ${v}%` })), f.commission ?? "", "Commission 0%", v => this.setFilters({ ...f, commission: v }));
        const rows = filterSales(L, f);
        const s = salesKpis(rows);
        const targets = filterTargets(L, f);
        const simTarget = (t: number): number => t * (1 + change);
        this.kpis([
            { label: "Revenue", value: this.compact(s.revenue), num: s.revenue, fmt: v => this.compact(v), note: commission ? `commission at ${this.pct(commission)}: ${this.compact(s.revenue * commission)}` : `gross ${this.compact(s.gross)}`, icon: "CircleDollarSign", spark: this.series(rows.filter(notCancelled), r => r.d, r => r.r) },
            { label: "Profit margin", value: this.pct(s.margin), num: s.margin, fmt: v => this.pct(v), note: `profit ${this.compact(s.profit)}`, icon: "Percent", tone: "bx-violet", spark: this.ratioSeries(rows.filter(notCancelled), r => r.d, r => r.pf, r => r.r), deltaMode: "pts" },
            { label: "Transactions", value: this.int(s.transactions), num: s.transactions, fmt: v => this.int(v), note: `${this.int(s.units)} units`, icon: "Receipt", tone: "bx-blue", spark: this.series(rows.filter(notCancelled), r => r.d, () => 1) },
            { label: "Average order value", value: this.compact(s.aov), num: s.aov, fmt: v => this.compact(v), note: `discount ${this.pct(s.discount)}`, icon: "ShoppingCart", spark: this.ratioSeries(rows.filter(notCancelled), r => r.d, r => r.r, () => 1) },
            { label: "Collection rate", value: this.pct(s.collectionRate), num: s.collectionRate, fmt: v => this.pct(v), note: `receivables ${this.compact(s.receivables)}`, icon: "Banknote", tone: "bx-good", ring: s.collectionRate, ringColor: NEON.green },
            { label: "Cancellation rate", value: this.pct(s.cancellationRate), num: s.cancellationRate, fmt: v => this.pct(v), note: `${this.compact(s.cancelled)} cancelled`, icon: "Ban", tone: "bx-bad", ring: s.cancellationRate, ringColor: NEON.pink }
        ]);
        const r1 = this.grid("1fr 1.35fr 0.9fr");
        const kept = rows.filter(notCancelled);
        const bySeller = groupBy(kept, r => L.empName(r.s)).map(g => {
            const tk = targetKpis(targets.filter(t => L.empName(t.e) === g.key));
            const ach = divide(tk.actual, simTarget(tk.target));
            return { name: g.key, value: sum(g.rows, r => r.r), color: this.achColor(ach), tip: [{ label: "Target achievement", value: this.pct(tk.achievement) }, { label: "Transactions", value: this.int(g.rows.length) }] };
        });
        this.bars(this.card(r1, "Seller ranking", "Bar colour = target achievement (pink < 90 %, amber < 100 %)", "Trophy"), bySeller, v => this.compact(v), p => this.toggle("seller", p.name), f.seller);
        const tMonths = distinct(targets.map(t => month(t.m)));
        this.combo(this.card(r1, change ? `Monthly target (what-if ${change > 0 ? "+" : ""}${this.pct(change)}) vs actual` : "Monthly target vs actual (targets file)", "Achievement is recalculated from the sums, never averaged", "Target"), tMonths,
            tMonths.map(m => simTarget(sum(targets.filter(t => month(t.m) === m), t => t.t))), tMonths.map(m => sum(targets.filter(t => month(t.m) === m), t => t.a)));
        this.donut(this.card(r1, "Gross revenue by payment status", "Click a status to filter", "Banknote"),
            groupBy(rows, r => r.st).map(g => ({ name: g.key, value: sum(g.rows, r => r.r), color: STATUS_COLORS[g.key] })), this.compact(s.gross), "gross",
            p => this.toggle("payment", p.name));
        const r2 = this.grid("1fr 1.9fr");
        this.bars(this.card(r2, "Revenue by product", "Click a product to filter", "Package"),
            groupBy(kept, r => L.prod.get(r.p)?.n ?? r.p).map(g => ({ name: g.key, value: sum(g.rows, r => r.r), color: NEON.blue, tip: [{ label: "Units", value: this.int(sum(g.rows, r => r.q)) }] })),
            v => this.compact(v), p => this.toggle("product", p.name), f.product);
        const scoreRows = sellers.map(name => {
            const sk = salesKpis(rows.filter(r => L.empName(r.s) === name));
            const tk = targetKpis(targets.filter(t => L.empName(t.e) === name));
            const target = simTarget(tk.target);
            return { name, revenue: sk.revenue, tx: sk.transactions, margin: sk.margin, target, actual: tk.actual, ach: divide(tk.actual, target), gap: tk.actual - target, commission: sk.revenue * commission };
        }).filter(r => r.revenue || r.target);
        this.table(this.card(r2, "Seller scorecard", "Target columns come from targets.csv (separate planning data)", "Users"), "sellers", [
            { key: "name", label: "Seller", value: r => r.name },
            { key: "revenue", label: "Revenue", value: r => r.revenue, format: r => this.money(r.revenue), align: "right" },
            { key: "tx", label: "Transactions", value: r => r.tx, align: "right" },
            { key: "margin", label: "Margin", value: r => r.margin, format: r => this.pct(r.margin), align: "right" },
            { key: "target", label: change ? `Target (${change > 0 ? "+" : ""}${this.pct(change)})` : "Target", value: r => r.target, format: r => this.money(r.target), align: "right" },
            { key: "actual", label: "Actual (targets)", value: r => r.actual, format: r => this.money(r.actual), align: "right" },
            { key: "ach", label: "Achievement", value: r => r.ach, format: r => this.pct(r.ach), align: "right", color: r => this.achColor(r.ach) },
            { key: "gap", label: "Gap to target", value: r => r.gap, format: r => this.signedMoney(r.gap), align: "right", color: r => (r.gap < 0 ? NEON.pink : NEON.green) },
            { key: "commission", label: `Commission ${this.pct(commission)}`, value: r => r.commission, format: r => this.money(r.commission), align: "right", color: () => NEON.violet }
        ], scoreRows, { sort: "revenue", search: false, csv: "seller_scorecard", onRow: r => this.toggle("seller", r.name), isActive: r => f.seller === r.name });
    }

    private renderPeople(): void {
        const L = this.lookup, f = this.filters;
        this.filterBar([
            { key: "dept", label: "Department", options: this.deptNames() },
            { key: "city", label: "Employee city", options: distinct(this.data.employees.map(e => e.c)) },
            { key: "estatus", label: "Employment status", options: distinct(this.data.employees.map(e => e.s)) },
            { key: "leaveType", label: "Leave type", options: distinct(this.data.leave.map(l => l.t)) }
        ]);
        const emps = filterEmployees(L, f);
        const leave = filterLeave(L, f);
        const p = peopleKpis(emps);
        const l = leaveKpis(leave);
        this.kpis([
            { label: "Employees", value: this.int(p.employees), num: p.employees, fmt: v => this.int(v), note: "headcount, all statuses", icon: "Users", ring: divide(p.employees, this.data.employees.length), ringColor: NEON.cyan },
            { label: "Active", value: this.int(p.active), num: p.active, fmt: v => this.int(v), note: this.pct(divide(p.active, p.employees)) + " of headcount", icon: "UserCheck", tone: "bx-good", ring: divide(p.active, p.employees), ringColor: NEON.green },
            { label: "On leave (status)", value: this.int(p.onLeave), num: p.onLeave, fmt: v => this.int(v), note: "employment_status", icon: "Plane", tone: "bx-warn", ring: divide(p.onLeave, p.employees), ringColor: NEON.orange },
            { label: "Leave requests", value: this.int(l.requests), num: l.requests, fmt: v => this.int(v), note: `${this.int(l.days)} calendar days`, icon: "ScrollText", tone: "bx-blue", spark: this.series(leave, x => x.sd, () => 1), upIsGood: false },
            { label: "Approved leave days", value: this.int(l.approvedDays), num: l.approvedDays, fmt: v => this.int(v), note: `${this.int(l.pendingDays)} days waiting`, icon: "Check", tone: "bx-violet", spark: this.series(leave.filter(x => x.st === "Approved"), x => x.sd, x => x.w) },
            { label: "Leave approval rate", value: this.pct(l.approvalRate), num: l.approvalRate, fmt: v => this.pct(v), note: "approved ÷ decided", icon: "Scale", ring: l.approvalRate, ringColor: NEON.gold }
        ]);
        const r1 = this.grid("1fr 1fr 1fr");
        this.bars(this.card(r1, "Headcount by department", "Click a department to drill through", "Building"),
            groupBy(emps, e => L.deptName(e.d)).map(g => ({ name: g.key, value: g.rows.length, tip: [{ label: "Active", value: this.int(g.rows.filter(e => e.s === "Active").length) }] })),
            v => this.int(v), b => { this.drawer = b.name; this.render(); });
        this.bars(this.card(r1, "Headcount by job title", "Click a title to filter", "Briefcase"),
            groupBy(emps, e => e.j).map(g => ({ name: g.key, value: g.rows.length, color: NEON.violet, tip: [] })), v => this.int(v), b => this.toggle("job", b.name), f.job);
        this.donut(this.card(r1, "Leave days by type", "Calendar days (weekends included, as supplied)", "Plane"),
            groupBy(leave, x => x.t).map((g, i) => ({ name: g.key, value: sum(g.rows, x => x.w), color: SERIES[i % SERIES.length] })), this.int(l.days), "days",
            b => this.toggle("leaveType", b.name));
        const r2 = this.grid("1fr 1.35fr");
        const months = periodMonths(L, f);
        const statuses = ["Approved", "Submitted", "Rejected"];
        this.stacked(this.card(r2, "Leave days by start month and status", "", "CalendarRange"), months,
            statuses.map(st => ({ name: st, color: STATUS_COLORS[st], data: months.map(m => sum(leave.filter(x => x.st === st && month(x.sd) === m), x => x.w)) })));
        this.table(this.card(r2, "Employee directory", "No salary data is shown (data minimisation)", "Users"), "directory", [
            { key: "n", label: "Employee", value: (e: Employee) => e.n },
            { key: "d", label: "Department", value: (e: Employee) => L.deptName(e.d) },
            { key: "j", label: "Job title", value: (e: Employee) => e.j },
            { key: "c", label: "City", value: (e: Employee) => e.c },
            { key: "s", label: "Status", value: (e: Employee) => e.s, color: (e: Employee) => STATUS_COLORS[e.s] },
            { key: "e", label: "Email", value: (e: Employee) => e.e, color: (e: Employee) => (e.x ? NEON.amber : undefined) }
        ], emps, { sort: "n", asc: true, search: true, csv: "employee_directory", note: "Amber email = shared by two employees (data quality)" });
    }

    private renderProjects(): void {
        const L = this.lookup, f = this.filters, ref = this.data.ref;
        this.filterBar([
            { key: "dept", label: "Owning department", options: distinct(this.data.projects.map(p => L.deptName(p.d))) },
            { key: "pm", label: "Project manager", options: distinct(this.data.projects.map(p => L.empName(p.pm))) },
            { key: "pstatus", label: "Project status", options: distinct(this.data.projects.map(p => p.st)) },
            { key: "ppriority", label: "Priority", options: distinct(this.data.projects.map(p => p.pr)) }
        ], false);
        const projects = filterProjects(L, f);
        const k = projectKpis(projects, ref);
        this.kpis([
            { label: "Projects", value: this.int(k.projects), num: k.projects, fmt: v => this.int(v), note: "budget & cost are lifetime", icon: "FolderKanban", ring: divide(k.projects, this.data.projects.length), ringColor: NEON.cyan },
            { label: "Budget", value: this.compact(k.budget), num: k.budget, fmt: v => this.compact(v), note: "sum of project budgets", icon: "Landmark", tone: "bx-blue" },
            { label: "Actual cost", value: this.compact(k.cost), num: k.cost, fmt: v => this.compact(v), note: `variance ${this.signedCompact(k.variance)}`, icon: "Wallet", tone: "bx-violet" },
            { label: "Budget used", value: this.pct(k.utilization), num: k.utilization, fmt: v => this.pct(v), note: "actual ÷ budget", icon: "Gauge", tone: this.utilTone(k.utilization), ring: k.utilization, ringColor: this.utilColor(k.utilization) },
            { label: "Over budget", value: this.int(k.overBudget), num: k.overBudget, fmt: v => this.int(v), note: "actual cost > budget", icon: "TriangleAlert", tone: k.overBudget ? "bx-bad" : "bx-good", ring: divide(k.overBudget, k.projects), ringColor: NEON.pink, pulse: k.overBudget > 0 },
            { label: "Past deadline", value: this.int(k.pastDeadline), num: k.pastDeadline, fmt: v => this.int(v), note: `not completed, < ${this.longDate(ref)}`, icon: "Hourglass", tone: k.pastDeadline ? "bx-warn" : "bx-good", ring: divide(k.pastDeadline, k.projects), ringColor: NEON.orange }
        ]);
        const r1 = this.grid("1.6fr 0.85fr 1fr");
        this.pairBars(this.card(r1, "Budget vs actual cost by project", "Pink actual = over budget", "Scale"), projects);
        this.donut(this.card(r1, "Projects by status", "Click a status to filter", "ChartPie"),
            groupBy(projects, p => p.st).map(g => ({ name: g.key, value: g.rows.length, color: STATUS_COLORS[g.key] })), String(projects.length), "projects",
            b => this.toggle("pstatus", b.name));
        this.bars(this.card(r1, "Budget used by project manager", "Pink > 100 %, amber > 90 %", "UserCheck"),
            groupBy(projects, p => L.empName(p.pm)).map(g => {
                const u = divide(sum(g.rows, p => p.ac), sum(g.rows, p => p.b));
                return { name: g.key, value: (u ?? 0) * 100, color: this.utilColor(u), label: this.pct(u), tip: [{ label: "Projects", value: this.int(g.rows.length) }] };
            }), v => `${v.toFixed(0)}%`, b => this.toggle("pm", b.name), f.pm);
        const r2 = this.grid("1fr");
        this.table(this.card(r2, `Project portfolio · ${f.dept || "all departments"}`, "Click a project to see its tasks on Task Operations filters", "FolderKanban"), "projects", [
            { key: "n", label: "Project", value: (p: Project) => p.n },
            { key: "pm", label: "Manager", value: (p: Project) => L.empName(p.pm) },
            { key: "d", label: "Department", value: (p: Project) => L.deptName(p.d) },
            { key: "st", label: "Status", value: (p: Project) => p.st, color: (p: Project) => STATUS_COLORS[p.st] },
            { key: "pr", label: "Priority", value: (p: Project) => p.pr },
            { key: "sd", label: "Start", value: (p: Project) => p.sd },
            { key: "dl", label: "Deadline", value: (p: Project) => p.dl, color: (p: Project) => (isPastDeadline(p, ref) ? NEON.amber : undefined) },
            { key: "b", label: "Budget", value: (p: Project) => p.b, format: (p: Project) => this.money(p.b), align: "right" },
            { key: "ac", label: "Actual cost", value: (p: Project) => p.ac, format: (p: Project) => this.money(p.ac), align: "right" },
            { key: "v", label: "Variance", value: (p: Project) => p.b - p.ac, format: (p: Project) => this.signedMoney(p.b - p.ac), align: "right", color: (p: Project) => (p.b - p.ac < 0 ? NEON.pink : NEON.green) },
            { key: "u", label: "Used", value: (p: Project) => divide(p.ac, p.b), format: (p: Project) => this.pct(divide(p.ac, p.b)), align: "right", color: (p: Project) => this.utilColor(divide(p.ac, p.b)) },
            { key: "risk", label: "Risk", value: (p: Project) => projectRisk(p, ref), color: () => NEON.pink }
        ], projects, { sort: "u", search: true, csv: "project_portfolio" });
    }

    private renderTasks(): void {
        const L = this.lookup, f = this.filters, ref = this.data.ref;
        this.filterBar([
            { key: "dept", label: "Assignee department", options: this.deptNames() },
            { key: "project", label: "Project", options: distinct(this.data.projects.map(p => p.n)), width: 170 },
            { key: "tpriority", label: "Priority", options: PRIORITY_ORDER },
            { key: "tstatus", label: "Task status", options: distinct(this.data.tasks.map(t => t.st)) }
        ]);
        const tasks = filterTasks(L, f);
        const k = taskKpis(tasks, ref);
        this.kpis([
            { label: "Tasks", value: this.int(k.tasks), num: k.tasks, fmt: v => this.int(v), note: "by due month", icon: "ClipboardList", spark: this.series(tasks, t => t.dd, () => 1) },
            { label: "Open", value: this.int(k.open), num: k.open, fmt: v => this.int(v), note: "To Do, In Progress, Blocked", icon: "ListChecks", tone: "bx-blue", ring: divide(k.open, k.tasks), ringColor: NEON.blue },
            { label: "Overdue", value: this.int(k.overdue), num: k.overdue, fmt: v => this.int(v), note: `due before ${this.longDate(ref)}`, icon: "AlarmClock", tone: k.overdue ? "bx-bad" : "bx-good", ring: k.overdueRate, ringColor: NEON.pink, pulse: k.overdue > 0 },
            { label: "Blocked", value: this.int(k.blocked), num: k.blocked, fmt: v => this.int(v), note: "need unblocking", icon: "Ban", tone: "bx-warn", ring: divide(k.blocked, k.tasks), ringColor: NEON.orange },
            { label: "Completion rate", value: this.pct(k.completion), num: k.completion, fmt: v => this.pct(v), note: `${this.int(k.done)} done`, icon: "Check", tone: "bx-good", ring: k.completion, ringColor: NEON.green },
            { label: "Avg days overdue", value: k.avgDaysOverdue === null ? "—" : k.avgDaysOverdue.toFixed(1), num: k.avgDaysOverdue, fmt: v => v.toFixed(1), note: "for overdue tasks", icon: "Hourglass", tone: "bx-violet" }
        ]);
        const r1 = this.grid("0.8fr 1.2fr 1.1fr");
        this.bars(this.card(r1, "Tasks by status", "Click a status to filter", "ChartBar"),
            groupBy(tasks, t => t.st).map(g => ({ name: g.key, value: g.rows.length, color: STATUS_COLORS[g.key], tip: [] })), v => this.int(v), b => this.toggle("tstatus", b.name), f.tstatus);
        this.matrix(this.card(r1, "Priority matrix", "Tasks by priority and status · click a cell to filter", "Layers"), tasks);
        this.bars(this.card(r1, "Workload: open tasks per assignee", "Click a person to filter", "Users"),
            groupBy(tasks.filter(isOpen), t => L.empName(t.a)).map(g => ({ name: g.key, value: g.rows.length, color: NEON.violet, tip: [{ label: "Overdue", value: this.int(g.rows.filter(t => isOverdue(t, ref)).length) }, { label: "Department", value: L.empDept(g.rows[0].a) }] })),
            v => this.int(v), b => this.toggle("assignee", b.name), f.assignee);
        const r2 = this.grid("1fr");
        this.table(this.card(r2, "Overdue tasks", `Open tasks past their due date at ${this.longDate(ref)}`, "AlarmClock"), "overdue", [
            { key: "id", label: "Task", value: (t: Task) => t.id },
            { key: "t", label: "Title", value: (t: Task) => t.t },
            { key: "p", label: "Project", value: (t: Task) => L.projName(t.p) },
            { key: "a", label: "Assignee", value: (t: Task) => L.empName(t.a) },
            { key: "ad", label: "Assignee dept", value: (t: Task) => L.empDept(t.a) },
            { key: "pr", label: "Priority", value: (t: Task) => t.pr, color: (t: Task) => (t.pr === "Critical" ? NEON.pink : t.pr === "High" ? NEON.orange : undefined) },
            { key: "st", label: "Status", value: (t: Task) => t.st, color: (t: Task) => STATUS_COLORS[t.st] },
            { key: "dd", label: "Due", value: (t: Task) => t.dd },
            { key: "days", label: "Days overdue", value: (t: Task) => daysBetween(t.dd, ref), align: "right", color: () => NEON.pink }
        ], tasks.filter(t => isOverdue(t, ref)), { sort: "days", search: true, csv: "overdue_tasks" });
    }

    private renderFinance(): void {
        const L = this.lookup, f = this.filters, ref = this.data.ref;
        this.filterBar([
            { key: "dept", label: "Spending department", options: this.deptNames() },
            { key: "expCategory", label: "Expense category", options: distinct(this.data.expenses.map(e => e.c)) },
            { key: "approval", label: "Approval status", options: distinct(this.data.expenses.map(e => e.st)) }
        ]);
        const rows = filterExpenses(L, f);
        const x = expenseKpis(rows, L);
        const projects = filterProjects(L, { dept: f.dept });
        const pk = projectKpis(projects, ref);
        this.kpis([
            { label: "Approved expenses", value: this.compact(x.approved), num: x.approved, fmt: v => this.compact(v), note: "headline expense figure", icon: "Receipt", spark: this.series(rows.filter(e => e.st === "Approved"), e => e.dt, e => e.a), upIsGood: false },
            { label: "Pending approval", value: this.compact(x.pending), num: x.pending, fmt: v => this.compact(v), note: "pipeline, not yet cost", icon: "Hourglass", tone: "bx-blue", spark: this.series(rows.filter(e => e.st === "Pending"), e => e.dt, e => e.a), upIsGood: false },
            { label: "Rejected", value: this.compact(x.rejected), num: x.rejected, fmt: v => this.compact(v), note: "excluded from totals", icon: "Ban", tone: "bx-bad", spark: this.series(rows.filter(e => e.st === "Rejected"), e => e.dt, e => e.a), upIsGood: false },
            { label: "Approval rate", value: this.pct(x.approvalRate), num: x.approvalRate, fmt: v => this.pct(v), note: "approved ÷ decided value", icon: "Scale", tone: "bx-violet", ring: x.approvalRate, ringColor: NEON.gold },
            { label: "Project budget variance", value: this.signedCompact(pk.variance), num: pk.variance, fmt: v => this.signedCompact(v), note: `${pk.overBudget} projects over budget`, icon: "Landmark", tone: pk.variance < 0 ? "bx-bad" : "bx-good" },
            { label: "Approved, no project", value: this.compact(x.withoutProject), num: x.withoutProject, fmt: v => this.compact(v), note: "department overhead", icon: "Wallet", tone: "bx-warn", ring: divide(x.withoutProject, x.approved), ringColor: NEON.orange }
        ]);
        const r1 = this.grid("1.5fr 1fr 0.95fr");
        const months = periodMonths(L, f);
        this.stacked(this.card(r1, "Expenses submitted by month and approval status", "", "CalendarRange"), months,
            ["Approved", "Pending", "Rejected"].map(st => ({ name: st, color: STATUS_COLORS[st] ?? NEON.amber, data: months.map(m => sum(rows.filter(e => e.st === st && month(e.dt) === m), e => e.a)) })),
            true);
        this.bars(this.card(r1, "Approved expenses by department", "Click to drill through", "Building"),
            groupBy(rows.filter(e => e.st === "Approved"), e => L.deptName(e.d)).map(g => ({ name: g.key, value: sum(g.rows, e => e.a), color: NEON.violet, tip: [{ label: "Claims", value: this.int(g.rows.length) }] })),
            v => this.compact(v), b => { this.drawer = b.name; this.render(); });
        this.donut(this.card(r1, "Approved expenses by category", "Click a category to filter", "Tag"),
            groupBy(rows.filter(e => e.st === "Approved"), e => e.c).map((g, i) => ({ name: g.key, value: sum(g.rows, e => e.a), color: SERIES[i % SERIES.length] })), this.compact(x.approved), "approved",
            b => this.toggle("expCategory", b.name));
        const r2 = this.grid("1fr 1.1fr");
        this.table(this.card(r2, "Project budget variance", "Lifetime budget vs actual cost (projects table)", "Scale"), "variance", [
            { key: "n", label: "Project", value: (p: Project) => p.n },
            { key: "b", label: "Budget", value: (p: Project) => p.b, format: (p: Project) => this.money(p.b), align: "right" },
            { key: "ac", label: "Actual", value: (p: Project) => p.ac, format: (p: Project) => this.money(p.ac), align: "right" },
            { key: "v", label: "Variance", value: (p: Project) => p.b - p.ac, format: (p: Project) => this.signedMoney(p.b - p.ac), align: "right", color: (p: Project) => (p.b - p.ac < 0 ? NEON.pink : NEON.green) },
            { key: "u", label: "Used", value: (p: Project) => divide(p.ac, p.b), format: (p: Project) => this.pct(divide(p.ac, p.b)), align: "right", color: (p: Project) => this.utilColor(divide(p.ac, p.b)) }
        ], projects, { sort: "v", asc: true, search: false });
        this.table(this.card(r2, "Expense lines", "Search any column · amounts in TND", "ScrollText"), "expenses", [
            { key: "id", label: "Expense", value: (e: Expense) => e.id },
            { key: "dt", label: "Date", value: (e: Expense) => e.dt },
            { key: "d", label: "Department", value: (e: Expense) => L.deptName(e.d) },
            { key: "p", label: "Project", value: (e: Expense) => L.projName(e.p), color: (e: Expense) => (e.p ? undefined : NEON.muted) },
            { key: "c", label: "Category", value: (e: Expense) => e.c },
            { key: "st", label: "Status", value: (e: Expense) => e.st, color: (e: Expense) => STATUS_COLORS[e.st] },
            { key: "a", label: "Amount", value: (e: Expense) => e.a, format: (e: Expense) => this.money(e.a), align: "right" }
        ], rows, { sort: "dt", search: true, csv: "expense_lines" });
    }

    private renderCustomers(): void {
        const L = this.lookup, f = this.filters;
        this.filterBar([
            { key: "segment", label: "Customer segment", options: distinct(this.data.customers.map(c => c.g)) },
            { key: "ccity", label: "Customer city", options: distinct(this.data.customers.map(c => c.c)) },
            { key: "category", label: "Product category", options: distinct(this.data.products.map(p => p.c)) },
            { key: "region", label: "Sales region", options: distinct(this.data.sales.map(s => s.rg)) }
        ]);
        const rows = filterSales(L, f);
        const s = salesKpis(rows);
        const kept = rows.filter(notCancelled);
        this.kpis([
            { label: "Revenue", value: this.compact(s.revenue), num: s.revenue, fmt: v => this.compact(v), note: "excluding cancelled", icon: "CircleDollarSign", spark: this.series(kept, r => r.d, r => r.r) },
            { label: "Profit", value: this.compact(s.profit), num: s.profit, fmt: v => this.compact(v), note: `margin ${this.pct(s.margin)}`, icon: "TrendingUp", tone: "bx-violet", spark: this.series(kept, r => r.d, r => r.pf) },
            { label: "Customers with sales", value: this.int(s.customers), num: s.customers, fmt: v => this.int(v), note: `of ${this.data.customers.length} customers`, icon: "Users", tone: "bx-blue", ring: divide(s.customers, this.data.customers.length), ringColor: NEON.cyan },
            { label: "Revenue per customer", value: this.compact(s.revenuePerCustomer), num: s.revenuePerCustomer, fmt: v => this.compact(v), note: "revenue ÷ buying customers", icon: "UserCheck" },
            { label: "Units sold", value: this.int(s.units), num: s.units, fmt: v => this.int(v), note: `${this.int(s.transactions)} transactions`, icon: "Package", tone: "bx-good", spark: this.series(kept, r => r.d, r => r.q) },
            { label: "Average discount", value: this.pct(s.discount), num: s.discount, fmt: v => this.pct(v), note: "weighted by value", icon: "Tag", tone: "bx-warn", ring: s.discount, ringColor: NEON.orange }
        ]);
        const r1 = this.grid("1fr 0.8fr 1.3fr");
        const byCustomer = groupBy(kept, r => L.cust.get(r.c)?.n ?? r.c).map(g => ({ name: g.key, value: sum(g.rows, r => r.r), tip: [{ label: "Segment", value: L.cust.get(g.rows[0].c)?.g ?? "" }, { label: "Transactions", value: this.int(g.rows.length) }] }))
            .sort((a, b) => b.value - a.value).slice(0, 10);
        this.bars(this.card(r1, "Top 10 customers by revenue", "Click a customer to filter", "Trophy"), byCustomer, v => this.compact(v), b => this.toggle("customer", b.name), f.customer);
        this.donut(this.card(r1, "Revenue by segment", "Click a segment to filter", "ChartPie"),
            groupBy(kept, r => L.cust.get(r.c)?.g ?? "").map((g, i) => ({ name: g.key, value: sum(g.rows, r => r.r), color: SERIES[i % SERIES.length] })), this.compact(s.revenue), "revenue",
            b => this.toggle("segment", b.name));
        const products = groupBy(kept, r => L.prod.get(r.p)?.n ?? r.p).map(g => {
            const k = salesKpis(g.rows);
            return { name: g.key, category: L.prod.get(g.rows[0].p)?.c ?? "", revenue: k.revenue, profit: k.profit, margin: k.margin, units: k.units };
        }).sort((a, b) => b.revenue - a.revenue);
        this.dualBars(this.card(r1, "Revenue and profit by product", "", "Package"), products.map(p => p.name), products.map(p => p.revenue), products.map(p => p.profit));
        const r2 = this.grid("1fr 1.1fr");
        this.scatter(this.card(r2, "Products: revenue vs margin", "Bubble size = units sold", "TrendingUp"), products);
        this.table(this.card(r2, "Product performance", "", "Package"), "products", [
            { key: "name", label: "Product", value: r => r.name },
            { key: "category", label: "Category", value: r => r.category },
            { key: "units", label: "Units", value: r => r.units, align: "right" },
            { key: "revenue", label: "Revenue", value: r => r.revenue, format: r => this.money(r.revenue), align: "right" },
            { key: "profit", label: "Profit", value: r => r.profit, format: r => this.money(r.profit), align: "right" },
            { key: "margin", label: "Margin", value: r => r.margin, format: r => this.pct(r.margin), align: "right" }
        ], products, { sort: "revenue", search: false, csv: "product_performance", onRow: r => this.toggle("product", r.name), isActive: r => f.product === r.name, total: true });
    }

    // ---------- drill-through drawer: department detail ----------

    private renderDrawer(dept: string): void {
        const L = this.lookup, ref = this.data.ref;
        const f: Filters = { dept };
        const emps = filterEmployees(L, f);
        const tasks = filterTasks(L, f);
        const projects = filterProjects(L, f);
        const x = expenseKpis(filterExpenses(L, f), L);
        const k = taskKpis(tasks, ref);
        const veil = this.el("div", "bx-veil", this.page);
        veil.onclick = () => { this.drawer = ""; this.render(); };
        const panel = this.el("div", "bx-drawer", this.page);
        const head = this.el("div", "bx-drawer-head", panel);
        const t = this.el("div", "bx-drawer-title", head);
        t.appendChild(icon("Building", 18));
        t.appendChild(document.createTextNode(` ${dept}`));
        const close = this.el("button", "bx-icon-btn", head);
        close.appendChild(icon("X", 16));
        close.title = "Close";
        close.onclick = () => { this.drawer = ""; this.render(); };
        this.el("div", "bx-drawer-sub", panel, `Drill-through · ${L.data.departments.find(d => d.n === dept)?.dv ?? ""} division · as of ${this.longDate(ref)}`);
        const stats = this.el("div", "bx-drawer-stats", panel);
        const stat = (label: string, value: string, tone = ""): void => { const s = this.el("div", `bx-stat ${tone}`, stats); this.el("div", "bx-stat-value", s, value); this.el("div", "bx-stat-label", s, label); };
        stat("Employees", this.int(emps.length));
        stat("Open tasks (assignees)", this.int(k.open), "bx-blue");
        stat("Overdue tasks", this.int(k.overdue), k.overdue ? "bx-bad" : "");
        stat("Approved expenses", this.compact(x.approved), "bx-violet");
        stat("Projects owned", this.int(projects.length));
        stat("Budget used", this.pct(projectKpis(projects, ref).utilization), this.utilTone(projectKpis(projects, ref).utilization));
        const list = (title: string, rows: string[][]): void => {
            this.el("div", "bx-drawer-section", panel, title);
            const box = this.el("div", "bx-drawer-list", panel);
            if (!rows.length) { this.el("div", "bx-muted", box, "None"); }
            rows.forEach(r => { const line = this.el("div", "bx-drawer-row", box); r.forEach((cell, i) => this.el("span", i ? "bx-muted" : "", line, cell)); });
        };
        list(`Employees (${emps.length})`, emps.map(e => [e.n, e.j, e.s]));
        list(`Projects owned (${projects.length})`, projects.map(p => [p.n, p.st, projectRisk(p, ref) || "On track"]));
        list(`Overdue tasks of its people (${k.overdue})`, tasks.filter(t => isOverdue(t, ref)).sort((a, b) => a.dd.localeCompare(b.dd)).slice(0, 12).map(t => [t.t, L.empName(t.a), `${daysBetween(t.dd, ref)} days`]));
        const apply = this.el("button", "bx-primary", panel);
        apply.appendChild(icon("Check", 14));
        apply.appendChild(document.createTextNode(` Filter this page to ${dept}`));
        apply.onclick = () => { this.drawer = ""; this.setFilters({ ...this.filters, dept }); };
    }

    // ---------- tables ----------

    private riskTable(body: HTMLElement, projects: Project[]): void {
        const ref = this.data.ref, L = this.lookup;
        const risky = projects.filter(p => projectRisk(p, ref));
        this.table(body, "risks", [
            { key: "n", label: "Project", value: (p: Project) => p.n },
            { key: "pm", label: "Manager", value: (p: Project) => L.empName(p.pm) },
            { key: "st", label: "Status", value: (p: Project) => p.st, color: (p: Project) => STATUS_COLORS[p.st] },
            { key: "dl", label: "Deadline", value: (p: Project) => p.dl },
            { key: "risk", label: "Risk", value: (p: Project) => projectRisk(p, ref), color: (p: Project) => (isOverBudget(p) ? NEON.pink : NEON.amber) },
            { key: "u", label: "Budget used", value: (p: Project) => divide(p.ac, p.b), format: (p: Project) => this.pct(divide(p.ac, p.b)), align: "right", color: (p: Project) => this.utilColor(divide(p.ac, p.b)) }
        ], risky, { sort: "u", search: false, csv: "top_risks" });
    }

    private table<T>(body: HTMLElement, id: string, columns: Array<Column<T>>, rows: T[],
        opts: { sort: string; asc?: boolean; search: boolean; onRow?: (row: T) => void; isActive?: (row: T) => boolean; note?: string; total?: boolean; csv?: string }): void {
        const state = this.tables.get(id) ?? { sort: opts.sort, desc: !opts.asc, search: "" };
        this.tables.set(id, state);
        const head = body.parentElement?.querySelector(".bx-card-head") as HTMLElement | null;
        let shown = rows;
        if (opts.search && head) {
            const box = this.el("label", "bx-search", head);
            box.appendChild(icon("Search", 12));
            const input = this.el("input", "", box) as HTMLInputElement;
            input.placeholder = "Search";
            input.value = state.search;
            input.oninput = () => {
                state.search = input.value;
                const pos = input.selectionStart;
                this.render();
                const again = this.page.querySelector(`[data-search="${id}"]`) as HTMLInputElement | null;
                if (again) { again.focus(); again.setSelectionRange(pos, pos); }
            };
            input.setAttribute("data-search", id);
        }
        if (state.search) {
            const q = state.search.toLowerCase();
            shown = rows.filter(r => columns.some(c => String(c.format ? c.format(r) : c.value(r) ?? "").toLowerCase().includes(q)));
        }
        const col = columns.find(c => c.key === state.sort);
        if (col) {
            shown = [...shown].sort((a, b) => {
                const va = col.value(a), vb = col.value(b);
                const cmp = typeof va === "number" && typeof vb === "number" ? va - vb : String(va ?? "").localeCompare(String(vb ?? ""));
                return state.desc ? -cmp : cmp;
            });
        }
        if (head) { this.el("span", "bx-count", head, `${shown.length} of ${rows.length}`); }
        if (head && opts.csv) {
            const exportRows = shown;
            const b = this.el("button", "bx-csv", head);
            b.appendChild(icon("ScrollText", 11));
            b.appendChild(document.createTextNode(" CSV"));
            b.title = "Export the rows shown (filters and search applied) as CSV";
            b.onclick = () => { void this.exportCsv(opts.csv ?? id, columns, exportRows); };
        }
        const scroll = this.el("div", "bx-table-scroll", body);
        const table = this.el("table", "bx-table", scroll);
        const tr = this.el("tr", "", this.el("thead", "", table));
        columns.forEach(c => {
            const th = this.el("th", c.align === "right" ? "bx-right" : "", tr, c.label + (state.sort === c.key ? (state.desc ? " ▼" : " ▲") : ""));
            th.onclick = () => { state.desc = state.sort === c.key ? !state.desc : true; state.sort = c.key; this.render(); };
        });
        const tbody = this.el("tbody", "", table);
        shown.forEach(r => {
            const row = this.el("tr", opts.isActive?.(r) ? "bx-active" : "", tbody);
            if (opts.onRow) { row.classList.add("bx-click"); row.onclick = () => opts.onRow?.(r); }
            columns.forEach(c => {
                const v = c.format ? c.format(r) : c.value(r);
                const td = this.el("td", c.align === "right" ? "bx-right" : "", row, v === null || v === undefined || v === "" ? (c.key === "risk" ? "" : "—") : String(v));
                const color = c.color?.(r);
                if (color) { td.style.color = color; td.classList.add("bx-strong"); }
            });
        });
        if (!shown.length) { this.el("td", "bx-muted", this.el("tr", "", tbody), state.search ? "No row matches the search." : "No rows for the current filters.").setAttribute("colspan", String(columns.length)); }
        if (opts.note) { this.el("div", "bx-table-note", body, opts.note); }
    }

    /** CSV export through Power BI's download service. Power BI only allows it when the user is signed in and the
     *  tenant setting "Allow downloads from custom visuals" is on; otherwise the visual says so instead of failing silently. */
    private async exportCsv<T>(name: string, columns: Array<Column<T>>, rows: T[]): Promise<void> {
        const cell = (v: string): string => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
        const lines = [columns.map(c => cell(c.label)).join(",")].concat(rows.map(r => columns.map(c => { const v = c.value(r); return cell(v === null || v === undefined ? "" : typeof v === "number" ? String(Math.round(v * 10000) / 10000) : String(v)); }).join(",")));
        const fileName = `BOI360_${name}_${this.data.ref}.csv`;
        try {
            const status = await this.downloadService.exportStatus();
            if (status !== PRIVILEGE_ALLOWED) {
                this.notify("Download blocked by Power BI: sign in and ask your admin to allow downloads from custom visuals. Alternative: File › Export › Export to PDF.", true);
                return;
            }
            const result = await this.downloadService.exportVisualsContentExtended(lines.join("\r\n"), fileName, "csv", "BOI 360 table export");
            this.notify(result?.downloadCompleted ? `Saved ${result.fileName || fileName}` : "Download cancelled", !result?.downloadCompleted);
        } catch {
            this.notify("Download not available here: Power BI blocked it (sign-in / tenant setting). Use File › Export › Export to PDF.", true);
        }
    }

    private notify(text: string, bad: boolean): void {
        this.toastText = text;
        this.toastBad = bad;
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => { this.toastText = ""; this.render(); }, 4500);
        this.render();
    }

    private matrix(body: HTMLElement, tasks: Task[]): void {
        const statuses = ["To Do", "In Progress", "Blocked", "Done"];
        const max = Math.max(1, ...PRIORITY_ORDER.flatMap(p => statuses.map(s => tasks.filter(t => t.pr === p && t.st === s).length)));
        const table = this.el("table", "bx-matrix", body);
        const hr = this.el("tr", "", this.el("thead", "", table));
        this.el("th", "", hr, "Priority");
        statuses.forEach(s => this.el("th", "", hr, s));
        this.el("th", "", hr, "Total");
        const tb = this.el("tbody", "", table);
        PRIORITY_ORDER.forEach(p => {
            const tr = this.el("tr", "", tb);
            this.el("td", "bx-matrix-row", tr, p);
            statuses.forEach(s => {
                const n = tasks.filter(t => t.pr === p && t.st === s).length;
                const td = this.el("td", "bx-cell", tr, String(n));
                const strength = n / max;
                const color = s === "Blocked" || (p === "Critical" && s !== "Done") ? "255,92,100" : s === "Done" ? "53,211,154" : "255,212,59";
                td.style.background = `rgba(${color},${0.08 + strength * 0.55})`;
                if (this.filters.tpriority === p && this.filters.tstatus === s) { td.classList.add("bx-cell-on"); }
                td.title = `${p} · ${s}: ${n} tasks`;
                td.onclick = () => this.setFilters({ ...this.filters, tpriority: this.filters.tpriority === p && this.filters.tstatus === s ? "" : p, tstatus: this.filters.tpriority === p && this.filters.tstatus === s ? "" : s });
            });
            this.el("td", "bx-cell-total", tr, String(tasks.filter(t => t.pr === p).length));
        });
    }

    // ---------- charts ----------

    private chartBox(body: HTMLElement): HTMLElement { return this.el("div", "bx-chart", body); }

    private bars(body: HTMLElement, rows: BarRow[], fmt: (v: number) => string, onClick?: ChartClick, selected?: string, limit = 12): void {
        const sorted = [...rows].sort((a, b) => b.value - a.value).slice(0, limit).reverse();
        const el = this.chartBox(body);
        if (!sorted.length) { this.el("div", "bx-nodata", el, "No data for the current filters"); return; }
        this.charts.queue(el, {
            grid: { left: 8, right: 54, top: 6, bottom: 6, containLabel: true },
            tooltip: glassTooltip({ trigger: "item", formatter: (p: { dataIndex: number }) => { const r = sorted[p.dataIndex]; return tooltipHtml(r.name, [{ label: "Value", value: r.label ?? fmt(r.value), color: r.color ?? NEON.cyan }, ...r.tip]); } }),
            xAxis: { type: "value", ...axisStyle(), axisLabel: { show: false }, splitLine: { show: false } },
            yAxis: { type: "category", data: sorted.map(r => r.name), ...axisStyle(), axisLabel: { color: NEON.soft, fontSize: 10, width: 120, overflow: "truncate" } },
            series: [{
                type: "bar", barMaxWidth: 14, cursor: onClick ? "pointer" : "default",
                data: sorted.map(r => ({
                    value: r.value,
                    itemStyle: {
                        borderRadius: [0, 7, 7, 0], opacity: selected && selected !== r.name ? 0.35 : 1,
                        color: linear(this.fade(r.color ?? NEON.cyan), r.color ?? NEON.cyan, true), shadowBlur: 10, shadowColor: r.color ?? NEON.cyan
                    }
                })),
                label: { show: true, position: "right", color: NEON.text, fontSize: 10, formatter: (p: { dataIndex: number }) => sorted[p.dataIndex].label ?? fmt(sorted[p.dataIndex].value) }
            }]
        }, onClick);
    }

    private lineChart(body: HTMLElement, months: string[], series: Array<{ name: string; color: string; data: number[] }>, onClick?: (m: string) => void, money = true): void {
        const el = this.chartBox(body);
        this.charts.queue(el, {
            grid: { left: 8, right: 14, top: 28, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: NEON.soft, fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
            tooltip: glassTooltip({ trigger: "axis", formatter: (ps: Array<{ dataIndex: number }>) => { const i = ps[0].dataIndex; return tooltipHtml(this.monthLabel(months[i]), series.map(s => ({ label: s.name, value: money ? this.money(s.data[i]) : this.int(s.data[i]), color: s.color })), i === months.length - 1 && months[i] === month(this.data.ref) ? "Partial month: data ends " + this.longDate(this.data.ref) : undefined); } }),
            xAxis: { type: "category", data: months.map(m => this.monthLabel(m)), boundaryGap: false, ...axisStyle() },
            yAxis: { type: "value", ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 10, formatter: (v: number) => this.short(v) } },
            series: series.map(s => ({
                name: s.name, type: "line", smooth: true, symbol: "circle", symbolSize: 6, data: s.data,
                lineStyle: { width: 3, color: s.color, shadowBlur: 12, shadowColor: s.color }, itemStyle: { color: s.color },
                areaStyle: { color: linear(this.alpha(s.color, 0.35), this.alpha(s.color, 0)) }
            }))
        }, onClick ? p => onClick(months[p.dataIndex]) : undefined);
    }

    private stacked(body: HTMLElement, months: string[], series: Array<{ name: string; color: string; data: number[] }>, money = false): void {
        const el = this.chartBox(body);
        this.charts.queue(el, {
            grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: NEON.soft, fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
            tooltip: glassTooltip({ trigger: "axis", formatter: (ps: Array<{ dataIndex: number }>) => { const i = ps[0].dataIndex; return tooltipHtml(this.monthLabel(months[i]), series.map(s => ({ label: s.name, value: money ? this.money(s.data[i]) : this.int(s.data[i]), color: s.color }))); } }),
            xAxis: { type: "category", data: months.map(m => this.monthLabel(m)), ...axisStyle() },
            yAxis: { type: "value", ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 10, formatter: (v: number) => (money ? this.short(v) : String(v)) } },
            series: series.map(s => ({ name: s.name, type: "bar", stack: "all", barMaxWidth: 22, data: s.data, itemStyle: { color: linear(s.color, this.alpha(s.color, 0.45)), borderRadius: 3 } }))
        });
    }

    private combo(body: HTMLElement, months: string[], target: number[], actual: number[]): void {
        const el = this.chartBox(body);
        this.charts.queue(el, {
            grid: { left: 8, right: 8, top: 28, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: NEON.soft, fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
            tooltip: glassTooltip({ trigger: "axis", formatter: (ps: Array<{ dataIndex: number }>) => { const i = ps[0].dataIndex; const ach = divide(actual[i], target[i]); return tooltipHtml(this.monthLabel(months[i]), [{ label: "Target", value: this.money(target[i]), color: NEON.blue }, { label: "Actual", value: this.money(actual[i]), color: NEON.cyan }, { label: "Achievement", value: this.pct(ach), color: this.achColor(ach) }]); } }),
            xAxis: { type: "category", data: months.map(m => this.monthLabel(m)), ...axisStyle() },
            yAxis: { type: "value", ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 10, formatter: (v: number) => this.short(v) } },
            series: [
                { name: "Target", type: "bar", barMaxWidth: 18, data: target, itemStyle: { color: linear(this.alpha(NEON.blue, 0.85), this.alpha(NEON.blue, 0.25)), borderRadius: [5, 5, 0, 0] } },
                {
                    name: "Actual", type: "line", smooth: true, symbol: "circle", symbolSize: 7, data: actual.map((v, i) => ({ value: v, itemStyle: { color: this.achColor(divide(v, target[i])) } })),
                    lineStyle: { width: 3, color: NEON.cyan, shadowBlur: 10, shadowColor: NEON.cyan }
                }
            ]
        });
    }

    private donut(body: HTMLElement, items: Array<{ name: string; value: number; color?: string }>, center: string, centerLabel: string, onClick?: ChartClick): void {
        const total = sum(items, i => i.value);
        const el = this.chartBox(body);
        if (!items.length) { this.el("div", "bx-nodata", el, "No data for the current filters"); return; }
        this.charts.queue(el, {
            tooltip: glassTooltip({ trigger: "item", formatter: (p: { dataIndex: number }) => { const it = items[p.dataIndex]; return tooltipHtml(it.name, [{ label: "Value", value: centerLabel === "projects" || centerLabel === "days" ? this.int(it.value) : this.money(it.value), color: it.color }, { label: "Share", value: this.pct(divide(it.value, total)) }]); } }),
            legend: { orient: "vertical", right: 0, top: "middle", textStyle: { color: NEON.soft, fontSize: 10 }, itemWidth: 9, itemHeight: 9, icon: "circle" },
           series: [{
                type: "pie", radius: ["60%", "80%"], center: ["32%", "52%"], cursor: onClick ? "pointer" : "default", avoidLabelOverlap: true,
                label: { show: false }, padAngle: 2, itemStyle: { borderRadius: 6 },
                data: items.map((it, i) => ({ name: it.name, value: it.value, itemStyle: { color: it.color ?? SERIES[i % SERIES.length], shadowBlur: 12, shadowColor: it.color ?? SERIES[i % SERIES.length] } }))
            }]
        }, onClick);
        const mid = this.el("div", "bx-donut-center", body);
        this.el("div", "bx-donut-value", mid, center);
        this.el("div", "bx-donut-label", mid, centerLabel);
    }

    private pairBars(body: HTMLElement, projects: Project[]): void {
        const rows = [...projects].sort((a, b) => a.b - b.b);
        const el = this.chartBox(body);
        if (!rows.length) { this.el("div", "bx-nodata", el, "No data for the current filters"); return; }
        this.charts.queue(el, {
            grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: NEON.soft, fontSize: 10 }, itemWidth: 12, itemHeight: 8, data: ["Budget", "Actual cost"] },
            tooltip: glassTooltip({ trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: Array<{ dataIndex: number }>) => { const p = rows[ps[0].dataIndex]; return tooltipHtml(p.n, [{ label: "Budget", value: this.money(p.b), color: NEON.blue }, { label: "Actual cost", value: this.money(p.ac), color: isOverBudget(p) ? NEON.pink : NEON.cyan }, { label: "Used", value: this.pct(divide(p.ac, p.b)) }, { label: "Status", value: p.st }]); } }),
            xAxis: { type: "value", ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 9, formatter: (v: number) => this.short(v) } },
            yAxis: { type: "category", data: rows.map(p => p.n), ...axisStyle(), axisLabel: { color: NEON.soft, fontSize: 9, width: 130, overflow: "truncate" } },
            series: [
                { name: "Budget", type: "bar", barMaxWidth: 7, data: rows.map(p => p.b), itemStyle: { color: this.alpha(NEON.blue, 0.75), borderRadius: [0, 4, 4, 0] } },
                { name: "Actual cost", type: "bar", barMaxWidth: 7, itemStyle: { color: NEON.cyan }, data: rows.map(p => ({ value: p.ac, itemStyle: { color: isOverBudget(p) ? NEON.pink : NEON.cyan, borderRadius: [0, 4, 4, 0] } })) }
            ]
        }, p => this.toggle("project", rows[p.dataIndex].n));
    }

    private dualBars(body: HTMLElement, names: string[], revenue: number[], profit: number[]): void {
        const el = this.chartBox(body);
        this.charts.queue(el, {
            grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
            legend: { top: 0, right: 0, textStyle: { color: NEON.soft, fontSize: 10 }, itemWidth: 12, itemHeight: 8 },
            tooltip: glassTooltip({ trigger: "axis", axisPointer: { type: "shadow" }, formatter: (ps: Array<{ dataIndex: number }>) => { const i = ps[0].dataIndex; return tooltipHtml(names[i], [{ label: "Revenue", value: this.money(revenue[i]), color: NEON.cyan }, { label: "Profit", value: this.money(profit[i]), color: NEON.violet }, { label: "Margin", value: this.pct(divide(profit[i], revenue[i])) }]); } }),
            xAxis: { type: "value", ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 9, formatter: (v: number) => this.short(v) } },
            yAxis: { type: "category", inverse: true, data: names, ...axisStyle(), axisLabel: { color: NEON.soft, fontSize: 10, width: 120, overflow: "truncate" } },
            series: [
                { name: "Revenue", type: "bar", barMaxWidth: 8, data: revenue, itemStyle: { color: linear(this.fade(NEON.cyan), NEON.cyan, true), borderRadius: [0, 4, 4, 0] } },
                { name: "Profit", type: "bar", barMaxWidth: 8, data: profit, itemStyle: { color: linear(this.fade(NEON.violet), NEON.violet, true), borderRadius: [0, 4, 4, 0] } }
            ]
        }, p => this.toggle("product", names[p.dataIndex]));
    }

    private scatter(body: HTMLElement, products: Array<{ name: string; revenue: number; margin: number | null; units: number }>): void {
        const el = this.chartBox(body);
        const maxUnits = Math.max(1, ...products.map(p => p.units));
        this.charts.queue(el, {
            grid: { left: 8, right: 24, top: 14, bottom: 4, containLabel: true },
            tooltip: glassTooltip({ trigger: "item", formatter: (p: { dataIndex: number }) => { const r = products[p.dataIndex]; return tooltipHtml(r.name, [{ label: "Revenue", value: this.money(r.revenue), color: NEON.cyan }, { label: "Margin", value: this.pct(r.margin), color: NEON.violet }, { label: "Units", value: this.int(r.units) }]); } }),
            xAxis: { type: "value", scale: true, ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 9, formatter: (v: number) => this.short(v) } },
            yAxis: { type: "value", scale: true, ...axisStyle(), axisLabel: { color: NEON.muted, fontSize: 9, formatter: (v: number) => `${(v * 100).toFixed(0)}%` } },
            series: [{
                type: "scatter", data: products.map(p => [p.revenue, p.margin ?? 0]),
                symbolSize: (_: unknown, p: { dataIndex: number }) => 12 + 26 * (products[p.dataIndex].units / maxUnits),
                itemStyle: { color: linear(NEON.cyan, NEON.violet), opacity: 0.85, shadowBlur: 14, shadowColor: NEON.cyan },
                label: { show: true, position: "top", color: NEON.soft, fontSize: 9, formatter: (p: { dataIndex: number }) => products[p.dataIndex].name },
                labelLayout: { hideOverlap: true }
            }]
        }, p => this.toggle("product", products[p.dataIndex].name));
    }

    // ---------- formatting ----------

    private deptNames(): string[] { return this.data.departments.map(d => d.n); }
    private money(v: number | null): string { return v === null || v === undefined || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    private signedMoney(v: number): string { return (v > 0 ? "+" : "") + this.money(v); }
    private int(v: number | null): string { return v === null || v === undefined ? "—" : Math.round(v).toLocaleString("en-US"); }
    private pct(v: number | null): string { return v === null || v === undefined || isNaN(v) ? "—" : `${(v * 100).toFixed(1)}%`; }
    private short(v: number): string { const a = Math.abs(v); return a >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(0)}K` : String(Math.round(v)); }
    private compact(v: number | null): string {
        if (v === null || v === undefined || isNaN(v)) { return "—"; }
        const a = Math.abs(v);
        return a >= 1e6 ? `${(v / 1e6).toFixed(2)}M TND` : a >= 1e4 ? `${(v / 1e3).toFixed(1)}K TND` : `${this.money(v)} TND`;
    }
    private signedCompact(v: number): string { return (v > 0 ? "+" : "") + this.compact(v); }
    private monthLabel(m: string): string { const [y, mm] = m.split("-"); return `${MONTHS[Number(mm) - 1]} ${y}`; }
    private longDate(iso: string): string { if (!iso) { return ""; } const [y, m, d] = iso.split("-"); return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`; }
    private achColor(a: number | null): string { return a === null ? NEON.muted : a < 0.9 ? NEON.pink : a < 1 ? NEON.amber : NEON.green; }
    private achTone(a: number | null): string { return a === null ? "" : a < 0.9 ? "bx-bad" : a < 1 ? "bx-warn" : "bx-good"; }
    private utilColor(u: number | null): string { return u === null ? NEON.muted : u > 1 ? NEON.pink : u > 0.9 ? NEON.amber : NEON.green; }
    private utilTone(u: number | null): string { return u === null ? "" : u > 1 ? "bx-bad" : u > 0.9 ? "bx-warn" : "bx-good"; }
    private alpha(hex: string, a: number): string { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }
    private fade(hex: string): string { return this.alpha(hex, 0.25); }

    private el(tag: string, className: string, parent: HTMLElement, text?: string): HTMLElement {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        if (text !== undefined) { element.textContent = text; }
        parent.appendChild(element);
        return element;
    }
}
