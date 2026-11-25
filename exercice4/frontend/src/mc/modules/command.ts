"use strict";

/**
 * Command modules: Command Center (customizable dashboard, feature 3), Executive War Room (28),
 * Financial Terminal (22), Data Storytelling (23), Executive Brief / Report Studio.
 */
import type { Ctx } from "../app";
import { prevKpis } from "../app";
import { addDays, addMonths, companyHealth, conflicts, day, deptHealth, expandEvents, isOverdueTask, kpis, missionQueue, month, monthLabel, monthRange, revenueByMonth, riskByCategory, sum, whatChanged } from "../core/engine";
import { DEFAULT_WIDGETS, Widget } from "../core/state";
import { STATUS_TONE } from "../core/theme";
import { bar, btn, card, chip, empty, fmt, gauge, h, icon, iconBtn, kpiTile, ring, select, sparkline } from "../core/ui";
import { KPI_DEFS } from "./inspector";
import { campus } from "./world";

const WIDGET_NAMES: Record<string, string> = {
    kpis: "Cartes KPI", hero: "Accueil et campus 3D", health: "Santé de l'entreprise", assistant: "Assistant IA", sales: "Aperçu des ventes", geo: "Performance régionale",
    radar: "Radar des risques", calendar: "Calendrier", missions: "Avancement des missions", tasks: "Tâches actives", actions: "Actions rapides", crisis: "Simulateur de crise",
    matrix: "Matrice de santé des départements", changed: "Qu'est-ce qui a changé ?", ticker: "Bandeau des KPI"
};

function monthlyRevenue(c: Ctx, months: number): Array<{ m: string; v: number }> {
    const rm = revenueByMonth(c.ix, c.ec.dept);
    return monthRange(month(addMonths(c.ix.ref, -(months - 1))), month(c.ix.ref)).map(m => ({ m, v: rm.get(m)?.net ?? 0 }));
}

// ======================================================================== Command Center
export function command(c: Ctx, el: HTMLElement): void {
    const prefs = c.store.prefs;
    const edit = c.s.editLayout;
    const cur = kpis(c.ix, c.ec), prev = prevKpis(c);
    const tb = h("div", "mc-page-toolbar",
        h("div", "mc-page-title", h("h1", null, "Centre de commande"), h("span", "mc-muted", `Bon retour · données au ${fmt.date(c.ix.ref)}`)),
        h("div", "mc-row-gap",
            edit ? select(Object.keys(WIDGET_NAMES).filter(id => !prefs.widgets.some(w => w.id === id)).map(id => ({ value: id, label: WIDGET_NAMES[id] })), "", v => { if (v) { prefs.widgets.push({ id: v, size: "s" }); c.store.savePrefs(); c.rerender(); } }, undefined, "+ Ajouter un widget…") : null,
            edit ? btn("Réinitialiser la disposition", { icon: "RotateCcw", small: true, onClick: () => { prefs.widgets = DEFAULT_WIDGETS.map(w => ({ ...w })); c.store.savePrefs(); c.toast("Disposition réinitialisée"); c.rerender(); } }) : null,
            btn(edit ? "Terminé" : "Personnaliser", { icon: edit ? "Check" : "LayoutGrid", small: true, kind: edit ? "primary" : "soft", onClick: () => { c.s.editLayout = !edit; c.rerender(); } })));
    el.appendChild(tb);
    if (edit) { el.appendChild(h("div", "mc-hint", icon("Move", 14), "Faites glisser un widget par sa poignée pour le déplacer · S/M/L pour le redimensionner · × pour le retirer. La disposition est enregistrée sur votre compte.")); }
    const grid = h("div", `mc-dash${edit ? " mc-dash-edit" : ""}`);
    el.appendChild(grid);
    prefs.widgets.forEach((w, idx) => {
        const holder = h("div", { class: `mc-widget mc-w-${w.size}`, "data-widget": w.id });
        if (edit) {
            holder.draggable = true;
            holder.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", String(idx)); holder.classList.add("mc-dragging"); };
            holder.ondragend = (): void => holder.classList.remove("mc-dragging");
            holder.ondragover = (e: DragEvent): void => { e.preventDefault(); holder.classList.add("mc-drop"); };
            holder.ondragleave = (): void => holder.classList.remove("mc-drop");
            holder.ondrop = (e: DragEvent): void => { e.preventDefault(); const from = Number(e.dataTransfer?.getData("text/plain")); const moved = prefs.widgets.splice(from, 1)[0]; prefs.widgets.splice(idx, 0, moved); c.store.savePrefs(); c.rerender(); };
            holder.appendChild(h("div", "mc-widget-edit", h("span", "mc-grip", icon("GripVertical", 14), WIDGET_NAMES[w.id] ?? w.id),
                ...(["s", "m", "l"] as Widget["size"][]).map(sz => { const b = h("button", { class: `mc-size${w.size === sz ? " mc-on" : ""}`, type: "button", "aria-label": `Taille ${sz}` }, sz.toUpperCase()); b.onclick = (): void => { w.size = sz; c.store.savePrefs(); c.rerender(); }; return b; }),
                iconBtn("ArrowUp", "Monter", () => { if (idx > 0) { [prefs.widgets[idx - 1], prefs.widgets[idx]] = [prefs.widgets[idx], prefs.widgets[idx - 1]]; c.store.savePrefs(); c.rerender(); } }),
                iconBtn("X", "Retirer le widget", () => { prefs.widgets.splice(idx, 1); c.store.savePrefs(); c.rerender(); })));
        }
        grid.appendChild(holder);
        try { (WIDGETS[w.id] ?? (() => holder.appendChild(empty(`Widget inconnu ${w.id}`))))(c, holder, cur, prev); }
        catch (err) { holder.appendChild(empty(`${WIDGET_NAMES[w.id]}: ${(err as Error).message}`, "TriangleAlert")); }
    });
    if (!prefs.widgets.length) { grid.appendChild(empty("Aucun widget. Cliquez sur Personnaliser › Ajouter un widget.", "LayoutGrid")); }
}

type W = (c: Ctx, el: HTMLElement, cur: ReturnType<typeof kpis>, prev: ReturnType<typeof kpis>) => void;
const WIDGETS: Record<string, W> = {
    kpis: (c, el, cur, prev) => {
        const series = monthlyRevenue(c, 12).map(x => x.v);
        const row = h("div", "mc-kpi-row");
        c.store.prefs.kpis.forEach(id => {
            const def = KPI_DEFS[id]; if (!def) { return; }
            const a = def.get(cur), b = def.get(prev);
            row.appendChild(kpiTile({ id, label: def.label, value: a, format: def.fmt, delta: a !== null && b ? (a - b) / Math.abs(b) : null, deltaGood: def.good, icon: def.icon, spark: id === "netRevenue" ? series : undefined, note: "vs période précédente", onClick: () => c.select("kpi", id) }));
        });
        el.appendChild(row);
    },
    hero: (c, el) => {
        const { el: cd, body } = card("", { cls: "mc-hero" });
        body.appendChild(h("div", "mc-hero-text",
            h("div", "mc-hero-title", h("span", "mc-accent", "Bon retour"), ", commandant"),
            h("div", "mc-muted", "Voici ce qui se passe dans votre entreprise. Cliquez sur un bâtiment pour inspecter un département."),
            h("div", "mc-row-gap", btn("Voir le détail", { icon: "ArrowRight", kind: "primary", small: true, onClick: () => c.go("twin") }), btn("Salle de crise", { icon: "Siren", small: true, onClick: () => c.go("warroom") })),
            h("div", "mc-row-gap", chip("● En direct depuis MySQL", "good"), h("span", "mc-muted", `Dernière donnée ${fmt.date(c.ix.ref)}`))));
        const stage = h("div", "mc-hero-stage"); body.appendChild(stage);
        campus(c, stage, { mini: true });
        el.appendChild(cd);
    },
    health: (c, el) => {
        const hs = deptHealth(c.ix, c.ec); const score = companyHealth(hs);
        const { el: cd, body } = card("Santé de l'entreprise", { icon: "Activity", actions: [iconBtn("Info", "Formule : moyenne des scores des départements (100 moins des pénalités pour incidents critiques, tâches en retard, projets à risque, exposition aux risques ouverts)", () => c.go("warroom"))] });
        body.appendChild(gauge(score, 100, `${score} %`, score >= 75 ? "Excellent" : score >= 60 ? "Bon" : score >= 45 ? "Sous surveillance" : "Critique", score >= 60 ? "good" : score >= 45 ? "warn" : "bad"));
        const trend = monthlyRevenue(c, 12).map(x => x.v); body.appendChild(sparkline(trend, 220, 34, "mc-spark mc-spark-good"));
        el.appendChild(cd);
    },
    assistant: (c, el) => {
        const { el: cd, body } = card("Assistant IA métier", { icon: "Sparkles", actions: [chip("Démo · à base de règles", "info")] });
        const q = "Qu'est-ce qui a changé ce mois-ci ?";
        body.appendChild(h("div", "mc-chat-bubble mc-chat-user", q));
        const k = kpis(c.ix, c.ec), p = prevKpis(c), ch = whatChanged(k, p)[0];
        body.appendChild(h("div", "mc-chat-bubble mc-chat-bot", ch.text, h("div", "mc-cite", `Source : sales_orders · ${c.ec.p.label} vs période précédente`)));
        const inp = h("input", { class: "mc-input", placeholder: "Posez une question…", "aria-label": "Interroger l'assistant", "data-focus": "mini-assistant" }) as HTMLInputElement;
        inp.onkeydown = (e: KeyboardEvent): void => { if (e.key === "Enter" && inp.value.trim()) { c.s.m.ask = inp.value.trim(); c.go("assistant"); } };
        body.appendChild(h("div", "mc-chat-input", inp, iconBtn("Send", "Demander", () => { c.s.m.ask = inp.value.trim() || q; c.go("assistant"); })));
        el.appendChild(cd);
    },
    sales: (c, el) => {
        const span = c.m<string>("salesSpan", () => "6M"); const n = { "3M": 3, "6M": 6, "1Y": 12, "2Y": 23 }[span] ?? 6;
        const data = monthlyRevenue(c, n);
        const { el: cd, body } = card("Aperçu des ventes", { icon: "ChartLine", sub: "CA net par mois (commandes Terminé + En traitement)", actions: ["3M", "6M", "1Y", "2Y"].map(sp => { const b = h("button", { class: `mc-seg${sp === span ? " mc-on" : ""}`, type: "button" }, sp); b.onclick = (): void => { c.s.m.salesSpan = sp; c.rerender(); }; return b; }) });
        const chartEl = h("div", "mc-chart mc-h200"); body.appendChild(chartEl);
        c.ch.line(chartEl, data.map(x => monthLabel(x.m)), [{ name: "CA net", data: data.map(x => x.v) }], p => c.select("kpi", "netRevenue"), v => c.ch.short(v));
        el.appendChild(cd);
    },
    geo: (c, el) => {
        const byRegion = new Map<string, number>(); c.d.sales_orders.forEach(o => { if (o.order_status === "Terminé" || o.order_status === "En traitement") { if (day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to) { const r = c.ix.cust.get(o.customer_id)?.region ?? "—"; byRegion.set(r, (byRegion.get(r) ?? 0) + o.net_amount_tnd); } } });
        const total = Array.from(byRegion.values()).reduce((a, b) => a + b, 0);
        const { el: cd, body } = card("Performance régionale", { icon: "Globe", sub: "Tunisie · part du CA par région client", actions: [iconBtn("ArrowUpRight", "Ouvrir l'intelligence géographique", () => c.go("geo"))] });
        Array.from(byRegion.entries()).sort((a, b) => b[1] - a[1]).forEach(([r, v]) => body.appendChild(h("div", "mc-region-row", h("span", null, r), bar(total ? v / total : 0), h("b", null, fmt.pct(total ? v / total : 0)))));
        el.appendChild(cd);
    },
    radar: (c, el) => {
        const cats = riskByCategory(c.ix, c.ec.dept);
        const top = Math.max(...cats.map(x => x.score), 0);
        const { el: cd, body } = card("Radar des risques", { icon: "Radar", actions: [chip(top >= 45 ? "Élevé" : top >= 25 ? "Modéré" : "Risque faible", top >= 45 ? "bad" : top >= 25 ? "warn" : "good")] });
        const chartEl = h("div", "mc-chart mc-h200"); body.appendChild(chartEl);
        c.ch.radar(chartEl, cats.map(x => ({ name: x.cat, max: 100 })), [{ name: "Score des risques ouverts", values: cats.map(x => x.score) }], () => c.go("risk"));
        el.appendChild(cd);
    },
    calendar: (c, el) => {
        const m = c.m<string>("miniCalMonth", () => month(c.ix.ref));
        const first = m + "-01", last = addDays(addMonths(first, 1), -1);
        const evs = expandEvents(c.d.calendar_events, first, last);
        const { el: cd, body } = card("Calendrier", { icon: "CalendarDays", actions: [iconBtn("ChevronLeft", "Mois précédent", () => { c.s.m.miniCalMonth = month(addMonths(first, -1)); c.rerender(); }), h("b", null, monthLabel(m)), iconBtn("ChevronRight", "Mois suivant", () => { c.s.m.miniCalMonth = month(addMonths(first, 1)); c.rerender(); })] });
        const grid = h("div", "mc-mini-cal"); ["S", "M", "T", "W", "T", "F", "S"].forEach(dn => grid.appendChild(h("div", "mc-mini-dow", dn)));
        const dow = new Date(first + "T00:00:00Z").getUTCDay(); for (let i = 0; i < dow; i++) { grid.appendChild(h("div")); }
        for (let dd = 1; dd <= Number(last.slice(8)); dd++) {
            const iso = `${m}-${String(dd).padStart(2, "0")}`; const n = evs.filter(e => day(e.start) === iso).length;
            const cell = h("button", { class: `mc-mini-day${iso === c.ix.ref ? " mc-today" : ""}${n ? " mc-has" : ""}`, type: "button", title: `${n} événement(s)` }, String(dd));
            cell.onclick = (): void => { c.s.m.calDate = iso; c.s.m.calView = "day"; c.go("calendar"); };
            grid.appendChild(cell);
        }
        body.appendChild(grid);
        const cf = conflicts(evs); if (cf.length) { body.appendChild(h("div", "mc-small mc-tone-warn", icon("TriangleAlert", 12), `${cf.length} conflit(s) de planning ce mois-ci`)); }
        el.appendChild(cd);
    },
    missions: (c, el) => {
        const act = c.d.missions.filter(m => m.mission_status === "Actif").sort((a, b) => b.progress_pct - a.progress_pct);
        const avg = act.length ? act.reduce((s, m) => s + m.progress_pct, 0) / act.length : 0;
        const top = act[0];
        const { el: cd, body } = card("Avancement des missions", { icon: "Trophy", actions: [btn("Voir les missions", { small: true, kind: "ghost", icon: "ArrowRight", onClick: () => c.go("missions") })] });
        body.appendChild(h("div", "mc-mission-mini", ring(avg, 86, "accent", fmt.pct(avg, 0)),
            h("div", null, h("div", "mc-muted", `${act.length} missions actives · avancement moyen`), top ? h("div", null, h("b", null, top.mission_title), h("div", "mc-muted", `${top.mission_category} · ${c.ix.deptName(top.department_id)}`), bar(top.progress_pct), h("div", "mc-small", `Avancement ${fmt.pct(top.progress_pct, 0)} · seuil ${fmt.pct(top.completion_threshold_pct, 0)}`)) : null)));
        el.appendChild(cd);
    },
    tasks: (c, el) => {
        const pr = { "Critique": 0, "Élevée": 1, "Moyenne": 2, "Faible": 3 } as Record<string, number>;
        const list = c.d.tasks.filter(t => t.task_status !== "Terminé" && (!c.ec.dept || t.department_id === c.ec.dept)).sort((a, b) => (pr[a.priority] - pr[b.priority]) || a.due_date.localeCompare(b.due_date)).slice(0, 6);
        const { el: cd, body } = card("Tâches actives", { icon: "ClipboardList", actions: [btn("Tout voir", { small: true, kind: "ghost", icon: "ArrowRight", onClick: () => c.go("tasks") })] });
        list.forEach(t => { const r = h("div", { class: "mc-task-row mc-click", tabindex: 0 }, h("div", "mc-avatar-sm", c.ix.empName(t.assignee_employee_id).slice(0, 1)), h("span", "mc-grow", t.task_title), chip(t.priority, t.priority === "Critique" ? "bad" : t.priority === "Élevée" ? "warn" : t.priority === "Moyenne" ? "info" : "muted"), h("span", `mc-small ${isOverdueTask(t, c.ix.ref) ? "mc-tone-bad" : "mc-muted"}`, isOverdueTask(t, c.ix.ref) ? `En retard depuis le ${fmt.date(t.due_date)}` : `Échéance ${fmt.date(t.due_date)}`)); r.onclick = (): void => c.select("task", t.task_id); body.appendChild(r); });
        if (!list.length) { body.appendChild(empty("Aucune tâche ouverte.")); }
        el.appendChild(cd);
    },
    actions: (c, el) => {
        const { el: cd, body } = card("Actions rapides", { icon: "Zap" });
        const qa = (ic: string, label: string, run: () => void): HTMLElement => { const b = h("button", { class: "mc-quick", type: "button" }, icon(ic, 22), h("span", null, label)); b.onclick = run; return b; };
        body.appendChild(h("div", "mc-quick-grid", qa("SlidersHorizontal", "Simulateur", () => c.go("whatif")), qa("Table", "Explorer les données", () => c.go("explorer")), qa("Plus", "Nouvelle tâche", () => { c.s.m.newTask = true; c.go("tasks"); }), qa("CalendarClock", "Ajouter un événement", () => { c.s.m.newEvent = true; c.go("calendar"); })));
        el.appendChild(cd);
    },
    crisis: (c, el) => {
        const { el: cd, body } = card("Simulateur de crise", { icon: "TriangleAlert", cls: "mc-card-danger" });
        body.appendChild(h("div", "mc-muted", "Testez votre préparation face aux chocs de CA, de coûts, d'attrition, de fournisseurs et de systèmes."));
        body.appendChild(h("div", "mc-crisis-art", icon("TriangleAlert", 54)));
        body.appendChild(btn("Lancer la simulation", { icon: "ArrowRight", kind: "primary", onClick: () => c.go("crisis") }));
        el.appendChild(cd);
    },
    matrix: (c, el) => {
        const hs = deptHealth(c.ix, c.ec);
        const { el: cd, body } = card("Matrice de santé des départements", { icon: "LayoutGrid", sub: "Score = 100 moins des pénalités transparentes · cliquez sur une ligne pour le détail" });
        const t = h("table", "mc-table mc-matrix", h("thead", null, h("tr", null, ...["Département", "Score", "Statut", "Chiffre d'affaires", "Dépenses", "Inc. ouverts", "Critique", "Tâches en retard", "Proj. à risque", "Exposition aux risques ouverts", "Pourquoi"].map(x => h("th", null, x)))));
        const tb = h("tbody"); t.appendChild(tb);
        hs.forEach(x => { const tr = h("tr", { class: "mc-click", tabindex: 0 }, h("td", null, h("b", null, x.name)), h("td", null, h("span", `mc-score mc-tone-${x.status === "Sain" ? "good" : x.status === "Sous surveillance" ? "warn" : "bad"}`, String(x.score))), h("td", null, chip(x.status, x.status === "Sain" ? "good" : x.status === "Sous surveillance" ? "warn" : "bad")), h("td", "mc-num", fmt.compact(x.revenue)), h("td", "mc-num", fmt.compact(x.expenses)), h("td", "mc-num", String(x.openIncidents)), h("td", "mc-num", String(x.critical)), h("td", "mc-num", String(x.overdueTasks)), h("td", "mc-num", String(x.atRiskProjects)), h("td", "mc-num", fmt.compact(x.openRiskExposure)), h("td", "mc-small mc-muted", x.drivers.join(" · ") || "aucune pénalité")); tr.onclick = (): void => c.select("department", x.id); tb.appendChild(tr); });
        body.appendChild(h("div", "mc-table-scroll", t));
        el.appendChild(cd);
    },
    changed: (c, el, cur, prev) => {
        const ch = whatChanged(cur, prev);
        const { el: cd, body } = card("Qu'est-ce qui a changé ?", { icon: "Lightbulb", sub: `${c.ec.p.label} vs la période précédente de même durée · règles déterministes, pas d'IA` });
        ch.forEach(x => body.appendChild(h("div", `mc-change mc-tone-${x.tone}`, icon(x.tone === "good" ? "TrendingUp" : x.tone === "bad" ? "TrendingDown" : "Minus", 15), h("span", null, x.text))));
        el.appendChild(cd);
    },
    ticker: (c, el, cur, prev) => {
        const items = Object.keys(KPI_DEFS).map(id => { const d = KPI_DEFS[id]; const a = d.get(cur), b = d.get(prev); const dl = a !== null && b ? (a - b) / Math.abs(b) : null; return h("span", "mc-tick", h("b", null, d.label.toUpperCase()), h("span", null, a === null ? "—" : d.fmt(a)), dl === null ? null : h("span", (dl >= 0) === d.good ? "mc-tone-good" : "mc-tone-bad", `${dl >= 0 ? "▲" : "▼"} ${Math.abs(dl * 100).toFixed(1).replace(".", ",")} %`)); });
        el.appendChild(h("div", { class: "mc-ticker", "aria-label": "Bandeau des KPI — indicateurs métier, pas des cours de bourse" }, h("div", "mc-ticker-track", ...items, ...items.map(n => n.cloneNode(true) as HTMLElement))));
    }
};

// ======================================================================== Executive War Room (28)
export function warroom(c: Ctx, el: HTMLElement): void {
    const hs = deptHealth(c.ix, c.ec), score = companyHealth(hs), k = kpis(c.ix, c.ec);
    const q = missionQueue(c.ix);
    el.appendChild(h("div", "mc-page-title", h("h1", null, "Salle de crise de direction"), h("span", "mc-muted", "Santé consolidée, alertes critiques, risques majeurs, missions, décisions en attente, incidents et priorités recommandées.")));
    const g = h("div", "mc-grid mc-g-4"); el.appendChild(g);
    const a = card("Santé de l'entreprise", { icon: "Activity" }); a.body.appendChild(gauge(score, 100, `${score}`, "indice de santé", score >= 60 ? "good" : score >= 45 ? "warn" : "bad")); a.body.appendChild(h("div", "mc-small mc-muted", `${hs.filter(x => x.status === "Critique").length} critiques · ${hs.filter(x => x.status === "Sous surveillance").length} sous surveillance · ${hs.filter(x => x.status === "Sain").length} départements sains`)); g.appendChild(a.el);
    const tiles = [["Alertes critiques", k.criticalAlerts, "Bell", "risk"], ["Incidents critiques", k.criticalIncidents, "Siren", "queue"], ["Tâches en retard", k.overdueTasks, "AlarmClock", "tasks"], ["Approbations en attente", c.d.approval_requests.filter(r => r.approval_status === "En attente" || r.approval_status === "Informations requises").length, "CheckCheck", "approvals"], ["Décisions proposées", c.d.decisions.filter(r => r.decision_status === "Proposé").length, "Scale", "decisions"], ["Missions bloquées", c.d.missions.filter(m => m.mission_status === "Bloqué").length, "Target", "missions"]] as Array<[string, number, string, string]>;
    const tg = card("Situation", { icon: "Crosshair" }); tg.body.appendChild(h("div", "mc-stat-grid", ...tiles.map(([l, v, ic, r]) => { const b = h("button", { class: "mc-stat", type: "button" }, icon(ic, 16), h("b", { "data-count": String(v) }, String(v)), h("span", null, l)); (b.querySelector("b") as any).__fmt = (x: number) => fmt.int(x); b.onclick = (): void => c.go(r); return b; }))); tg.el.classList.add("mc-span-2"); g.appendChild(tg.el);
    const rr = card("Risques majeurs (ouverts, plus forte exposition)", { icon: "ShieldAlert" });
    c.d.risk_register.filter(r => r.mitigation_status === "Ouvert" || r.mitigation_status === "En atténuation").sort((x, y) => y.estimated_exposure_tnd - x.estimated_exposure_tnd).slice(0, 6).forEach(r => { const e = h("div", "mc-ins-row mc-click", h("span", null, `${r.risk_category} · ${r.risk_id}`), chip(r.severity, r.severity === "Critique" ? "bad" : r.severity === "Élevée" ? "warn" : "info"), h("b", null, fmt.compact(r.estimated_exposure_tnd))); e.onclick = (): void => c.select("risk", r.risk_id); rr.body.appendChild(e); });
    g.appendChild(rr.el);
    const pq = card("Priorités recommandées (haut de la file des missions)", { icon: "ListChecks", sub: "Score de priorité = 40·gravité + 30·impact + 20·ancienneté + 10·confiance" }); pq.el.classList.add("mc-span-2");
    q.slice(0, 8).forEach(x => { const e = h("div", "mc-queue-row mc-click", h("span", "mc-score", String(x.score)), chip(x.type, "muted"), h("span", "mc-grow", x.title), chip(x.severity, x.severity === "Critique" ? "bad" : x.severity === "Élevée" ? "warn" : "info"), h("span", "mc-muted mc-small", x.dept)); e.onclick = (): void => c.go(x.module); pq.body.appendChild(e); });
    g.appendChild(pq.el);
    const ms = card("Avancement des missions", { icon: "Target" });
    c.d.missions.filter(m => m.mission_status === "Actif" || m.mission_status === "Bloqué").sort((a2, b) => a2.target_date.localeCompare(b.target_date)).slice(0, 6).forEach(m => ms.body.appendChild(h("div", "mc-mission-line", h("span", null, m.mission_title), bar(m.progress_pct, m.mission_status === "Bloqué" ? "bad" : "accent"), h("span", "mc-small", fmt.pct(m.progress_pct, 0)))));
    g.appendChild(ms.el);
    const inc = card("Statut des incidents", { icon: "Siren" }); const incEl = h("div", "mc-chart mc-h180"); inc.body.appendChild(incEl);
    const byStatus = new Map<string, number>(); c.d.incidents.forEach(i => byStatus.set(i.incident_status, (byStatus.get(i.incident_status) ?? 0) + 1));
    c.ch.donut(incEl, Array.from(byStatus.entries()).map(([n, v]) => ({ name: n, value: v, color: (c.t as any)[STATUS_TONE[n] === "good" ? "good" : STATUS_TONE[n] === "bad" ? "bad" : STATUS_TONE[n] === "warn" ? "warn" : "info"] })), () => c.go("queue"), v => fmt.int(v));
    g.appendChild(inc.el);
}

// ======================================================================== Financial Terminal (22)
export function terminal(c: Ctx, el: HTMLElement): void {
    const prefs = c.store.prefs;
    const cur = kpis(c.ix, c.ec), prev = prevKpis(c);
    const months = monthRange(month(addMonths(c.ix.ref, -11)), month(c.ix.ref));
    const series = (id: string): number[] => months.map(m => { const from = m + "-01"; return KPI_DEFS[id].get(kpis(c.ix, { p: { from, to: addDays(addMonths(from, 1), -1), label: "" }, dept: c.ec.dept })) ?? 0; });
    const sel = c.m<string>("termMetric", () => prefs.watchlist[0] ?? "netRevenue");
    el.appendChild(h("div", "mc-page-title", h("h1", null, "Terminal financier"), chip("Indicateurs métier — pas des cours de bourse en direct", "warn")));
    WIDGETS.ticker(c, el, cur, prev);
    const g = h("div", "mc-grid mc-g-terminal"); el.appendChild(g);
    const wl = card("Liste de suivi", { icon: "Star", sub: "Épinglez des indicateurs (enregistré sur votre compte)" });
    Object.keys(KPI_DEFS).forEach(id => {
        const d = KPI_DEFS[id], a = d.get(cur), b = d.get(prev), dl = a !== null && b ? (a - b) / Math.abs(b) : null, pinned = prefs.watchlist.includes(id);
        const row = h("div", { class: `mc-watch-row mc-click${sel === id ? " mc-on" : ""}`, tabindex: 0 },
            iconBtn(pinned ? "Star" : "Pin", pinned ? "Désépingler" : "Épingler à la liste de suivi", () => { prefs.watchlist = pinned ? prefs.watchlist.filter(x => x !== id) : prefs.watchlist.concat(id); c.store.savePrefs(); c.rerender(); }, pinned ? "mc-on" : ""),
            h("span", "mc-grow", d.label), h("b", null, a === null ? "—" : d.fmt(a)), h("span", `mc-small ${dl === null ? "" : (dl >= 0) === d.good ? "mc-tone-good" : "mc-tone-bad"}`, dl === null ? "" : `${dl >= 0 ? "▲" : "▼"}${Math.abs(dl * 100).toFixed(1).replace(".", ",")} %`));
        row.onclick = (): void => { c.s.m.termMetric = id; c.rerender(); };
        if (pinned) { wl.body.insertBefore(row, wl.body.firstChild); } else { wl.body.appendChild(row); }
    });
    g.appendChild(wl.el);
    const main = card(`${KPI_DEFS[sel].label} · 12 mois`, { icon: "ChartCandlestick", sub: KPI_DEFS[sel].rule }); const ch = h("div", "mc-chart mc-h260"); main.body.appendChild(ch);
    const s = series(sel); c.ch.line(ch, months.map(monthLabel), [{ name: KPI_DEFS[sel].label, data: s }], undefined, v => KPI_DEFS[sel].fmt(v));
    const hi = Math.max(...s), lo = Math.min(...s);
    main.body.appendChild(h("div", "mc-stat-grid", ...[["Dernier", s[s.length - 1]], ["Élevée", hi], ["Faible", lo], ["Moy. 12 mois", s.reduce((a, b) => a + b, 0) / s.length]].map(([l, v]) => h("div", "mc-stat", h("span", null, String(l)), h("b", null, KPI_DEFS[sel].fmt(v as number))))));
    g.appendChild(main.el);
    const sp = card("Tableau des tendances", { icon: "ChartLine" });
    prefs.watchlist.forEach(id => sp.body.appendChild(h("div", "mc-spark-card", h("span", null, KPI_DEFS[id]?.label ?? id), sparkline(series(id), 140, 30))));
    if (!prefs.watchlist.length) { sp.body.appendChild(empty("Épinglez des indicateurs dans la liste de suivi.", "Star")); }
    g.appendChild(sp.el);
}

// ======================================================================== Data Storytelling (23)
export function story(c: Ctx, el: HTMLElement): void {
    const ref = c.ix.ref; const ytd = { p: { from: ref.slice(0, 4) + "-01-01", to: ref, label: "Cumul annuel" }, dept: "" }; const lytd = { p: { from: String(Number(ref.slice(0, 4)) - 1) + "-01-01", to: String(Number(ref.slice(0, 4)) - 1) + ref.slice(4), label: "" }, dept: "" };
    const a = kpis(c.ix, ytd), b = kpis(c.ix, lytd);
    const hs = deptHealth(c.ix, ytd); const worst = hs.slice().sort((x, y) => x.score - y.score)[0];
    const topRisk = c.d.risk_register.filter(r => r.mitigation_status === "Ouvert").sort((x, y) => y.estimated_exposure_tnd - x.estimated_exposure_tnd)[0];
    const slides = [
        { title: "CA depuis le début de l'année", kpi: fmt.compact(a.netRevenue), text: `Le CA net atteint ${fmt.compact(a.netRevenue)} (${fmt.signedPct(b.netRevenue ? (a.netRevenue - b.netRevenue) / b.netRevenue : null)} par rapport à la même période l'an dernier) sur ${fmt.int(a.revenueOrders)} commandes.`, link: ["Ouvrir le KPI du CA", () => c.select("kpi", "netRevenue")] },
        { title: "Rentabilité", kpi: fmt.pct(a.gm), text: `La marge brute est de ${fmt.pct(a.gm)} contre ${fmt.pct(b.gm)} l'an dernier. Remises accordées : ${fmt.compact(a.discount)}.`, link: ["Cause racine", () => c.go("rootcause")] },
        { title: "Encaissement", kpi: fmt.pct(a.collectionRate), text: `${fmt.compact(a.paid)} encaissés, ${fmt.compact(a.outstanding)} restant dus, dont ${fmt.compact(a.overdue)} en retard (${a.overdueCount} paiements).`, link: ["Paiements en retard", () => c.select("kpi", "collectionRate")] },
        { title: "Risque opérationnel", kpi: String(a.openIncidents), text: `${a.openIncidents} incidents sont ouverts (${a.criticalIncidents} critiques). Département le plus fragile : ${worst?.name} (${worst?.score}/100 : ${worst?.drivers.join(", ") || "aucune pénalité"}).`, link: ["Salle de crise", () => c.go("warroom")] },
        { title: "Principal risque ouvert", kpi: topRisk ? fmt.compact(topRisk.estimated_exposure_tnd) : "—", text: topRisk ? `Le risque ${topRisk.risk_category} ${topRisk.risk_id} (${topRisk.severity}, confiance ${fmt.pct(topRisk.confidence_score, 0)}) présente la plus forte exposition ouverte.` : "Aucun risque ouvert.", link: ["Radar des risques", () => c.go("risk")] },
        { title: "Qualité des données", kpi: "2 anomalies", text: "La commande O00004 a un montant brut de 99 999 TND au lieu de net + taxe, et O00008 promet une livraison avant sa date de commande. Les deux sont conservées et signalées, pas corrigées en silence.", link: ["Docteur des données", () => c.go("doctor")] }
    ];
    const i = Math.min(c.m<number>("storyIdx", () => 0), slides.length - 1); const sl = slides[i];
    el.appendChild(h("div", "mc-page-title", h("h1", null, "Récit interactif des données"), h("span", "mc-muted", "Récit guidé construit à partir des données · utilisez ← → ou les boutons")));
    const stage = h("div", { class: "mc-story", tabindex: 0, "aria-live": "polite" },
        h("div", "mc-story-step", `${i + 1} / ${slides.length}`), h("div", "mc-story-title", sl.title), h("div", "mc-story-kpi", sl.kpi), h("div", "mc-story-text", sl.text),
        h("div", "mc-row-gap", btn("Retour", { icon: "ChevronLeft", disabled: i === 0, onClick: () => { c.s.m.storyIdx = i - 1; c.rerender(); } }), btn("Suivant", { icon: "ChevronRight", kind: "primary", disabled: i === slides.length - 1, onClick: () => { c.s.m.storyIdx = i + 1; c.rerender(); } }), btn(sl.link[0] as string, { icon: "ArrowUpRight", kind: "ghost", onClick: sl.link[1] as () => void })),
        h("div", "mc-story-dots", ...slides.map((_, k) => { const d2 = h("button", { class: `mc-dot${k === i ? " mc-on" : ""}`, type: "button", "aria-label": `Étape ${k + 1}` }); d2.onclick = (): void => { c.s.m.storyIdx = k; c.rerender(); }; return d2; })));
    stage.onkeydown = (e: KeyboardEvent): void => { if (e.key === "ArrowRight" && i < slides.length - 1) { c.s.m.storyIdx = i + 1; c.rerender(); } if (e.key === "ArrowLeft" && i > 0) { c.s.m.storyIdx = i - 1; c.rerender(); } };
    el.appendChild(stage);
    el.appendChild(h("div", "mc-hint", icon("Printer", 14), "Impression / PDF : utilisez l'impression du navigateur (Ctrl+P) et choisissez Enregistrer au format PDF"));
}

// ======================================================================== Executive Brief / Report Studio
export function synthesis(c: Ctx, el: HTMLElement): void {
    const secs = c.m<Record<string, boolean>>("briefSecs", () => ({ kpis: true, changes: true, risks: true, decisions: true, actions: true }));
    const k = kpis(c.ix, c.ec), p = prevKpis(c);
    el.appendChild(h("div", "mc-page-title", h("h1", null, "Synthèse de direction · Studio de rapport"), h("span", "mc-muted", "Choisissez les sections ; la période et le département viennent des filtres du bandeau.")));
    const opts = h("div", "mc-row-gap mc-wrap", ...Object.keys(secs).map(key => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = secs[key]; cb.onchange = (): void => { secs[key] = cb.checked; c.rerender(); }; return h("label", "mc-check", cb, ({ kpis: "KPI", changes: "Évolutions", risks: "Risques", decisions: "Décisions", actions: "Actions" } as Record<string, string>)[key] ?? key); }));
    el.appendChild(opts);
    const doc = h("article", "mc-doc");
    doc.appendChild(h("h2", null, `Synthèse de direction — ${c.ec.p.label}${c.ec.dept ? " · " + c.ix.deptName(c.ec.dept) : ""}`));
    doc.appendChild(h("p", "mc-muted", `${fmt.date(c.ec.p.from)} – ${fmt.date(c.ec.p.to)} · données synthétiques · montants en TND`));
    if (secs.kpis) { doc.appendChild(h("h3", null, "Chiffres clés")); doc.appendChild(h("ul", null, h("li", null, `CA net ${fmt.money(k.netRevenue)} (${fmt.signedPct(p.netRevenue ? (k.netRevenue - p.netRevenue) / p.netRevenue : null)} vs période précédente)`), h("li", null, `Marge brute ${fmt.pct(k.gm)} ; résultat d'exploitation ${fmt.money(k.operatingProfit)}`), h("li", null, `Taux d'encaissement ${fmt.pct(k.collectionRate)} ; en retard ${fmt.money(k.overdue)}`), h("li", null, `${k.openIncidents} incidents ouverts (${k.criticalIncidents} critiques) ; ${k.overdueTasks} tâches en retard`))); }
    if (secs.changes) { doc.appendChild(h("h3", null, "Principaux mouvements")); doc.appendChild(h("ul", null, ...whatChanged(k, p).map(x => h("li", null, x.text)))); }
    if (secs.risks) { doc.appendChild(h("h3", null, "Risques")); doc.appendChild(h("ul", null, ...riskByCategory(c.ix, c.ec.dept).sort((a, b) => b.exposure - a.exposure).slice(0, 4).map(r => h("li", null, `${r.cat} : ${r.open} risques ouverts, exposition ${fmt.compact(r.exposure)}, score moyen ${r.score}/100`)))); }
    if (secs.decisions) { doc.appendChild(h("h3", null, "Décisions")); doc.appendChild(h("ul", null, h("li", null, `${c.d.decisions.filter(d => d.decision_status === "Proposé").length} proposed decisions awaiting approval`), h("li", null, `${c.d.decisions.filter(d => d.decision_status === "En mesure").length} décisions en cours de mesure`))); }
    if (secs.actions) { doc.appendChild(h("h3", null, "Actions recommandées")); doc.appendChild(h("ol", null, ...missionQueue(c.ix).slice(0, 5).map(x => h("li", null, `${x.type} : ${x.title} (priorité ${x.score})`)))); }
    el.appendChild(doc);
    el.appendChild(h("div", "mc-hint", icon("Printer", 14), "Sortie : imprimez cette page (Ctrl+P → Enregistrer au format PDF) ou sélectionnez le texte et copiez-le."));
}
