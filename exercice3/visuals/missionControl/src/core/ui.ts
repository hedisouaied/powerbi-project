"use strict";

/**
 * Reusable UI components (no innerHTML: every node is created with the DOM API).
 * h() element builder, icons, buttons, chips, cards, KPI tiles, data table (search / sort / column chooser / pagination /
 * row inspector), tabs, drawer, modal, toast, empty state, skeleton, sparkline, gauge, progress ring, formatters.
 */

import {
    Activity, AlarmClock, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Award, Ban, Banknote, Bell, BookOpen, Bot, Box, Boxes, Brain, Briefcase,
    Building, Calendar, CalendarClock, CalendarDays, ChartBar, ChartCandlestick, ChartGantt, ChartLine, ChartPie, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight,
    ChevronUp, CircleCheck, CircleQuestionMark, CircleX, ClipboardList, Clock, Coins, Columns2, Command, Copy, createElement, Crosshair, Cuboid, Database, Download, Eye,
    Factory, FileText, Flag, Flame, FlaskConical, FolderSearch, Funnel, Gauge, Gavel, GitBranch, Globe, GripVertical, Hourglass, IconNode, Inbox, Info, KeyRound, Keyboard,
    Landmark, Layers, LayoutDashboard, LayoutGrid, Lightbulb, Link, ListChecks, Lock, Mail, MailOpen, Map as MapIcon, MapPin, Maximize2, MessageSquare, MessagesSquare,
    Minimize2, Minus, Monitor, Moon, Move, Network, NotebookPen, Package, Palette, PanelLeft, Pause, Pencil, Pin, Play, Plug, Plus, Printer, Quote, Radar, Receipt, RefreshCw,
    Rocket, Rotate3d, RotateCcw, Route, Save, Scale, ScanSearch, ScrollText, Search, Send, Server, Settings, Shield, ShieldAlert, Shuffle, Siren, SkipBack, SkipForward,
    SlidersHorizontal, Sparkles, SquareKanban, Star, Stethoscope, Store, Sun, Swords, Table, Tag, Target, Telescope, Timer, Trash, TrendingDown, TrendingUp, TriangleAlert,
    Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap
} from "lucide";

const ICONS: Record<string, IconNode> = {
    Activity, AlarmClock, Archive, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Award, Ban, Banknote, Bell, BookOpen, Bot, Box, Boxes, Brain, Briefcase,
    Building, Calendar, CalendarClock, CalendarDays, ChartBar, ChartCandlestick, ChartGantt, ChartLine, ChartPie, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight,
    ChevronUp, CircleCheck, CircleQuestionMark, CircleX, ClipboardList, Clock, Coins, Columns2, Command, Copy, Crosshair, Cuboid, Database, Download, Eye,
    Factory, FileText, Flag, Flame, FlaskConical, FolderSearch, Funnel, Gauge, Gavel, GitBranch, Globe, GripVertical, Hourglass, Inbox, Info, KeyRound, Keyboard,
    Landmark, Layers, LayoutDashboard, LayoutGrid, Lightbulb, Link, ListChecks, Lock, Mail, MailOpen, Map: MapIcon, MapPin, Maximize2, MessageSquare, MessagesSquare,
    Minimize2, Minus, Monitor, Moon, Move, Network, NotebookPen, Package, Palette, PanelLeft, Pause, Pencil, Pin, Play, Plug, Plus, Printer, Quote, Radar, Receipt, RefreshCw,
    Rocket, Rotate3d, RotateCcw, Route, Save, Scale, ScanSearch, ScrollText, Search, Send, Server, Settings, Shield, ShieldAlert, Shuffle, Siren, SkipBack, SkipForward,
    SlidersHorizontal, Sparkles, SquareKanban, Star, Stethoscope, Store, Sun, Swords, Table, Tag, Target, Telescope, Timer, Trash, TrendingDown, TrendingUp, TriangleAlert,
    Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap
};

export function icon(name: string, size = 16): SVGElement {
    const el = createElement(ICONS[name] ?? Info);
    el.setAttribute("width", String(size)); el.setAttribute("height", String(size)); el.setAttribute("aria-hidden", "true");
    return el;
}

// ---------------------------------------------------------------- element builder
type Child = Node | string | number | null | undefined | false;
export interface Attrs { [k: string]: any }
export function h(tag: string, attrs: Attrs | string | null = null, ...children: Array<Child | Child[]>): HTMLElement {
    const el = document.createElement(tag);
    if (typeof attrs === "string") { el.className = attrs; }
    else if (attrs) {
        Object.keys(attrs).forEach(k => {
            const v = attrs[k];
            if (v === undefined || v === null || v === false) { return; }
            if (k === "class") { el.className = v; }
            else if (k === "style" && typeof v === "object") { Object.assign(el.style, v); }
            else if (k.startsWith("on") && typeof v === "function") { (el as any)[k.toLowerCase()] = v; }
            else if (k === "text") { el.textContent = String(v); }
            else { el.setAttribute(k, v === true ? "" : String(v)); }
        });
    }
    children.flat().forEach(c => { if (c === null || c === undefined || c === false) { return; } el.appendChild(typeof c === "object" ? c : document.createTextNode(String(c))); });
    return el;
}
export const svgNS = "http://www.w3.org/2000/svg";
export function s(tag: string, attrs: Record<string, string | number> = {}, ...children: Node[]): SVGElement {
    const el = document.createElementNS(svgNS, tag);
    Object.keys(attrs).forEach(k => el.setAttribute(k, String(attrs[k])));
    children.forEach(c => el.appendChild(c));
    return el;
}

// ---------------------------------------------------------------- formatters
export const fmt = {
    money: (v: number | null | undefined): string => (v === null || v === undefined || isNaN(v) ? "—" : `${v.toLocaleString("en-US", { maximumFractionDigits: 0 })} TND`),
    money2: (v: number | null | undefined): string => (v === null || v === undefined || isNaN(v) ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    compact: (v: number | null | undefined, unit = " TND"): string => {
        if (v === null || v === undefined || isNaN(v)) { return "—"; }
        const a = Math.abs(v);
        return (a >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : a >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0)) + unit;
    },
    int: (v: number | null | undefined): string => (v === null || v === undefined || isNaN(v) ? "—" : Math.round(v).toLocaleString("en-US")),
    pct: (v: number | null | undefined, d = 1): string => (v === null || v === undefined || isNaN(v) ? "—" : `${(v * 100).toFixed(d)}%`),
    signedPct: (v: number | null | undefined, d = 1): string => (v === null || v === undefined || isNaN(v) ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(d)}%`),
    date: (iso: string | null | undefined): string => {
        if (!iso) { return "—"; }
        const [y, m, d] = String(iso).slice(0, 10).split("-");
        return `${Number(d)} ${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1]} ${y}`;
    },
    time: (iso: string | null | undefined): string => (iso && iso.length > 11 ? String(iso).slice(11, 16) : "")
};

// ---------------------------------------------------------------- small components
export function btn(label: string, opts: { icon?: string; kind?: "primary" | "ghost" | "danger" | "soft"; onClick?: (e: MouseEvent) => void; title?: string; disabled?: boolean; small?: boolean } = {}): HTMLButtonElement {
    const b = h("button", { class: `mc-btn mc-btn-${opts.kind ?? "soft"}${opts.small ? " mc-btn-sm" : ""}`, title: opts.title ?? null, type: "button" }) as HTMLButtonElement;
    if (opts.icon) { b.appendChild(icon(opts.icon, opts.small ? 13 : 15)); }
    if (label) { b.appendChild(h("span", null, label)); }
    if (!label && opts.title) { b.setAttribute("aria-label", opts.title); }
    b.disabled = !!opts.disabled;
    b.onclick = (e): void => { e.stopPropagation(); if (!b.disabled) { opts.onClick?.(e); } };
    return b;
}
export function iconBtn(name: string, title: string, onClick: () => void, cls = ""): HTMLButtonElement {
    const b = h("button", { class: `mc-icon-btn ${cls}`, title, "aria-label": title, type: "button" }, icon(name, 16)) as HTMLButtonElement;
    b.onclick = (e): void => { e.stopPropagation(); onClick(); };
    return b;
}
export function chip(text: string, tone: string = "muted", title?: string): HTMLElement { return h("span", { class: `mc-chip mc-tone-${tone}`, title: title ?? null }, text); }
export function badge(n: number | string, tone = "bad"): HTMLElement { return h("span", { class: `mc-badge mc-tone-${tone}` }, String(n)); }
export function select(options: Array<{ value: string; label: string }>, value: string, onChange: (v: string) => void, label?: string, allLabel?: string): HTMLElement {
    const sel = h("select", { class: "mc-select", "aria-label": label ?? "Select" }) as HTMLSelectElement;
    if (allLabel !== undefined) { const o = h("option", null, allLabel) as HTMLOptionElement; o.value = ""; sel.appendChild(o); }
    options.forEach(op => { const o = h("option", null, op.label) as HTMLOptionElement; o.value = op.value; sel.appendChild(o); });
    sel.value = value;
    sel.onchange = (): void => onChange(sel.value);
    return label ? h("label", "mc-field", h("span", "mc-field-label", label), sel) : sel;
}
export function input(value: string, onInput: (v: string) => void, placeholder = "", type = "text", id?: string): HTMLInputElement {
    const i = h("input", { class: "mc-input", value, placeholder, type, "aria-label": placeholder || "input", "data-focus": id ?? null }) as HTMLInputElement;
    i.value = value;
    i.oninput = (): void => onInput(i.value);
    return i;
}
export function range(value: number, min: number, max: number, step: number, onInput: (v: number) => void, label: string, fmtV: (v: number) => string): HTMLElement {
    const out = h("span", "mc-range-value", fmtV(value));
    const r = h("input", { type: "range", class: "mc-range", min, max, step, "aria-label": label }) as HTMLInputElement;
    r.value = String(value);
    r.oninput = (): void => { out.textContent = fmtV(Number(r.value)); onInput(Number(r.value)); };
    return h("label", "mc-range-field", h("span", "mc-field-label", label, out), r);
}
export function empty(text: string, iconName = "Inbox"): HTMLElement { return h("div", "mc-empty", icon(iconName, 26), h("div", null, text)); }
export function skeleton(lines = 4): HTMLElement { return h("div", "mc-skeleton", ...Array.from({ length: lines }, (_, i) => h("div", { class: "mc-skel-line", style: { width: `${90 - i * 12}%` } }))); }
export function sessionTag(persisted: boolean): HTMLElement {
    return persisted ? chip("Saved in this report", "info", "Kept in the report's own settings (Ctrl+S). Not written to the CSV files or the data model.")
        : chip("Demo session — not saved", "warn", "In-memory only: lost on refresh or reopen. Not written to the CSV files or the data model.");
}

/** Panel/card with header (title, subtitle, actions) and a body. */
export function card(title: string, opts: { icon?: string; sub?: string; actions?: Node[]; cls?: string; id?: string } = {}): { el: HTMLElement; body: HTMLElement; head: HTMLElement } {
    const head = h("div", "mc-card-head", h("div", "mc-card-title", opts.icon ? icon(opts.icon, 15) : null, h("span", null, title)), opts.sub ? h("div", "mc-card-sub", opts.sub) : null, h("div", "mc-card-actions", ...(opts.actions ?? [])));
    const body = h("div", "mc-card-body");
    const el = h("section", { class: `mc-card ${opts.cls ?? ""}`, "data-card": opts.id ?? null, "aria-label": title }, head, body);
    return { el, body, head };
}

// ---------------------------------------------------------------- charts in SVG (light, no library)
export function sparkline(values: number[], w = 120, hgt = 32, cls = "mc-spark"): SVGElement {
    const v = values.length ? values : [0];
    const min = Math.min(...v), max = Math.max(...v);
    const pts = v.map((x, i) => `${(i * w / Math.max(1, v.length - 1)).toFixed(1)},${(hgt - 2 - ((x - min) / (max - min || 1)) * (hgt - 4)).toFixed(1)}`);
    const svg = s("svg", { viewBox: `0 0 ${w} ${hgt}`, preserveAspectRatio: "none", class: cls });
    svg.appendChild(s("path", { d: `M0,${hgt} L${pts.join(" L")} L${w},${hgt} Z`, class: "mc-spark-area" }));
    svg.appendChild(s("polyline", { points: pts.join(" "), class: "mc-spark-line" }));
    return svg;
}
/** Semi-circular gauge 0..100 (or 0..1 when max = 1). */
export function gauge(value: number, max: number, label: string, sub: string, tone = "accent"): HTMLElement {
    const r = 54, c = Math.PI * r, frac = Math.max(0, Math.min(1, value / max));
    const svg = s("svg", { viewBox: "0 0 140 84", class: "mc-gauge-svg" },
        s("path", { d: "M16,76 A54,54 0 0 1 124,76", class: "mc-gauge-track" }),
        s("path", { d: "M16,76 A54,54 0 0 1 124,76", class: `mc-gauge-arc mc-stroke-${tone}`, "stroke-dasharray": `${c}`, "stroke-dashoffset": `${c * (1 - frac)}`, style: `--mc-from:${c};--mc-to:${c * (1 - frac)}` }));
    return h("div", "mc-gauge", svg, h("div", "mc-gauge-center", h("div", "mc-gauge-value", label), h("div", "mc-gauge-sub", sub)));
}
export function ring(frac: number | null, size = 46, tone = "accent", label?: string): HTMLElement {
    const r = size / 2 - 5, c = 2 * Math.PI * r, f = Math.max(0, Math.min(1, frac ?? 0));
    const svg = s("svg", { viewBox: `0 0 ${size} ${size}`, width: size, height: size, class: "mc-ring" },
        s("circle", { cx: size / 2, cy: size / 2, r, class: "mc-ring-track" }),
        s("circle", { cx: size / 2, cy: size / 2, r, class: `mc-ring-arc mc-stroke-${tone}`, "stroke-dasharray": `${c}`, "stroke-dashoffset": `${c * (1 - f)}`, transform: `rotate(-90 ${size / 2} ${size / 2})`, style: `--mc-from:${c};--mc-to:${c * (1 - f)}` }));
    return h("div", "mc-ring-wrap", svg, label ? h("span", "mc-ring-label", label) : null);
}
export function bar(frac: number | null, tone = "accent"): HTMLElement {
    return h("div", "mc-bar", h("div", { class: `mc-bar-fill mc-bg-${tone}`, style: { width: `${Math.max(0, Math.min(1, frac ?? 0)) * 100}%` } }));
}

// ---------------------------------------------------------------- KPI tile with count-up
export interface KpiSpec { id: string; label: string; value: number | null; format: (v: number) => string; delta?: number | null; deltaGood?: boolean; spark?: number[]; icon: string; note?: string; onClick?: () => void; tone?: string }
export function kpiTile(k: KpiSpec): HTMLElement {
    const val = h("div", { class: "mc-kpi-value", "data-count": k.value === null ? null : String(k.value) }, k.value === null ? "—" : k.format(k.value));
    (val as any).__fmt = k.format;
    const good = k.delta === null || k.delta === undefined ? null : (k.delta >= 0) === (k.deltaGood ?? true);
    const tile = h("button", { class: `mc-kpi mc-tone-${k.tone ?? "accent"}`, type: "button", "aria-label": `${k.label}: ${k.value === null ? "no data" : k.format(k.value)}` },
        h("div", "mc-kpi-icon", icon(k.icon, 20)),
        h("div", "mc-kpi-main",
            h("div", "mc-kpi-label", k.label), val,
            h("div", "mc-kpi-foot",
                k.delta === null || k.delta === undefined ? null : h("span", { class: `mc-delta ${good ? "mc-delta-good" : "mc-delta-bad"}` }, icon(k.delta >= 0 ? "ArrowUp" : "ArrowDown", 11), `${Math.abs(k.delta * 100).toFixed(1)}%`),
                k.note ? h("span", "mc-kpi-note", k.note) : null)),
        k.spark && k.spark.length > 1 ? sparkline(k.spark, 96, 34) : null);
    tile.onclick = (): void => k.onClick?.();
    return tile;
}
/** Animates every [data-count] value under root from 0 (ease-out, 900 ms). Skipped for reduced motion. */
export function countUp(root: HTMLElement, reduced: boolean): void {
    if (reduced) { return; }
    const els = Array.from(root.querySelectorAll("[data-count]")) as HTMLElement[];
    if (!els.length) { return; }
    const start = performance.now();
    const step = (now: number): void => {
        const t = Math.min(1, (now - start) / 900), e = 1 - Math.pow(1 - t, 3);
        els.forEach(el => { const f = (el as any).__fmt as ((v: number) => string) | undefined; if (f && el.isConnected) { el.textContent = f(Number(el.dataset.count) * e); } });
        if (t < 1) { window.requestAnimationFrame(step); } else { els.forEach(el => { const f = (el as any).__fmt; if (f) { el.textContent = f(Number(el.dataset.count)); } }); }
    };
    window.requestAnimationFrame(step);
}

// ---------------------------------------------------------------- tabs
export function tabs(items: Array<{ id: string; label: string; icon?: string; count?: number }>, active: string, onPick: (id: string) => void): HTMLElement {
    const bar = h("div", { class: "mc-tabs", role: "tablist" });
    items.forEach(it => {
        const b = h("button", { class: `mc-tab${it.id === active ? " mc-tab-on" : ""}`, role: "tab", "aria-selected": it.id === active ? "true" : "false", type: "button" }, it.icon ? icon(it.icon, 14) : null, h("span", null, it.label), it.count !== undefined ? h("span", "mc-tab-count", String(it.count)) : null);
        b.onclick = (): void => onPick(it.id);
        bar.appendChild(b);
    });
    return bar;
}

// ---------------------------------------------------------------- data table
export interface Col<T> { key: string; label: string; get: (r: T) => any; render?: (r: T) => Node | string; num?: boolean; width?: string }
export interface TableState { q: string; sort: string; desc: boolean; page: number; hidden: string[]; size: number }
export function newTableState(sort = "", desc = false, size = 12): TableState { return { q: "", sort, desc, page: 0, hidden: [], size }; }
export function dataTable<T>(cols: Array<Col<T>>, rows: T[], st: TableState, rerender: () => void, opts: { onRow?: (r: T) => void; active?: (r: T) => boolean; chooser?: boolean; search?: boolean; toolbar?: Node[]; emptyText?: string; id?: string } = {}): HTMLElement {
    let shown = rows;
    if (st.q) { const q = st.q.toLowerCase(); shown = rows.filter(r => cols.some(c => String(c.get(r) ?? "").toLowerCase().includes(q))); }
    const sc = cols.find(c => c.key === st.sort);
    if (sc) { shown = shown.slice().sort((a, b) => { const x = sc.get(a), y = sc.get(b); const r = typeof x === "number" && typeof y === "number" ? x - y : String(x ?? "").localeCompare(String(y ?? "")); return st.desc ? -r : r; }); }
    const pages = Math.max(1, Math.ceil(shown.length / st.size));
    st.page = Math.min(st.page, pages - 1);
    const page = shown.slice(st.page * st.size, (st.page + 1) * st.size);
    const visible = cols.filter(c => !st.hidden.includes(c.key));
    const tools = h("div", "mc-table-tools");
    if (opts.search !== false) {
        const i = input(st.q, v => { st.q = v; st.page = 0; rerender(); }, "Search rows…", "search", opts.id ? `tbl-${opts.id}` : undefined);
        tools.appendChild(h("label", "mc-search-box", icon("Search", 14), i));
    }
    (opts.toolbar ?? []).forEach(n => tools.appendChild(n));
    tools.appendChild(h("span", "mc-table-count", `${shown.length.toLocaleString("en-US")} of ${rows.length.toLocaleString("en-US")} rows`));
    if (opts.chooser) {
        const menu = h("details", "mc-col-chooser", h("summary", null, icon("Columns2", 14), "Columns"));
        const list = h("div", "mc-col-list");
        cols.forEach(c => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = !st.hidden.includes(c.key); cb.onchange = (): void => { st.hidden = cb.checked ? st.hidden.filter(k => k !== c.key) : st.hidden.concat(c.key); rerender(); }; list.appendChild(h("label", null, cb, c.label)); });
        menu.appendChild(list); tools.appendChild(menu);
    }
    const thead = h("tr", null, ...visible.map(c => {
        const th = h("th", { class: c.num ? "mc-num" : "", scope: "col", style: c.width ? { width: c.width } : null, tabindex: 0, "aria-sort": st.sort === c.key ? (st.desc ? "descending" : "ascending") : "none" }, c.label, st.sort === c.key ? icon(st.desc ? "ChevronDown" : "ChevronUp", 12) : null);
        const go = (): void => { st.desc = st.sort === c.key ? !st.desc : c.num === true; st.sort = c.key; rerender(); };
        th.onclick = go; th.onkeydown = (e): void => { if (e.key === "Enter") { go(); } };
        return th;
    }));
    const tbody = h("tbody");
    page.forEach(r => {
        const tr = h("tr", { class: `${opts.onRow ? "mc-click" : ""}${opts.active?.(r) ? " mc-row-on" : ""}`, tabindex: opts.onRow ? 0 : null }, ...visible.map(c => { const v = c.render ? c.render(r) : c.get(r); return h("td", { class: c.num ? "mc-num" : "" }, typeof v === "object" && v !== null ? v : (v === null || v === undefined || v === "" ? "—" : String(v))); }));
        if (opts.onRow) { tr.onclick = (): void => opts.onRow?.(r); tr.onkeydown = (e): void => { if (e.key === "Enter") { opts.onRow?.(r); } }; }
        tbody.appendChild(tr);
    });
    const table = page.length ? h("div", "mc-table-scroll", h("table", "mc-table", h("thead", null, thead), tbody)) : empty(opts.emptyText ?? (st.q ? "No row matches the search." : "No rows for the current filters."));
    const pager = pages > 1 ? h("div", "mc-pager",
        btn("", { icon: "ChevronLeft", small: true, title: "Previous page", disabled: st.page === 0, onClick: () => { st.page--; rerender(); } }),
        h("span", null, `Page ${st.page + 1} / ${pages}`),
        btn("", { icon: "ChevronRight", small: true, title: "Next page", disabled: st.page >= pages - 1, onClick: () => { st.page++; rerender(); } })) : null;
    return h("div", "mc-datatable", tools, table, pager);
}

// ---------------------------------------------------------------- overlays: drawer, modal, toast
export function drawer(host: HTMLElement, title: string, body: Node, onClose: () => void, opts: { icon?: string; width?: number; actions?: Node[] } = {}): HTMLElement {
    const veil = h("div", "mc-veil"); veil.onclick = onClose;
    const panel = h("aside", { class: "mc-drawer", role: "dialog", "aria-label": title, style: opts.width ? { width: `${opts.width}px` } : null },
        h("div", "mc-drawer-head", h("div", "mc-drawer-title", opts.icon ? icon(opts.icon, 18) : null, h("span", null, title)), h("div", "mc-row-gap", ...(opts.actions ?? []), iconBtn("X", "Close", onClose))),
        h("div", "mc-drawer-body", body));
    host.appendChild(veil); host.appendChild(panel);
    return panel;
}
export function modal(host: HTMLElement, title: string, body: Node, actions: Node[], onClose: () => void, iconName = "Pencil"): HTMLElement {
    const veil = h("div", "mc-veil"); veil.onclick = onClose;
    const box = h("div", { class: "mc-modal", role: "dialog", "aria-modal": "true", "aria-label": title }, h("div", "mc-modal-head", icon(iconName, 18), h("span", null, title), iconBtn("X", "Close", onClose)), h("div", "mc-modal-body", body), h("div", "mc-modal-actions", ...actions));
    host.appendChild(veil); host.appendChild(box);
    return box;
}
export function formGrid(fields: Array<{ label: string; el: Node; error?: string; wide?: boolean }>): HTMLElement {
    return h("div", "mc-form", ...fields.map(f => h("label", { class: `mc-form-field${f.error ? " mc-invalid" : ""}${f.wide ? " mc-wide" : ""}` }, h("span", "mc-field-label", f.label), f.el, f.error ? h("span", "mc-error", f.error) : null)));
}
