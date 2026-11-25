"use strict";

/** Right-side inspector: details, linked records, timeline and next steps for any selected entity or KPI. */
import type { Ctx } from "../app";
import { Row } from "../core/data";
import { day, isOverdueTask, isRevenue, kpis, monthRange, month, sum, addDays, addMonths, monthLabel, OPEN_INCIDENT } from "../core/engine";
import { STATUS_TONE } from "../core/theme";
import { btn, chip, drawer, fmt, h, icon } from "../core/ui";

export const KPI_DEFS: Record<string, { label: string; icon: string; fmt: (v: number) => string; get: (k: ReturnType<typeof kpis>) => number | null; good: boolean; rule: string }> = {
    netRevenue: { label: "CA total", icon: "TrendingUp", fmt: v => fmt.compact(v), get: k => k.netRevenue, good: true, rule: "Σ montant net des commandes Terminé + En traitement" },
    gm: { label: "Marge brute", icon: "Percent" as any, fmt: v => fmt.pct(v), get: k => k.gm, good: true, rule: "(CA net − coût des lignes) ÷ CA net" },
    orders: { label: "Commandes", icon: "Receipt", fmt: v => fmt.int(v), get: k => k.orders, good: true, rule: "nombre de commandes, tous statuts" },
    aov: { label: "Panier moyen", icon: "Coins", fmt: v => fmt.compact(v), get: k => k.aov, good: true, rule: "CA net ÷ commandes avec CA" },
    collectionRate: { label: "Encaissement des paiements", icon: "Wallet", fmt: v => fmt.pct(v), get: k => k.collectionRate, good: true, rule: "Payé + Partiel ÷ (Payé + Partiel + En attente + En retard)" },
    openIncidents: { label: "Incidents ouverts", icon: "Siren", fmt: v => fmt.int(v), get: k => k.openIncidents, good: false, rule: "incidents Ouvert ou En investigation (état actuel)" },
    atRiskCustomers: { label: "Clients à risque", icon: "Users", fmt: v => fmt.int(v), get: k => k.atRiskCustomers, good: false, rule: "clients au statut À risque (état actuel)" },
    projectCompletion: { label: "Réalisation des projets", icon: "ChartGantt", fmt: v => fmt.pct(v), get: k => k.projectCompletion, good: true, rule: "avancement pondéré par le budget" },
    expenses: { label: "Dépenses", icon: "Receipt", fmt: v => fmt.compact(v), get: k => k.expenses, good: false, rule: "Σ dépenses, hors Rejeté" },
    grossProfit: { label: "Marge brute (TND)", icon: "Landmark", fmt: v => fmt.compact(v), get: k => k.grossProfit, good: true, rule: "CA net − coût des produits" },
    openAlerts: { label: "Alertes ouvertes", icon: "Bell", fmt: v => fmt.int(v), get: k => k.openAlerts, good: false, rule: "alertes Nouveau / En cours / Pris en compte" },
    overdueTasks: { label: "Tâches en retard", icon: "AlarmClock", fmt: v => fmt.int(v), get: k => k.overdueTasks, good: false, rule: "non terminées et échues avant la date de référence" }
};

function kv(rows: Array<[string, Node | string | number | null | undefined]>): HTMLElement {
    return h("dl", "mc-kv", ...rows.flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v === null || v === undefined || v === "" ? "—" : (typeof v === "object" ? v : String(v)))]));
}
const st = (s: string): HTMLElement => chip(s ?? "—", STATUS_TONE[s] ?? "muted");

export function inspector(c: Ctx, host: HTMLElement, sel: { type: string; id: string }): void {
    const ix = c.ix, d = c.d;
    const close = (): void => { c.s.selection = null; c.rerender(); };
    const body = h("div", "mc-inspector");
    const section = (title: string, ...nodes: Array<Node | null>): void => { body.appendChild(h("div", "mc-ins-section", h("div", "mc-ins-title", title), ...nodes.filter(n => n) as Node[])); };
    const list = (rows: Row[], label: (r: Row) => string, sub: (r: Row) => string, onClick?: (r: Row) => void, max = 8): HTMLElement => {
        if (!rows.length) { return h("div", "mc-muted", "Aucun"); }
        return h("div", "mc-ins-list", ...rows.slice(0, max).map(r => { const e = h("div", { class: `mc-ins-row${onClick ? " mc-click" : ""}`, tabindex: onClick ? 0 : null }, h("span", null, label(r)), h("span", "mc-muted", sub(r))); if (onClick) { e.onclick = (): void => onClick(r); } return e; }), rows.length > max ? h("div", "mc-muted", `+ ${rows.length - max} de plus`) : null);
    };
    const timeline = (events: Array<{ date: string; text: string; tone?: string }>): HTMLElement => h("div", "mc-timeline", ...events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map(e => h("div", `mc-tl-item mc-tone-${e.tone ?? "muted"}`, h("span", "mc-tl-date", fmt.date(e.date)), h("span", null, e.text))));
    let title = sel.id, ic = "Info";

    if (sel.type === "kpi") {
        const def = KPI_DEFS[sel.id];
        title = def?.label ?? sel.id; ic = def?.icon ?? "Gauge";
        const cur = kpis(ix, c.ec), prev = kpis(ix, c.prev);
        const a = def.get(cur), b = def.get(prev);
        section("Valeur", kv([["Période actuelle", a === null ? "—" : def.fmt(a)], ["Période précédente", b === null ? "—" : def.fmt(b)], ["Variation", a !== null && b ? fmt.signedPct((a - b) / Math.abs(b)) : "—"], ["Règle", def.rule]]));
        const months = monthRange(month(addMonths(ix.ref, -11)), month(ix.ref));
        const trend = months.map(m => { const from = m + "-01"; const p = { from, to: addDays(addMonths(from, 1), -1), label: m }; return { m, v: def.get(kpis(ix, { p, dept: c.ec.dept })) ?? 0 }; });
        const chartEl = h("div", "mc-chart mc-h160"); section("Tendance sur 12 mois", chartEl);
        c.ch.line(chartEl, trend.map(t => monthLabel(t.m)), [{ name: def.label, data: trend.map(t => t.v) }], undefined, v => def.fmt(v));
        if (["netRevenue", "orders", "aov", "gm"].includes(sel.id)) {
            const top = Array.from(new Map(d.sales_orders.filter(o => isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to).map(o => [o.customer_id, 0])).keys())
                .map(id => ({ id, v: sum(d.sales_orders.filter(o => o.customer_id === id && isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to), o => o.net_amount_tnd) })).sort((x, y) => y.v - x.v);
            section("Principaux clients contributeurs", list(top as any, r => ix.custName(r.id), r => fmt.compact(r.v), r => c.select("customer", r.id)));
        }
        if (sel.id === "openIncidents") { section("Incidents ouverts (plus fort impact)", list(d.incidents.filter(i => OPEN_INCIDENT.has(i.incident_status)).sort((x, y) => y.estimated_impact_tnd - x.estimated_impact_tnd), r => `${r.incident_type} · ${r.incident_id}`, r => `${r.severity} · ${fmt.compact(r.estimated_impact_tnd)}`, r => c.select("incident", r.incident_id))); }
        if (sel.id === "atRiskCustomers") { section("Clients à risque (plus gros contrats)", list(d.customers.filter(x => x.customer_status === "À risque").sort((x, y) => y.annual_contract_value_tnd - x.annual_contract_value_tnd), r => r.customer_name, r => `${r.region} · ${fmt.compact(r.annual_contract_value_tnd)}`, r => c.select("customer", r.customer_id))); }
        if (sel.id === "collectionRate") { section("Plus gros paiements en retard", list(d.payments.filter(p => p.payment_status === "En retard").sort((x, y) => y.amount_tnd - x.amount_tnd), r => `${r.payment_id} · ${ix.custName(ix.order.get(r.order_id)?.customer_id)}`, r => fmt.compact(r.amount_tnd), r => c.select("order", r.order_id))); }
        if (sel.id === "projectCompletion") { section("Projets", list(d.projects.slice().sort((x, y) => x.completion_percent - y.completion_percent), r => r.project_name, r => `${fmt.pct(r.completion_percent, 0)} · ${r.project_status}`, r => c.select("project", r.project_id))); }
        section("Prochaines étapes", h("div", "mc-row-gap", btn("Cause racine", { icon: "GitBranch", small: true, onClick: () => { c.s.selection = null; c.go("rootcause"); } }), btn("Prévision", { icon: "Telescope", small: true, onClick: () => { c.s.selection = null; c.go("forecast"); } })));
    } else if (sel.type === "customer") {
        const r = ix.cust.get(sel.id); title = r?.customer_name ?? sel.id; ic = "Users";
        const ords = d.sales_orders.filter(o => o.customer_id === sel.id); const rev = ords.filter(isRevenue);
        const pays = ords.map(o => ix.payByOrder.get(o.order_id)).filter(Boolean) as Row[];
        const inter = d.customer_interactions.filter(i => i.customer_id === sel.id);
        const overdue = pays.filter(p => p.payment_status === "En retard");
        const churnSignals = [r?.customer_status === "À risque" ? "statut À risque" : "", overdue.length ? `${overdue.length} paiement(s) en retard` : "", inter.filter(i => i.interaction_status === "Escaladé").length ? `${inter.filter(i => i.interaction_status === "Escaladé").length} escalated interaction(s)` : "", rev.length && day(rev.map(o => o.order_date).sort().slice(-1)[0]) < addDays(ix.ref, -120) ? "aucune commande depuis plus de 120 jours" : ""].filter(Boolean);
        section("Profil", kv([["Segment", r?.customer_segment], ["Secteur", r?.industry], ["Région", r?.region], ["Statut", st(r?.customer_status)], ["Client depuis", fmt.date(r?.acquisition_date)], ["Valeur du contrat", fmt.money(r?.annual_contract_value_tnd)]]));
        section("Commercial", kv([["Commandes", `${ords.length} (${rev.length} avec CA)`], ["CA net", fmt.money(sum(rev, o => o.net_amount_tnd))], ["Payé", fmt.money(sum(pays.filter(p => p.payment_status === "Payé" || p.payment_status === "Partiel"), p => p.amount_tnd))], ["En retard", fmt.money(sum(overdue, p => p.amount_tnd))]]));
        section("Indicateurs de risque d'attrition (règles, pas une prédiction)", churnSignals.length ? h("div", "mc-row-gap mc-wrap", ...churnSignals.map(x => chip(x, "bad"))) : h("div", "mc-muted", "Aucun indicateur déclenché."));
        section("Chronologie", timeline([...ords.map(o => ({ date: o.order_date, text: `Commande ${o.order_id} · ${o.order_status} · ${fmt.compact(o.gross_amount_tnd)}`, tone: STATUS_TONE[o.order_status] })), ...pays.map(p => ({ date: p.payment_date, text: `Paiement ${p.payment_id} · ${p.payment_status} · ${fmt.compact(p.amount_tnd)}`, tone: STATUS_TONE[p.payment_status] })), ...inter.map(i => ({ date: i.interaction_date, text: `${i.channel} ${i.interaction_type} · ${i.interaction_status}`, tone: STATUS_TONE[i.interaction_status] }))]));
        section("Commandes", list(ords.slice().sort((a, b) => b.order_date.localeCompare(a.order_date)), o => `${o.order_id} · ${fmt.date(o.order_date)}`, o => `${o.order_status} · ${fmt.compact(o.gross_amount_tnd)}`, o => c.select("order", o.order_id)));
    } else if (sel.type === "order") {
        const o = ix.order.get(sel.id); title = `Commande ${sel.id}`; ic = "Receipt";
        if (o) {
            const lines = ix.linesByOrder.get(sel.id) ?? [], pay = ix.payByOrder.get(sel.id);
            const mismatch = Math.abs(o.gross_amount_tnd - o.net_amount_tnd - o.tax_amount_tnd) > 0.05, badDate = o.promised_delivery_date && day(o.promised_delivery_date) < day(o.order_date);
            section("Commande", kv([["Client", ix.custName(o.customer_id)], ["Date", fmt.date(o.order_date)], ["Responsable", ix.empName(o.sales_owner_id)], ["Canal", o.sales_channel], ["Statut", st(o.order_status)], ["Net", fmt.money2(o.net_amount_tnd)], ["Taxe", fmt.money2(o.tax_amount_tnd)], ["Brut", fmt.money2(o.gross_amount_tnd)], ["Promise", fmt.date(o.promised_delivery_date)]]));
            if (mismatch || badDate) { section("À vérifier", h("div", "mc-row-gap mc-wrap", mismatch ? chip(`brut ≠ net + taxe (${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)})`, "bad") : null, badDate ? chip("promise avant la date de commande", "bad") : null)); }
            section("Lignes", list(lines, l => `${ix.prodName(l.product_id)} × ${l.quantity}`, l => `${fmt.money2(l.net_line_amount_tnd)} · remise ${fmt.pct(l.discount_rate, 0)}`, l => c.select("product", l.product_id)));
            section("Paiement", pay ? kv([["Paiement", pay.payment_id], ["Statut", st(pay.payment_status)], ["Montant", fmt.money2(pay.amount_tnd)], ["Moyen", pay.payment_method], ["Réglé", fmt.date(pay.settlement_date)]]) : h("div", "mc-muted", "Aucun paiement"));
            section("Prochaines étapes", h("div", "mc-row-gap", btn("Ouvrir le client", { small: true, icon: "Users", onClick: () => c.select("customer", o.customer_id) }), btn("Enquêter", { small: true, icon: "ScanSearch", onClick: () => { c.s.m.detectiveFocus = `Order:${o.order_id}`; c.s.selection = null; c.go("detective"); } })));
        }
    } else if (sel.type === "product") {
        const p = ix.prod.get(sel.id); title = p?.product_name ?? sel.id; ic = "Package";
        const lines = d.sales_order_items.filter(l => l.product_id === sel.id && isRevenue(ix.order.get(l.order_id) ?? {}));
        const inv = d.inventory_snapshots.filter(i => i.product_id === sel.id);
        const latest = Array.from(new Map(inv.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).map(i => [i.warehouse, i])).values());
        const rev = sum(lines, l => l.net_line_amount_tnd), cost = sum(lines, l => l.line_cost_tnd);
        section("Profil", kv([["Catégorie", p?.category], ["Gamme", p?.product_tier], ["Statut", st(p?.product_status)], ["Prix catalogue", fmt.money2(p?.list_price_tnd)], ["Coût unitaire", fmt.money2(p?.unit_cost_tnd)]]));
        section("Ventes (toutes données)", kv([["Unités", fmt.int(sum(lines, l => l.quantity))], ["Chiffre d'affaires", fmt.money(rev)], ["Marge", fmt.pct(rev ? (rev - cost) / rev : null)]]));
        section("Dernier stock par entrepôt", list(latest, i => i.warehouse, i => `${i.quantity_on_hand} en stock · réappro. ${i.reorder_point}${i.quantity_on_hand < i.reorder_point ? " · BAS" : ""} · ${ix.suppName(i.supplier_id)}`, i => c.select("supplier", i.supplier_id)));
    } else if (sel.type === "supplier") {
        const sp = ix.supp.get(sel.id); title = sp?.supplier_name ?? sel.id; ic = "Truck";
        const inv = d.inventory_snapshots.filter(i => i.supplier_id === sel.id); const prods = Array.from(new Set(inv.map(i => i.product_id)));
        section("Profil", kv([["Catégorie", sp?.supplier_category], ["Pays", sp?.country], ["Niveau de risque", st(sp?.risk_level === "Élevée" ? "À risque" : sp?.risk_level)], ["Note qualité", sp?.quality_rating], ["Statut", st(sp?.supplier_status)]]));
        section("Exposition aux perturbations", kv([["Produits fournis", prods.length], ["CA de ces produits", fmt.money(sum(d.sales_order_items.filter(l => prods.includes(l.product_id) && isRevenue(ix.order.get(l.order_id) ?? {})), l => l.net_line_amount_tnd))]]));
        section("Produits", list(prods.map(id => ix.prod.get(id) as Row).filter(Boolean), r => r.product_name, r => r.category, r => c.select("product", r.product_id)));
    } else if (sel.type === "department") {
        const dep = ix.dept.get(sel.id); title = dep?.department_name ?? sel.id; ic = "Building";
        const k = kpis(ix, { p: c.ec.p, dept: sel.id });
        section("Département", kv([["Division", dep?.division], ["Site", dep?.primary_location], ["Mission", dep?.mission], ["Employés", d.employees.filter(e => e.department_id === sel.id).length]]));
        section(`KPI · ${c.ec.p.label}`, kv([["CA (par commercial)", fmt.money(k.netRevenue)], ["Dépenses", fmt.money(k.expenses)], ["Incidents ouverts", `${k.openIncidents} (${k.criticalIncidents} critiques)`], ["Tâches en retard", k.overdueTasks], ["Projets à risque", k.atRiskProjects]]));
        section("Projets", list(d.projects.filter(p => p.department_id === sel.id), p => p.project_name, p => `${p.project_status} · ${fmt.pct(p.completion_percent, 0)}`, p => c.select("project", p.project_id)));
        section("Incidents ouverts", list(d.incidents.filter(i => i.department_id === sel.id && OPEN_INCIDENT.has(i.incident_status)), i => `${i.incident_type} · ${i.incident_id}`, i => `${i.severity} · ${fmt.compact(i.estimated_impact_tnd)}`, i => c.select("incident", i.incident_id)));
    } else if (sel.type === "employee") {
        const e = ix.emp.get(sel.id); title = e?.employee_name ?? sel.id; ic = "User";
        section("Employé", kv([["Poste", e?.job_title], ["Département", ix.deptName(e?.department_id)], ["Statut", st(e?.employment_status)], ["Site", e?.location], ["Embauché le", fmt.date(e?.hire_date)]]));
        section("Tâches ouvertes", list(d.tasks.filter(t => t.assignee_employee_id === sel.id && t.task_status !== "Terminé"), t => t.task_title, t => `${t.task_status} · échéance ${fmt.date(t.due_date)}${isOverdueTask(t, ix.ref) ? " · EN RETARD" : ""}`, t => c.select("task", t.task_id)));
        section("Événements à venir", list(d.calendar_events.filter(ev => ev.owner_employee_id === sel.id && day(ev.start_datetime) >= ix.ref).sort((a, b) => a.start_datetime.localeCompare(b.start_datetime)), ev => ev.event_title, ev => `${fmt.date(ev.start_datetime)} ${fmt.time(ev.start_datetime)}`));
    } else if (sel.type === "project") {
        const p = ix.proj.get(sel.id); title = p?.project_name ?? sel.id; ic = "ChartGantt";
        const tk = d.tasks.filter(t => t.project_id === sel.id);
        section("Projet", kv([["Thème", p?.strategic_theme], ["Département", ix.deptName(p?.department_id)], ["Responsable", ix.empName(p?.project_owner_id)], ["Statut", st(p?.project_status)], ["Début", fmt.date(p?.start_date)], ["Fin prévue", fmt.date(p?.planned_end_date)], ["Budget", fmt.money(p?.approved_budget_tnd)], ["Avancement", fmt.pct(p?.completion_percent, 0)]]));
        section("Tâches", list(tk, t => t.task_title, t => `${t.task_status} · ${t.priority}${isOverdueTask(t, ix.ref) ? " · OVERDUE" : ""}`, t => c.select("task", t.task_id)));
        section("Événements liés", list(d.calendar_events.filter(ev => ev.related_project_id === sel.id), ev => ev.event_title, ev => fmt.date(ev.start_datetime)));
    } else if (sel.type === "task") {
        const t = d.tasks.find(x => x.task_id === sel.id); title = t?.task_title ?? sel.id; ic = "SquareKanban";
        if (t) { section("Tâche", kv([["Statut", st(t.task_status)], ["Priorité", t.priority], ["Type", t.task_type], ["Responsable", ix.empName(t.assignee_employee_id)], ["Projet", ix.projName(t.project_id)], ["Département", ix.deptName(t.department_id)], ["Créé", fmt.date(t.created_date)], ["Échéance", fmt.date(t.due_date)]])); }
        section("Prochaines étapes", h("div", "mc-row-gap", btn("Ouvrir dans le gestionnaire de tâches", { small: true, icon: "SquareKanban", onClick: () => { c.s.selection = null; c.go("tasks"); } })));
    } else if (sel.type === "alert" || sel.type === "incident" || sel.type === "risk") {
        const r = sel.type === "alert" ? d.alerts.find(x => x.alert_id === sel.id) : sel.type === "incident" ? d.incidents.find(x => x.incident_id === sel.id) : d.risk_register.find(x => x.risk_id === sel.id);
        title = `${sel.type === "alert" ? "Alert" : sel.type === "incident" ? "Incident" : "Risk"} ${sel.id}`; ic = sel.type === "alert" ? "Bell" : sel.type === "incident" ? "Siren" : "ShieldAlert";
        if (r) { section("Détails", kv(Object.keys(r).filter(k => !k.endsWith("_id")).map(k => [k.replace(/_/g, " "), typeof r[k] === "number" ? (k.endsWith("_tnd") ? fmt.money(r[k]) : k.includes("score") ? fmt.pct(r[k], 0) : String(r[k])) : k.includes("date") ? fmt.date(r[k]) : r[k]] as [string, string]))); }
        section("Prochaine étape recommandée", h("div", "mc-muted", sel.type === "incident" ? "Confirmez le responsable, vérifiez les tâches liées et mettez à jour le statut une fois le problème atténué." : sel.type === "alert" ? "Prenez en compte, puis créez une tâche à partir du modèle d'alerte dans le gestionnaire de tâches." : "Revoyez le statut d'atténuation et l'exposition avec le responsable du risque."),
            h("div", "mc-row-gap", btn("Créer une tâche à partir de ceci", { small: true, icon: "Plus", onClick: () => { c.s.m.taskTemplate = { title: `Suivi : ${title}`, priority: (r?.severity === "Critique" ? "Critique" : "Élevée") }; c.s.selection = null; c.go("tasks"); } })));
    }
    drawer(host, title, body, close, { icon: ic, width: 420 });
}
