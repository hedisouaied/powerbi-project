"use strict";

/**
 * Application shell and router: global header (search / Ctrl+K palette, theme switch, notifications, help, profile),
 * status ribbon, collapsible sidebar with grouped navigation, breadcrumbs + Back, module outlet, overlays
 * (command palette, notification center, entity inspector, toasts). Modules are plain functions render(ctx, el).
 */

import { applyWorkspace, Dataset, Index } from "./core/data";
import { companyHealth, Ctx as ECtx, deptHealth, kpis, period, PERIODS, PeriodKey, previous } from "./core/engine";
import { Charts } from "./core/charts";
import { Session, Store, newSession } from "./core/state";
import { applyTokens, tokens, Tokens } from "./core/theme";
import { badge, btn, chip, countUp, fmt, h, icon, iconBtn, select } from "./core/ui";
import { inspector } from "./modules/inspector";
import { MODULES } from "./modules/registry";

export interface Ctx {
    app: App; ix: Index; d: Dataset; t: Tokens; ch: Charts; store: Store; s: Session; overlay: HTMLElement;
    ec: ECtx; prev: ECtx; reduced: boolean; persisted: boolean;
    go(route: string): void; select(type: string, id: string): void; rerender(): void; toast(text: string, tone?: "good" | "bad" | "info"): void;
    m<T>(key: string, init: () => T): T;
}

export const NAV: Array<{ group: string; items: Array<{ id: string; label: string; icon: string; feature?: string }> }> = [
    { group: "Pilotage", items: [
        { id: "command", label: "Centre de commande", icon: "LayoutDashboard", feature: "3" }, { id: "warroom", label: "Salle de crise de direction", icon: "Siren", feature: "28" },
        { id: "terminal", label: "Terminal financier", icon: "ChartCandlestick", feature: "22" }, { id: "story", label: "Récit des données", icon: "BookOpen", feature: "23" },
        { id: "synthesis", label: "Synthèse de direction", icon: "FileText" }] },
    { group: "Opérations", items: [
        { id: "queue", label: "File des missions", icon: "ListChecks" }, { id: "missions", label: "Missions", icon: "Target", feature: "26" },
        { id: "tasks", label: "Gestionnaire de tâches", icon: "SquareKanban", feature: "13" }, { id: "projects", label: "Projets", icon: "ChartGantt", feature: "14" },
        { id: "approvals", label: "Approbations", icon: "CheckCheck", feature: "15" }, { id: "calendar", label: "Calendrier", icon: "CalendarDays", feature: "16" },
        { id: "decisions", label: "Registre des décisions", icon: "Scale", feature: "12" }, { id: "notifications", label: "Notifications", icon: "Bell", feature: "2" },
        { id: "collab", label: "Collaboration", icon: "MessagesSquare", feature: "18" }, { id: "audit", label: "Journal d'audit", icon: "ScrollText", feature: "17" }] },
    { group: "Intelligence", items: [
        { id: "assistant", label: "Assistant IA", icon: "Bot", feature: "6" }, { id: "detective", label: "Détective métier", icon: "ScanSearch", feature: "27" },
        { id: "network", label: "Graphe de réseau", icon: "Network", feature: "20" }, { id: "risk", label: "Radar des risques", icon: "Radar", feature: "10" },
        { id: "rootcause", label: "Cause racine", icon: "GitBranch", feature: "9" }, { id: "forecast", label: "Prévisions et graphe des KPI", icon: "Telescope" },
        { id: "profiles", label: "Profils cibles", icon: "Users" }] },
    { group: "Simulation", items: [
        { id: "whatif", label: "Simulation et laboratoire de scénarios", icon: "SlidersHorizontal", feature: "7" }, { id: "crisis", label: "Simulateur de crise", icon: "Flame", feature: "25" },
        { id: "sandbox", label: "Bac à sable métier", icon: "FlaskConical", feature: "29" }, { id: "timemachine", label: "Machine à remonter le temps", icon: "Clock", feature: "8" },
        { id: "compare", label: "Studio de comparaison", icon: "Columns2", feature: "24" }] },
    { group: "Monde", items: [{ id: "twin", label: "Jumeau numérique 2D/3D", icon: "Cuboid", feature: "11·19" }, { id: "geo", label: "Intelligence géographique", icon: "Map", feature: "21" }] },
    { group: "Données", items: [
        { id: "explorer", label: "Explorateur de données", icon: "Table", feature: "5" }, { id: "doctor", label: "Docteur des données", icon: "Stethoscope" },
        { id: "sources", label: "Sources de données", icon: "Database" }] },
    { group: "Système", items: [{ id: "settings", label: "Paramètres et aide", icon: "Settings", feature: "4" }] }
];
export const ROUTES = NAV.flatMap(g => g.items.map(i => ({ ...i, group: g.group })));

export class App {
    public store: Store;
    public s: Session;
    public ch = new Charts();
    public base: Dataset;
    public ix: Index;
    /** CSV/text export as a browser download (set by the React shell). */
    public exporter: ((fileName: string, text: string) => Promise<boolean>) | null = null;
    /** Feed sizes in characters (set by visual.ts), shown in Data Sources. */
    public feedSizes: Record<string, number> = {};
    /** Feeds that arrived empty or could not be decoded (set by visual.ts) — shown as a banner so missing data is never silent. */
    public feedIssues: string[] = [];
    /** Signed-in user and sign-out (set by the React shell). */
    public user: { name: string; email: string; role: string } = { name: "Analyste", email: "", role: "analyst" };
    public onLogout: () => void = () => undefined;
    private root: HTMLElement;
    private toastEl: HTMLElement | null = null;
    private toastTimer = 0;
    private animateNext = true;
    private lastRoute = "";
    private keyHandler: (e: KeyboardEvent) => void;

    constructor(private readonly mount: HTMLElement, persist: (object: string, json: string) => void) {
        this.store = new Store(persist);
        this.s = newSession(this.store.prefs.landing);
        this.root = h("div", { class: "mc-app", tabindex: "-1" });
        this.mount.appendChild(this.root);
        this.keyHandler = (e: KeyboardEvent): void => this.onKey(e);
        this.root.addEventListener("keydown", this.keyHandler);
    }

    public setData(d: Dataset): void { this.base = d; this.animateNext = true; }
    public loadState(prefs: string, ws: string): void {
        const first = !this.lastRoute;
        if (this.store.load(prefs, ws) && first) { this.s.route = this.store.prefs.landing || "command"; }
    }
    public get reduced(): boolean { return this.store.prefs.motion === "reduced" || (typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches); }

    public go(route: string): void {
        if (route === this.s.route) { return; }
        this.s.history.push(this.s.route); this.s.history = this.s.history.slice(-30);
        this.s.route = route; this.s.palette = false; this.s.notifOpen = false; this.animateNext = true;
        this.render();
    }
    public back(): void { const r = this.s.history.pop(); if (r) { this.s.route = r; this.animateNext = true; this.render(); } }
    public toast(text: string, tone: "good" | "bad" | "info" = "good"): void {
        this.toastEl?.remove();
        this.toastEl = h("div", { class: `mc-toast mc-tone-${tone}`, role: "status" }, icon(tone === "bad" ? "TriangleAlert" : tone === "info" ? "Info" : "CircleCheck", 16), h("span", null, text));
        this.root.appendChild(this.toastEl);
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => { this.toastEl?.classList.add("mc-toast-out"); window.setTimeout(() => this.toastEl?.remove(), 300); }, 3800);
    }

    // ------------------------------------------------------------ render
    public render(): void {
        if (!this.base) { this.root.replaceChildren(h("div", "mc-empty-app", "Chargement des données… rechargez la page si rien ne s'affiche.")); return; }
        const prefs = this.store.prefs;
        const t = tokens(prefs.theme, prefs.accent);
        applyTokens(this.root, t, prefs.density, prefs.fontScale);
        this.root.className = `mc-app mc-theme-${prefs.theme}${this.reduced ? " mc-reduced" : ""}${prefs.sidebar === "collapsed" ? " mc-side-collapsed" : ""}${this.s.m.navOpen ? " mc-nav-open" : ""}`;
        const d = applyWorkspace(this.base, this.store.ws);
        this.ix = new Index(d);
        this.ch.dispose(); this.ch.t = t; this.ch.reduced = this.reduced;
        const p = period(this.s.periodKey, this.ix.ref, this.ix.first);
        const ec: ECtx = { p, dept: this.s.dept };
        const focusKey = (document.activeElement as HTMLElement | null)?.getAttribute?.("data-focus") ?? null;
        const caret = (document.activeElement as HTMLInputElement | null)?.selectionStart ?? null;
        const overlay = h("div", "mc-overlay");
        const ctx: Ctx = {
            app: this, ix: this.ix, d, t, ch: this.ch, store: this.store, s: this.s, overlay, ec, prev: { p: previous(p), dept: this.s.dept }, reduced: this.reduced,
            persisted: true, go: r => this.go(r), select: (type, id) => { this.s.selection = { type, id }; this.render(); }, rerender: () => this.render(),
            toast: (x, tone) => this.toast(x, tone), m: <T>(key: string, init: () => T): T => { if (!(key in this.s.m)) { this.s.m[key] = init(); } return this.s.m[key] as T; }
        };
        const route = ROUTES.find(r => r.id === this.s.route) ?? ROUTES[0];
        const outlet = h("main", { class: `mc-outlet${this.animateNext ? " mc-enter" : ""}`, "aria-label": route.label });
        const issues = this.feedIssues.length ? h("div", { class: "mc-feed-alert", role: "alert" }, icon("TriangleAlert", 15), h("span", null, h("b", null, `${this.feedIssues.length} table(s) n'ont pas été reçues : `), this.feedIssues.join(", "), ". Les chiffres qui en dépendent s'affichent à zéro. Rechargez la page ; si cela persiste, lancez php artisan mc:import --check sur le serveur.")) : null;
        const frame = h("div", "mc-frame", this.header(ctx), this.ribbon(ctx), issues, h("div", "mc-body", this.sidebar(ctx), h("div", { class: "mc-nav-veil", onclick: () => { this.s.m.navOpen = false; this.render(); } }), h("div", "mc-stage", this.crumbs(ctx, route), outlet)), overlay);
        this.root.replaceChildren(frame);
        if (this.toastEl) { this.root.appendChild(this.toastEl); }
        try { (MODULES[route.id] ?? MODULES.command)(ctx, outlet); }
        catch (err) { outlet.replaceChildren(h("div", "mc-error-box", icon("TriangleAlert", 20), h("div", null, h("b", null, `${route.label} n'a pas pu s'afficher`), h("div", null, String((err as Error)?.message ?? err))))); }
        if (this.s.palette) { this.palette(ctx); }
        if (this.s.notifOpen) { MODULES.__notifDrawer?.(ctx, overlay); }
        if (this.s.selection) { inspector(ctx, overlay, this.s.selection); }
        this.ch.flush();
        if (this.animateNext) { countUp(outlet, this.reduced); }
        this.animateNext = false; this.lastRoute = this.s.route;
        if (focusKey) { const el = this.root.querySelector(`[data-focus="${focusKey}"]`) as HTMLInputElement | null; if (el) { el.focus(); if (caret !== null && el.setSelectionRange) { try { el.setSelectionRange(caret, caret); } catch { /* not a text input */ } } } }
    }

    private header(c: Ctx): HTMLElement {
        const prefs = this.store.prefs;
        const unread = c.d.notifications.filter(n => n.read_status === "Non lu").length;
        const search = h("button", { class: "mc-search", type: "button", "aria-label": "Ouvrir la palette de commandes (Ctrl+K)" }, icon("Search", 16), h("span", null, "Rechercher modules, clients, commandes, projets, actions…"), h("kbd", null, "Ctrl K"));
        search.onclick = (): void => { this.s.palette = true; this.s.paletteQ = ""; this.s.paletteIdx = 0; this.render(); };
        const themeBtn = h("div", { class: "mc-theme-switch", role: "group", "aria-label": "Thème" },
            iconBtn("Sun", "Thème clair", () => { prefs.theme = "light"; this.store.savePrefs(); this.render(); }, prefs.theme === "light" ? "mc-on" : ""),
            iconBtn("Moon", "Thème sombre", () => { prefs.theme = "dark"; this.store.savePrefs(); this.render(); }, prefs.theme === "dark" ? "mc-on" : ""));
        const bell = h("div", "mc-bell", iconBtn("Bell", `Notifications (${unread} non lues)`, () => { this.s.notifOpen = !this.s.notifOpen; this.render(); }), unread ? badge(unread) : null);
        const menu = iconBtn("Menu", "Menu des modules", () => { this.s.m.navOpen = !this.s.m.navOpen; this.render(); }, "mc-menu-btn");
        menu.setAttribute("aria-expanded", this.s.m.navOpen ? "true" : "false");
        return h("header", "mc-header", menu,
            h("div", "mc-brand", this.logo(), h("div", null, h("div", "mc-brand-name", "Mission Control"), h("div", "mc-brand-sub", "Terminal d'intelligence d'entreprise"))),
            chip("DÉMO · données synthétiques", "info", "Jeu de données synthétique, devise TND. Ce ne sont pas des données réelles."),
            search, h("div", "mc-header-right", themeBtn, bell, iconBtn("CircleQuestionMark", "Aide et limites", () => this.go("settings")),
                h("div", { class: "mc-profile", title: this.user.email }, h("div", "mc-avatar", this.user.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase() || icon("User", 16)), h("div", null, h("div", "mc-profile-name", this.user.name), h("div", "mc-profile-role", `Espace ${this.user.role}`))),
                iconBtn("LogOut", "Se déconnecter", () => this.onLogout())));
    }

    private logo(): SVGElement {
        const ns = "http://www.w3.org/2000/svg"; const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", "0 0 40 40"); svg.setAttribute("class", "mc-logo");
        [[6, 24, 6, 12], [15, 16, 6, 20], [24, 8, 6, 28]].forEach(([x, y, w, hh]) => { const r = document.createElementNS(ns, "rect"); r.setAttribute("x", String(x)); r.setAttribute("y", String(y)); r.setAttribute("width", String(w)); r.setAttribute("height", String(hh)); r.setAttribute("rx", "1.5"); svg.appendChild(r); });
        return svg;
    }

    private ribbon(c: Ctx): HTMLElement {
        const k = kpis(c.ix, c.ec);
        const crit = c.d.incidents.filter(i => i.severity === "Critique" && (i.incident_status === "Ouvert" || i.incident_status === "En investigation")).length;
        const health = companyHealth(deptHealth(c.ix, c.ec));
        const item = (ic: string, label: string, value: string, tone = "", go?: string): HTMLElement => {
            const e = h("button", { class: `mc-rib-item ${tone}`, type: "button", disabled: !go }, icon(ic, 14), h("span", "mc-rib-label", label), h("b", null, value));
            if (go) { e.onclick = (): void => this.go(go); }
            return e;
        };
        return h("div", { class: "mc-ribbon", role: "status" },
            item("Activity", "Santé de l'entreprise", `${health}/100`, health >= 60 ? "mc-tone-good" : health >= 45 ? "mc-tone-warn" : "mc-tone-bad", "warroom"),
            item("Bell", "Alertes ouvertes", fmt.int(k.openAlerts), k.criticalAlerts ? "mc-tone-warn" : "", "risk"),
            item("Siren", "Incidents actifs", `${fmt.int(k.openIncidents)} · ${crit} critiques`, crit ? "mc-tone-bad mc-pulse" : "", "queue"),
            item("TrendingUp", "Pouls du CA", fmt.compact(k.netRevenue), "", "terminal"),
            item("Database", "Fraîcheur des données", `au ${fmt.date(c.ix.ref)}`, "", "sources"),
            h("div", "mc-rib-spacer"),
            select(PERIODS.map(p => ({ value: p.key, label: p.label })), this.s.periodKey, v => { this.s.periodKey = v as PeriodKey; this.animateNext = true; this.render(); }, undefined),
            select(c.d.departments.map(dp => ({ value: dp.department_id, label: dp.department_name })), this.s.dept, v => { this.s.dept = v; this.animateNext = true; this.render(); }, undefined, "Tous les départements"));
    }

    private sidebar(c: Ctx): HTMLElement {
        const prefs = this.store.prefs;
        const nav = h("nav", { class: "mc-side", "aria-label": "Modules" });
        nav.appendChild(h("div", "mc-side-top", iconBtn("PanelLeft", prefs.sidebar === "collapsed" ? "Déplier la barre latérale" : "Replier la barre latérale", () => { prefs.sidebar = prefs.sidebar === "collapsed" ? "expanded" : "collapsed"; this.store.savePrefs(); this.render(); })));
        NAV.forEach(g => {
            nav.appendChild(h("div", "mc-side-group", g.group));
            g.items.forEach(it => {
                const on = it.id === this.s.route;
                const b = h("button", { class: `mc-nav${on ? " mc-nav-on" : ""}`, type: "button", title: it.label, "aria-current": on ? "page" : null }, icon(it.icon, 17), h("span", "mc-nav-label", it.label),
                    it.id === "notifications" ? (() => { const u = c.d.notifications.filter(n => n.read_status === "Non lu").length; return u ? badge(u) : null; })() : null);
                b.onclick = (): void => { const wasOpen = !!this.s.m.navOpen; this.s.m.navOpen = false; if (it.id === this.s.route) { if (wasOpen) { this.render(); } } else { this.go(it.id); } };
                nav.appendChild(b);
            });
        });
        nav.appendChild(h("div", "mc-side-foot", h("div", "mc-live", h("span", "mc-live-dot"), "Connecté à MySQL"), h("div", null, `${Object.values(c.d).reduce((s, t) => s + t.length, 0).toLocaleString("fr-FR")} lignes · 31 tables`),
            h("div", "mc-side-slogan", "Des décisions plus intelligentes.", h("br"), "Une entreprise plus forte.")));
        return nav;
    }

    private crumbs(c: Ctx, route: { id: string; label: string; group: string; feature?: string }): HTMLElement {
        return h("div", "mc-crumbs",
            this.s.history.length ? btn("Retour", { icon: "ArrowLeft", small: true, kind: "ghost", onClick: () => this.back() }) : null,
            h("span", "mc-crumb", route.group), icon("ChevronRight", 12), h("span", "mc-crumb mc-crumb-on", route.label),
            route.feature ? chip(`Fonction ${route.feature}`, "muted", "Fonctionnalité numérotée de la liste de recette (29 éléments)") : null,
            h("span", "mc-crumb-period", `${c.ec.p.label} · ${fmt.date(c.ec.p.from)} – ${fmt.date(c.ec.p.to)}${c.ec.dept ? " · " + c.ix.deptName(c.ec.dept) : ""}`));
    }

    // ------------------------------------------------------------ command palette (Ctrl+K)
    private paletteItems(c: Ctx): Array<{ kind: string; label: string; sub: string; icon: string; run: () => void }> {
        const items: Array<{ kind: string; label: string; sub: string; icon: string; run: () => void }> = [];
        ROUTES.forEach(r => items.push({ kind: "Module", label: r.label, sub: r.group, icon: r.icon, run: () => this.go(r.id) }));
        const act = (label: string, ic: string, run: () => void): void => { items.push({ kind: "Action", label, sub: "Action", icon: ic, run }); };
        act("Nouvelle tâche", "Plus", () => { this.s.m.newTask = true; this.go("tasks"); });
        act("Changer de thème", "Sun", () => { this.store.prefs.theme = this.store.prefs.theme === "dark" ? "light" : "dark"; this.store.savePrefs(); this.render(); });
        act("Lancer une simulation de crise", "Flame", () => this.go("crisis"));
        act("Demander à l'assistant : Qu'est-ce qui a changé ce mois-ci ?", "Bot", () => { this.s.m.ask = "Qu'est-ce qui a changé ce mois-ci ?"; this.go("assistant"); });
        c.d.customers.forEach(r => items.push({ kind: "Client", label: r.customer_name, sub: `${r.customer_id} · ${r.region} · ${r.customer_status}`, icon: "Users", run: () => c.select("customer", r.customer_id) }));
        c.d.products.forEach(r => items.push({ kind: "Produit", label: r.product_name, sub: `${r.product_id} · ${r.category}`, icon: "Package", run: () => c.select("product", r.product_id) }));
        c.d.projects.forEach(r => items.push({ kind: "Projet", label: r.project_name, sub: `${r.project_id} · ${r.project_status}`, icon: "ChartGantt", run: () => c.select("project", r.project_id) }));
        c.d.suppliers.forEach(r => items.push({ kind: "Fournisseur", label: r.supplier_name, sub: `${r.supplier_id} · ${r.country}`, icon: "Truck", run: () => c.select("supplier", r.supplier_id) }));
        c.d.departments.forEach(r => items.push({ kind: "Département", label: r.department_name, sub: r.division, icon: "Building", run: () => c.select("department", r.department_id) }));
        c.d.employees.forEach(r => items.push({ kind: "Employé", label: r.employee_name, sub: `${r.employee_id} · ${r.job_title}`, icon: "User", run: () => c.select("employee", r.employee_id) }));
        c.d.sales_orders.forEach(r => items.push({ kind: "Commande", label: r.order_id, sub: `${c.ix.custName(r.customer_id)} · ${fmt.compact(r.gross_amount_tnd)} · ${r.order_status}`, icon: "Receipt", run: () => c.select("order", r.order_id) }));
        c.d.tasks.forEach(r => items.push({ kind: "Tâche", label: r.task_title, sub: `${r.task_id} · ${r.task_status}`, icon: "SquareKanban", run: () => c.select("task", r.task_id) }));
        c.d.alerts.forEach(r => items.push({ kind: "Alerte", label: `${r.alert_type} ${r.alert_id}`, sub: `${r.severity} · ${r.alert_status}`, icon: "Bell", run: () => c.select("alert", r.alert_id) }));
        c.d.incidents.forEach(r => items.push({ kind: "Incident", label: `${r.incident_type} ${r.incident_id}`, sub: `${r.severity} · ${r.incident_status}`, icon: "Siren", run: () => c.select("incident", r.incident_id) }));
        return items;
    }
    private palette(c: Ctx): void {
        const all = this.paletteItems(c);
        const q = this.s.paletteQ.trim().toLowerCase();
        const res = q ? all.filter(i => `${i.label} ${i.sub} ${i.kind}`.toLowerCase().includes(q)).slice(0, 40) : all.filter(i => i.kind === "Module" || i.kind === "Action").slice(0, 14);
        this.s.paletteIdx = Math.max(0, Math.min(this.s.paletteIdx, res.length - 1));
        const close = (): void => { this.s.palette = false; this.render(); };
        const run = (i: number): void => { const it = res[i]; if (!it) { return; } if (q) { this.s.recent = [this.s.paletteQ, ...this.s.recent.filter(r => r !== this.s.paletteQ)].slice(0, 6); } this.s.palette = false; it.run(); };
        const inp = h("input", { class: "mc-palette-input", placeholder: "Tapez pour rechercher modules, clients, produits, commandes, projets, tâches, alertes, actions…", "data-focus": "palette", "aria-label": "Recherche dans la palette de commandes", role: "combobox", "aria-expanded": "true" }) as HTMLInputElement;
        inp.value = this.s.paletteQ;
        inp.oninput = (): void => { this.s.paletteQ = inp.value; this.s.paletteIdx = 0; this.render(); };
        inp.onkeydown = (e: KeyboardEvent): void => {
            if (e.key === "ArrowDown") { e.preventDefault(); this.s.paletteIdx = Math.min(res.length - 1, this.s.paletteIdx + 1); this.render(); }
            else if (e.key === "ArrowUp") { e.preventDefault(); this.s.paletteIdx = Math.max(0, this.s.paletteIdx - 1); this.render(); }
            else if (e.key === "Enter") { e.preventDefault(); run(this.s.paletteIdx); }
            else if (e.key === "Escape") { e.preventDefault(); close(); }
        };
        const list = h("div", { class: "mc-palette-list", role: "listbox" });
        if (!res.length) { list.appendChild(h("div", "mc-palette-empty", icon("SearchX" as any, 18), `Aucun résultat pour « ${this.s.paletteQ} ». Essayez un nom de module, un client (ex. Client 0042) ou un numéro de commande (O00004).`)); }
        res.forEach((it, i) => {
            const row = h("div", { class: `mc-palette-row${i === this.s.paletteIdx ? " mc-on" : ""}`, role: "option", "aria-selected": i === this.s.paletteIdx ? "true" : "false" }, icon(it.icon, 16), h("div", "mc-palette-text", h("div", null, it.label), h("div", "mc-palette-sub", it.sub)), chip(it.kind, "muted"));
            row.onclick = (): void => run(i); row.onmouseenter = (): void => { if (this.s.paletteIdx !== i) { this.s.paletteIdx = i; list.querySelectorAll(".mc-palette-row").forEach((r2, k) => r2.classList.toggle("mc-on", k === i)); } };
            list.appendChild(row);
        });
        const recent = !q && this.s.recent.length ? h("div", "mc-palette-recent", h("span", null, "Récent :"), ...this.s.recent.map(r => { const b = h("button", { type: "button", class: "mc-link" }, r); b.onclick = (): void => { this.s.paletteQ = r; this.render(); }; return b; }), h("button", { type: "button", class: "mc-link", onclick: () => { this.s.recent = []; this.render(); } }, "Effacer")) : null;
        const veil = h("div", "mc-veil"); veil.onclick = close;
        c.overlay.appendChild(veil);
        c.overlay.appendChild(h("div", { class: "mc-palette", role: "dialog", "aria-label": "Palette de commandes" }, h("div", "mc-palette-head", icon("Command", 18), inp, h("kbd", null, "Échap")), recent, list,
            h("div", "mc-palette-foot", "↑ ↓ pour naviguer · Entrée pour ouvrir · Échap pour fermer · Ctrl+K depuis n'importe où dans l'application.")));
        window.setTimeout(() => inp.focus(), 0);
    }

    public onKey(e: KeyboardEvent): void {
        if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); this.s.palette = !this.s.palette; this.s.paletteQ = ""; this.s.paletteIdx = 0; this.render(); return; }
        if (e.key === "Escape" && (this.s.selection || this.s.notifOpen || this.s.palette)) { this.s.selection = null; this.s.notifOpen = false; this.s.palette = false; this.render(); }
    }

    public destroy(): void { this.root.removeEventListener("keydown", this.keyHandler); this.ch.dispose(); }
}

export function periodSummary(c: Ctx): string { return `${c.ec.p.label}${c.ec.dept ? " · " + c.ix.deptName(c.ec.dept) : ""}`; }
export function prevKpis(c: Ctx): ReturnType<typeof kpis> { return kpis(c.ix, c.prev); }
