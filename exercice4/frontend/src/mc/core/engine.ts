"use strict";

/**
 * Mission Control calculation engine. Pure functions, same business rules as dax/measures.dax:
 *   Revenue orders = Completed + Processing. Money received = payments Paid + Partial; outstanding = Pending + Overdue.
 *   Expenses = all approval statuses except Rejected. Reference date ("today") = last order date.
 * Tested in Node against the live DAX measures by tools/test-engine.ps1.
 */

import { Index, Row } from "./data";

// ---------------------------------------------------------------- dates
export const day = (iso: string | null | undefined): string => (iso ? String(iso).slice(0, 10) : "");
export const month = (iso: string | null | undefined): string => (iso ? String(iso).slice(0, 7) : "");
export function addDays(iso: string, n: number): string { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
export function addMonths(iso: string, n: number): string { const d = new Date(iso.slice(0, 10) + "T00:00:00Z"); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 10); }
export function daysBetween(a: string, b: string): number { return Math.round((Date.parse(day(b) + "T00:00:00Z") - Date.parse(day(a) + "T00:00:00Z")) / 86400000); }
export function monthRange(fromMonth: string, toMonth: string): string[] {
    const out: string[] = []; let [y, m] = fromMonth.split("-").map(Number); const [ty, tm] = toMonth.split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } }
    return out;
}
export const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const monthLabel = (m: string): string => (m ? `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}` : "");

// ---------------------------------------------------------------- numbers
export const sum = <T>(rows: T[], f: (r: T) => number): number => rows.reduce((s, r) => s + (Number(f(r)) || 0), 0);
export const div = (a: number, b: number): number | null => (b ? a / b : null);
export const groupBy = <T>(rows: T[], key: (r: T) => string): Map<string, T[]> => {
    const m = new Map<string, T[]>(); rows.forEach(r => { const k = key(r); const l = m.get(k); if (l) { l.push(r); } else { m.set(k, [r]); } }); return m;
};
export function mean(v: number[]): number { return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0; }
export function std(v: number[]): number { if (v.length < 2) { return 0; } const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); }

// ---------------------------------------------------------------- context (period + department)
export interface Period { from: string; to: string; label: string }
export type PeriodKey = "30d" | "mtd" | "3m" | "6m" | "ytd" | "12m" | "all";
export const PERIODS: Array<{ key: PeriodKey; label: string }> = [
    { key: "30d", label: "30 derniers jours" }, { key: "mtd", label: "Mois en cours" }, { key: "3m", label: "3 derniers mois" },
    { key: "6m", label: "6 derniers mois" }, { key: "ytd", label: "Année en cours" }, { key: "12m", label: "12 derniers mois" }, { key: "all", label: "Toutes les données" }
];
export function period(key: PeriodKey, ref: string, first: string): Period {
    const label = PERIODS.find(p => p.key === key)?.label ?? key;
    switch (key) {
        case "30d": return { from: addDays(ref, -29), to: ref, label };
        case "mtd": return { from: ref.slice(0, 8) + "01", to: ref, label };
        case "3m": return { from: addDays(addMonths(ref, -3), 1), to: ref, label };
        case "6m": return { from: addDays(addMonths(ref, -6), 1), to: ref, label };
        case "ytd": return { from: ref.slice(0, 4) + "-01-01", to: ref, label };
        case "12m": return { from: addDays(addMonths(ref, -12), 1), to: ref, label };
        default: return { from: first, to: ref, label };
    }
}
/** The period of the same length just before p. */
export function previous(p: Period): Period {
    const len = daysBetween(p.from, p.to) + 1;
    return { from: addDays(p.from, -len), to: addDays(p.from, -1), label: "Période précédente" };
}
export interface Ctx { p: Period; dept: string }
const inP = (iso: string, p: Period): boolean => { const d = day(iso); return d >= p.from && d <= p.to; };

export const REVENUE_STATUSES = new Set(["Terminé", "En traitement"]);
export const isRevenue = (o: Row): boolean => REVENUE_STATUSES.has(o.order_status);

/** Orders in context: order date in period; department = the sales owner's department. */
export function orders(ix: Index, c: Ctx): Row[] {
    return ix.d.sales_orders.filter(o => inP(o.order_date, c.p) && (!c.dept || ix.empDept(o.sales_owner_id) === c.dept));
}

// ---------------------------------------------------------------- KPIs
export interface Kpis {
    netRevenue: number; grossRevenue: number; tax: number; orders: number; revenueOrders: number; completed: number; cancelled: number; returned: number;
    units: number; aov: number | null; discount: number; cost: number; grossProfit: number; gm: number | null;
    paid: number; outstanding: number; collectionRate: number | null; overdue: number; overdueCount: number;
    expenses: number; operatingProfit: number; expenseRatio: number | null;
    openIncidents: number; criticalIncidents: number; incidentImpact: number; openAlerts: number; criticalAlerts: number;
    atRiskCustomers: number; projectCompletion: number | null; atRiskProjects: number; openTasks: number; overdueTasks: number;
    revenueTarget: number; revenueVsTarget: number | null; marginTarget: number | null;
}
export const OPEN_INCIDENT = new Set(["Ouvert", "En investigation"]);
export const OPEN_ALERT = new Set(["Nouveau", "En cours", "Pris en compte"]);
export function isAtRiskProject(p: Row, ref: string): boolean { return p.project_status === "À risque" || (day(p.planned_end_date) < ref && p.project_status !== "Terminé"); }
export function isOverdueTask(t: Row, ref: string): boolean { return t.task_status !== "Terminé" && day(t.due_date) < ref; }

export function kpis(ix: Index, c: Ctx): Kpis {
    const d = ix.d, ref = ix.ref;
    const all = orders(ix, c);
    const rev = all.filter(isRevenue);
    const revIds = new Set(rev.map(o => o.order_id));
    const lines = d.sales_order_items.filter(l => revIds.has(l.order_id));
    const ids = new Set(all.map(o => o.order_id));
    const pays = d.payments.filter(p => ids.has(p.order_id));
    const net = sum(rev, o => o.net_amount_tnd);
    const cost = sum(lines, l => l.line_cost_tnd);
    const list = sum(lines, l => l.quantity * l.unit_price_tnd);
    const paid = sum(pays.filter(p => p.payment_status === "Payé" || p.payment_status === "Partiel"), p => p.amount_tnd);
    const outstanding = sum(pays.filter(p => p.payment_status === "En attente" || p.payment_status === "En retard"), p => p.amount_tnd);
    const overdueP = pays.filter(p => p.payment_status === "En retard");
    const exp = d.expenses.filter(e => inP(e.expense_date, c.p) && e.approval_status !== "Rejeté" && (!c.dept || e.department_id === c.dept));
    const expenses = sum(exp, e => e.amount_tnd);
    const deptOk = (r: Row): boolean => !c.dept || r.department_id === c.dept;
    const inc = d.incidents.filter(i => OPEN_INCIDENT.has(i.incident_status) && deptOk(i));
    const alerts = d.alerts.filter(a => OPEN_ALERT.has(a.alert_status) && (!c.dept || a.affected_area === ix.deptName(c.dept)));
    const projects = d.projects.filter(deptOk);
    const tasks = d.tasks.filter(deptOk);
    const targets = d.kpi_targets.filter(t => inP(t.month_start, { from: c.p.from.slice(0, 8) + "01", to: c.p.to, label: "" }) && deptOk(t));
    const revenueTarget = sum(targets, t => t.revenue_target_tnd);
    const budget = sum(projects, p => p.approved_budget_tnd);
    return {
        netRevenue: net, grossRevenue: sum(rev, o => o.gross_amount_tnd), tax: sum(rev, o => o.tax_amount_tnd),
        orders: all.length, revenueOrders: rev.length,
        completed: all.filter(o => o.order_status === "Terminé").length, cancelled: all.filter(o => o.order_status === "Annulé").length,
        returned: all.filter(o => o.order_status === "Retourné").length, units: sum(lines, l => l.quantity),
        aov: div(net, rev.length), discount: list - sum(lines, l => l.net_line_amount_tnd), cost, grossProfit: net - cost, gm: div(net - cost, net),
        paid, outstanding, collectionRate: div(paid, paid + outstanding), overdue: sum(overdueP, p => p.amount_tnd), overdueCount: overdueP.length,
        expenses, operatingProfit: net - cost - expenses, expenseRatio: div(expenses, net),
        openIncidents: inc.length, criticalIncidents: inc.filter(i => i.severity === "Critique").length, incidentImpact: sum(inc, i => i.estimated_impact_tnd),
        openAlerts: alerts.length, criticalAlerts: alerts.filter(a => a.severity === "Critique").length,
        atRiskCustomers: d.customers.filter(cu => cu.customer_status === "À risque").length,
        projectCompletion: div(sum(projects, p => p.approved_budget_tnd * p.completion_percent), budget),
        atRiskProjects: projects.filter(p => isAtRiskProject(p, ref)).length,
        openTasks: tasks.filter(t => t.task_status !== "Terminé").length, overdueTasks: tasks.filter(t => isOverdueTask(t, ref)).length,
        revenueTarget, revenueVsTarget: div(net, revenueTarget),
        marginTarget: targets.length ? mean(targets.map(t => t.gross_margin_target_pct)) : null
    };
}

/** Monthly series of a KPI over the months of a period. */
export function monthly(ix: Index, c: Ctx, f: (k: Kpis) => number | null): Array<{ m: string; v: number }> {
    return monthRange(month(c.p.from), month(c.p.to)).map(m => {
        const from = m + "-01", end = addDays(addMonths(from, 1), -1);
        const p = { from: from < c.p.from ? c.p.from : from, to: end > c.p.to ? c.p.to : end, label: m };
        return { m, v: f(kpis(ix, { p, dept: c.dept })) ?? 0 };
    });
}

/** Fast monthly revenue / orders / cost series without the full KPI set. */
export function revenueByMonth(ix: Index, dept = ""): Map<string, { net: number; orders: number; cost: number; gross: number }> {
    const out = new Map<string, { net: number; orders: number; cost: number; gross: number }>();
    ix.d.sales_orders.forEach(o => {
        if (!isRevenue(o) || (dept && ix.empDept(o.sales_owner_id) !== dept)) { return; }
        const m = month(o.order_date); const v = out.get(m) ?? { net: 0, orders: 0, cost: 0, gross: 0 };
        v.net += o.net_amount_tnd; v.gross += o.gross_amount_tnd; v.orders++;
        (ix.linesByOrder.get(o.order_id) ?? []).forEach(l => { v.cost += l.line_cost_tnd; });
        out.set(m, v);
    });
    return out;
}

// ---------------------------------------------------------------- department health
export interface DeptHealth { id: string; name: string; score: number; status: "Sain" | "Sous surveillance" | "Critique"; revenue: number; expenses: number; openIncidents: number; critical: number; overdueTasks: number; atRiskProjects: number; openRiskExposure: number; drivers: string[] }
export function deptHealth(ix: Index, c: Ctx): DeptHealth[] {
    return ix.d.departments.map(dep => {
        const k = kpis(ix, { p: c.p, dept: dep.department_id });
        const risks = ix.d.risk_register.filter(r => r.department_id === dep.department_id && (r.mitigation_status === "Ouvert" || r.mitigation_status === "En atténuation"));
        const exposure = sum(risks, r => r.estimated_exposure_tnd);
        const drivers: string[] = [];
        let score = 100;
        const pen = (cond: boolean, pts: number, why: string): void => { if (cond) { score -= pts; drivers.push(`−${pts} ${why}`); } };
        pen(k.criticalIncidents > 0, Math.min(25, k.criticalIncidents * 6), `${k.criticalIncidents} incident(s) critique(s) ouvert(s)`);
        pen(k.openIncidents > 8, 10, `${k.openIncidents} incidents ouverts`);
        pen(k.overdueTasks > 20, Math.min(20, Math.round(k.overdueTasks / 3)), `${k.overdueTasks} tâches en retard`);
        pen(k.atRiskProjects > 0, Math.min(20, k.atRiskProjects * 7), `${k.atRiskProjects} projet(s) à risque`);
        pen(exposure > 500000, 10, `exposition aux risques ouverts ${Math.round(exposure / 1000)} k TND`);
        score = Math.max(0, score);
        return { id: dep.department_id, name: dep.department_name, score, status: score >= 70 ? "Sain" : score >= 45 ? "Sous surveillance" : "Critique", revenue: k.netRevenue, expenses: k.expenses, openIncidents: k.openIncidents, critical: k.criticalIncidents, overdueTasks: k.overdueTasks, atRiskProjects: k.atRiskProjects, openRiskExposure: exposure, drivers };
    });
}
/** Company health index: mean of department scores (0-100). */
export function companyHealth(h: DeptHealth[]): number { return Math.round(mean(h.map(x => x.score))); }

// ---------------------------------------------------------------- "what changed" (deterministic rules)
export interface Change { text: string; tone: "good" | "bad" | "neutral"; metric: string; delta: number | null }
export function whatChanged(cur: Kpis, prev: Kpis): Change[] {
    const out: Change[] = [];
    const pct = (a: number, b: number): number | null => (b ? (a - b) / Math.abs(b) : null);
    const add = (metric: string, a: number, b: number, upGood: boolean, fmt: (v: number) => string, threshold = 0.05): void => {
        const d = pct(a, b);
        if (d === null || Math.abs(d) < threshold) { return; }
        out.push({ metric, delta: d, tone: (d > 0) === upGood ? "good" : "bad", text: `${metric} : ${d > 0 ? "hausse" : "baisse"} de ${Math.abs(d * 100).toFixed(1).replace(".", ",")} % (${fmt(b)} → ${fmt(a)})` });
    };
    const k = (v: number): string => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2).replace(".", ",")} M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1).replace(".", ",")} k` : v.toFixed(0));
    add("CA net", cur.netRevenue, prev.netRevenue, true, k);
    add("Commandes", cur.orders, prev.orders, true, k);
    add("Panier moyen", cur.aov ?? 0, prev.aov ?? 0, true, k);
    add("Dépenses", cur.expenses, prev.expenses, false, k);
    add("Commandes annulées", cur.cancelled, prev.cancelled, false, k, 0.15);
    add("Commandes retournées", cur.returned, prev.returned, false, k, 0.15);
    if (cur.gm !== null && prev.gm !== null && Math.abs(cur.gm - prev.gm) >= 0.01) {
        out.push({ metric: "Marge brute", delta: cur.gm - prev.gm, tone: cur.gm > prev.gm ? "good" : "bad", text: `La marge brute ${cur.gm > prev.gm ? "a progressé" : "a reculé"} de ${(Math.abs(cur.gm - prev.gm) * 100).toFixed(1).replace(".", ",")} pts (${(prev.gm * 100).toFixed(1).replace(".", ",")} % → ${(cur.gm * 100).toFixed(1).replace(".", ",")} %)` });
    }
    if (cur.collectionRate !== null && prev.collectionRate !== null && Math.abs(cur.collectionRate - prev.collectionRate) >= 0.02) {
        out.push({ metric: "Taux d'encaissement", delta: cur.collectionRate - prev.collectionRate, tone: cur.collectionRate > prev.collectionRate ? "good" : "bad", text: `Le taux d'encaissement ${cur.collectionRate > prev.collectionRate ? "a progressé" : "s'est dégradé"} de ${(Math.abs(cur.collectionRate - prev.collectionRate) * 100).toFixed(1).replace(".", ",")} pts` });
    }
    if (!out.length) { out.push({ metric: "Stable", delta: null, tone: "neutral", text: "Aucun KPI n'a varié de plus de 5 % par rapport à la période précédente." }); }
    return out.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
}

// ---------------------------------------------------------------- queue priority scoring (transparent)
export interface QueueItem { id: string; type: "Alerte" | "Incident" | "Tâche en retard" | "Projet à risque" | "Qualité des données" | "Approbation"; title: string; severity: string; owner: string; dept: string; status: string; date: string; impact: number; confidence: number; score: number; parts: Record<string, number>; module: string; row: Row }
export const SEVERITY_W: Record<string, number> = { "Critique": 1, "Élevée": 0.75, "Avertissement": 0.5, "Moyenne": 0.5, "Faible": 0.25, Info: 0.15 };
/** score = 40·severity + 30·impact (log-scaled to the largest) + 20·age (capped 90 days) + 10·confidence. */
export function scoreItems(items: Array<Omit<QueueItem, "score" | "parts">>, ref: string): QueueItem[] {
    const maxImpact = Math.max(1, ...items.map(i => i.impact || 0));
    return items.map(i => {
        const parts = {
            severity: Math.round(40 * (SEVERITY_W[i.severity] ?? 0.3)),
            impact: Math.round(30 * (i.impact > 0 ? Math.log10(1 + i.impact) / Math.log10(1 + maxImpact) : 0)),
            age: Math.round(20 * Math.min(1, Math.max(0, daysBetween(i.date, ref)) / 90)),
            confidence: Math.round(10 * (i.confidence ?? 0.5))
        };
        return { ...i, parts, score: parts.severity + parts.impact + parts.age + parts.confidence };
    }).sort((a, b) => b.score - a.score);
}
export function missionQueue(ix: Index): QueueItem[] {
    const d = ix.d, ref = ix.ref; const items: Array<Omit<QueueItem, "score" | "parts">> = [];
    d.alerts.filter(a => OPEN_ALERT.has(a.alert_status)).forEach(a => items.push({ id: a.alert_id, type: "Alerte", title: `${a.alert_type}: ${a.alert_description}`, severity: a.severity, owner: "—", dept: a.affected_area, status: a.alert_status, date: a.alert_date, impact: 0, confidence: a.confidence_score, module: "risk", row: a }));
    d.incidents.filter(i => OPEN_INCIDENT.has(i.incident_status)).forEach(i => items.push({ id: i.incident_id, type: "Incident", title: `${i.incident_type} (${i.impact_domain})`, severity: i.severity, owner: ix.empName(i.incident_owner_id), dept: ix.deptName(i.department_id), status: i.incident_status, date: i.incident_date, impact: i.estimated_impact_tnd, confidence: 0.8, module: "queue", row: i }));
    d.tasks.filter(t => isOverdueTask(t, ref)).forEach(t => items.push({ id: t.task_id, type: "Tâche en retard", title: `${t.task_title} · échéance ${day(t.due_date)}`, severity: t.priority, owner: ix.empName(t.assignee_employee_id), dept: ix.deptName(t.department_id), status: t.task_status, date: t.due_date, impact: 0, confidence: 1, module: "tasks", row: t }));
    d.projects.filter(p => isAtRiskProject(p, ref)).forEach(p => items.push({ id: p.project_id, type: "Projet à risque", title: `${p.project_name} · ${Math.round(p.completion_percent * 100)} % réalisé`, severity: p.project_status === "À risque" ? "Élevée" : "Moyenne", owner: ix.empName(p.project_owner_id), dept: ix.deptName(p.department_id), status: p.project_status, date: p.planned_end_date, impact: p.approved_budget_tnd * (1 - p.completion_percent), confidence: 0.9, module: "projects", row: p }));
    d.data_quality_issues.filter(q => q.issue_status === "Ouvert" || q.issue_status === "En revue").forEach(q => items.push({ id: q.issue_id, type: "Qualité des données", title: `${q.issue_type} dans ${q.source_table}`, severity: q.severity, owner: "Équipe données", dept: "—", status: q.issue_status, date: q.detected_date, impact: 0, confidence: 0.6, module: "doctor", row: q }));
    return scoreItems(items, ref);
}

// ---------------------------------------------------------------- risk scoring (transparent)
/** risk score = 100 × severity weight × confidence × exposure factor (log-scaled to the largest exposure, floor 0.3). */
export function riskScore(r: Row, maxExposure: number): { score: number; parts: string } {
    const sev = SEVERITY_W[r.severity] ?? 0.3;
    const exp = 0.3 + 0.7 * (r.estimated_exposure_tnd > 0 ? Math.log10(1 + r.estimated_exposure_tnd) / Math.log10(1 + maxExposure) : 0);
    const score = Math.round(100 * sev * (r.confidence_score ?? 0.5) * exp);
    return { score, parts: `severity ${sev} × confidence ${r.confidence_score} × exposure factor ${exp.toFixed(2)} × 100` };
}
export const OPEN_RISK = new Set(["Ouvert", "En atténuation"]);
export function riskByCategory(ix: Index, dept = ""): Array<{ cat: string; score: number; open: number; exposure: number }> {
    const rs = ix.d.risk_register.filter(r => !dept || r.department_id === dept);
    const max = Math.max(1, ...rs.map(r => r.estimated_exposure_tnd));
    return Array.from(groupBy(rs, r => r.risk_category).entries()).map(([cat, list]) => {
        const open = list.filter(r => OPEN_RISK.has(r.mitigation_status));
        return { cat, score: Math.round(mean(open.map(r => riskScore(r, max).score))) || 0, open: open.length, exposure: sum(open, r => r.estimated_exposure_tnd) };
    }).sort((a, b) => a.cat.localeCompare(b.cat));
}

// ---------------------------------------------------------------- anomaly detection (rules + statistics)
export interface Anomaly { id: string; rule: string; severity: "Critique" | "Élevée" | "Moyenne" | "Faible"; table: string; record: string; evidence: string; explanation: string }
export function anomalies(ix: Index): Anomaly[] {
    const d = ix.d, out: Anomaly[] = [];
    d.sales_orders.forEach(o => {
        const diff = o.gross_amount_tnd - (o.net_amount_tnd + o.tax_amount_tnd);
        if (Math.abs(diff) > 0.05) { out.push({ id: `AN-GROSS-${o.order_id}`, rule: "Écart de montant", severity: "Critique", table: "sales_orders", record: o.order_id, evidence: `brut ${o.gross_amount_tnd.toFixed(2)} contre net ${o.net_amount_tnd.toFixed(2)} + taxe ${o.tax_amount_tnd.toFixed(2)} = ${(o.net_amount_tnd + o.tax_amount_tnd).toFixed(2)}`, explanation: "Le brut devrait être égal au net + taxe. Un écart aussi important peut indiquer une erreur de saisie ou d'intégration ; il gonfle le CA brut. À vérifier." }); }
        if (o.promised_delivery_date && day(o.promised_delivery_date) < day(o.order_date)) { out.push({ id: `AN-DATE-${o.order_id}`, rule: "Dates incohérentes", severity: "Élevée", table: "sales_orders", record: o.order_id, evidence: `livraison promise le ${day(o.promised_delivery_date)}, avant la date de commande ${day(o.order_date)}`, explanation: "Une livraison ne peut pas être promise avant la commande. Le délai de livraison serait négatif pour cette commande." }); }
    });
    // statistical outliers on order gross (z > 3)
    const g = d.sales_orders.map(o => o.gross_amount_tnd); const m = mean(g), s = std(g);
    d.sales_orders.forEach(o => { const z = s ? (o.gross_amount_tnd - m) / s : 0; if (z > 3) { out.push({ id: `AN-OUT-${o.order_id}`, rule: "Valeur statistique atypique", severity: "Moyenne", table: "sales_orders", record: o.order_id, evidence: `brut ${o.gross_amount_tnd.toFixed(0)}, soit ${z.toFixed(1)}σ au-dessus de la moyenne ${m.toFixed(0)}`, explanation: "Commande inhabituellement importante. Peut être légitime (grosse affaire) — à vérifier, ce n'est pas une conclusion." }); } });
    // payment vs order mismatch for fully "Paid" payments
    d.payments.forEach(p => { const o = ix.order.get(p.order_id); if (o && p.payment_status === "Payé" && Math.abs(p.amount_tnd - o.gross_amount_tnd) / Math.max(1, o.gross_amount_tnd) > 0.25) { out.push({ id: `AN-PAY-${p.payment_id}`, rule: "Écart de paiement", severity: "Élevée", table: "payments", record: p.payment_id, evidence: `payé ${p.amount_tnd.toFixed(2)} contre brut de la commande ${o.gross_amount_tnd.toFixed(2)} (${p.order_id})`, explanation: "Un paiement marqué Payé diffère de plus de 25 % du montant brut de la commande." }); } });
    // possible duplicates: same customer, same day, same net amount
    const seen = new Map<string, string>();
    d.sales_orders.forEach(o => { const k = `${o.customer_id}|${o.order_date}|${o.net_amount_tnd}`; const prev = seen.get(k); if (prev) { out.push({ id: `AN-DUP-${o.order_id}`, rule: "Doublon possible", severity: "Moyenne", table: "sales_orders", record: o.order_id, evidence: `même client, même jour et même montant que ${prev}`, explanation: "Deux commandes identiques le même jour peuvent être une double saisie." }); } else { seen.set(k, o.order_id); } });
    // sudden monthly revenue change (> 40% vs previous complete month)
    const rm = revenueByMonth(ix); const ms = Array.from(rm.keys()).sort();
    for (let i = 1; i < ms.length - 1; i++) { const a = rm.get(ms[i - 1])?.net ?? 0, b = rm.get(ms[i])?.net ?? 0; const ch = a ? (b - a) / a : 0; if (Math.abs(ch) > 0.4) { out.push({ id: `AN-MOM-${ms[i]}`, rule: "Variation brutale", severity: "Moyenne", table: "sales_orders", record: ms[i], evidence: `CA net ${ch > 0 ? "+" : ""}${(ch * 100).toFixed(0).replace(".", ",")} % par rapport à ${monthLabel(ms[i - 1])}`, explanation: "Variation mensuelle supérieure à 40 %. Vérifiez la saisonnalité, les grosses affaires ou des données manquantes." }); } }
    // expense outliers per category (z > 3)
    groupBy(d.expenses, e => e.expense_category).forEach((list, cat) => { const v = list.map(e => e.amount_tnd); const mm = mean(v), ss = std(v); list.forEach(e => { if (ss && (e.amount_tnd - mm) / ss > 3) { out.push({ id: `AN-EXP-${e.expense_id}`, rule: "Valeur statistique atypique", severity: "Faible", table: "expenses", record: e.expense_id, evidence: `${cat} ${e.amount_tnd.toFixed(0)} TND contre une moyenne de catégorie de ${mm.toFixed(0)}`, explanation: "Dépense très supérieure au montant habituel de sa catégorie." }); } }); });
    const rank = { "Critique": 0, "Élevée": 1, "Moyenne": 2, "Faible": 3 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------- Data Doctor checks
export interface Check { id: string; table: string; check: string; severity: "Critique" | "Élevée" | "Moyenne" | "Faible"; count: number; examples: string[]; formula: string }
export function dataDoctor(ix: Index): { checks: Check[]; score: number; formula: string } {
    const d = ix.d, checks: Check[] = [];
    const add = (table: string, check: string, severity: Check["severity"], rows: string[], formula: string): void => { checks.push({ id: `${table}:${check}`, table, check, severity, count: rows.length, examples: rows.slice(0, 6), formula }); };
    add("sales_orders", "Brut ≠ net + taxe", "Critique", d.sales_orders.filter(o => Math.abs(o.gross_amount_tnd - o.net_amount_tnd - o.tax_amount_tnd) > 0.05).map(o => o.order_id), "|gross − (net + tax)| > 0.05");
    add("sales_orders", "Livraison promise avant la commande", "Élevée", d.sales_orders.filter(o => o.promised_delivery_date && day(o.promised_delivery_date) < day(o.order_date)).map(o => o.order_id), "promised_delivery_date < order_date");
    add("sales_orders", "Net de la commande ≠ somme des lignes", "Élevée", d.sales_orders.filter(o => Math.abs(o.net_amount_tnd - sum(ix.linesByOrder.get(o.order_id) ?? [], l => l.net_line_amount_tnd)) > 0.05).map(o => o.order_id), "|net − Σ line net| > 0.05");
    add("payments", "Commande sans paiement", "Moyenne", d.sales_orders.filter(o => !ix.payByOrder.has(o.order_id)).map(o => o.order_id), "order_id not in payments");
    add("strategic_goals", "Date cible avant la date de début", "Moyenne", d.strategic_goals.filter(g => day(g.target_date) < day(g.start_date)).map(g => g.goal_id), "target_date < start_date");
    add("missions", "Date cible avant la date de début", "Moyenne", d.missions.filter(m => day(m.target_date) < day(m.start_date)).map(m => m.mission_id), "target_date < start_date");
    add("missions", "Terminé sous le seuil", "Faible", d.missions.filter(m => m.mission_status === "Terminé" && m.progress_pct < m.completion_threshold_pct).map(m => m.mission_id), "statut Terminé et avancement < seuil");
    add("strategic_goals", "Statut incohérent avec les valeurs", "Faible", d.strategic_goals.filter(g => g.goal_status === "Atteint" && g.current_value < g.target_value).map(g => g.goal_id), "statut Atteint mais valeur actuelle < cible");
    add("projects", "Fin prévue avant le début", "Élevée", d.projects.filter(p => day(p.planned_end_date) < day(p.start_date)).map(p => p.project_id), "planned_end_date < start_date");
    add("calendar_events", "Fin avant le début", "Moyenne", d.calendar_events.filter(e => e.end_datetime < e.start_datetime).map(e => e.event_id), "end_datetime < start_datetime");
    const empIds = new Set(d.employees.map(e => e.employee_id));
    add("tasks", "Responsable inconnu", "Élevée", d.tasks.filter(t => t.assignee_employee_id && !empIds.has(t.assignee_employee_id)).map(t => t.task_id), "assignee_employee_id not in employees");
    const g = d.sales_orders.map(o => o.gross_amount_tnd); const m = mean(g), s = std(g);
    add("sales_orders", "Montant brut atypique (z > 3)", "Faible", d.sales_orders.filter(o => s && (o.gross_amount_tnd - m) / s > 3).map(o => o.order_id), "(gross − mean) / std > 3");
    const w = { "Critique": 5, "Élevée": 3, "Moyenne": 1.5, "Faible": 0.5 };
    const totalRows = Object.values(d).reduce((s2, t) => s2 + t.length, 0);
    const penalty = checks.reduce((s2, c) => s2 + w[c.severity] * c.count, 0);
    const score = Math.max(0, Math.round(1000 * (1 - penalty / Math.max(1, totalRows))) / 10);
    return { checks: checks.sort((a, b) => w[b.severity] * b.count - w[a.severity] * a.count), score, formula: `100 × (1 − Σ(poids de gravité × lignes en échec) ÷ ${totalRows} lignes) ; poids Critique 5, Élevée 3, Moyenne 1,5, Faible 0,5` };
}

// ---------------------------------------------------------------- forecasting (transparent methods + backtest)
export interface ForecastResult { method: string; history: Array<{ m: string; v: number }>; fitted: Array<{ m: string; v: number | null }>; future: Array<{ m: string; v: number; lo: number; hi: number }>; mape: number | null; note: string }
export function forecast(series: Array<{ m: string; v: number }>, horizon = 3): ForecastResult[] {
    const v = series.map(s => s.v), n = v.length;
    const methods: Array<{ name: string; f: (i: number, hist: number[]) => number | null; note: string }> = [
        { name: "Moyenne mobile sur 3 mois", note: "Moyenne des 3 mois précédents.", f: (i, h) => (i >= 3 ? (h[i - 1] + h[i - 2] + h[i - 3]) / 3 : null) },
        { name: "Tendance linéaire", note: "Droite des moindres carrés sur tous les mois précédents.", f: (i, h) => { if (i < 4) { return null; } const xs = h.slice(0, i).map((_, k) => k); const mx = mean(xs), my = mean(h.slice(0, i)); const b = xs.reduce((s, x, k) => s + (x - mx) * (h[k] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0); return my + b * (i - mx); } },
        { name: "Naïf saisonnier", note: "Même mois l'année précédente.", f: (i, h) => (i >= 12 ? h[i - 12] : null) }
    ];
    return methods.map(meth => {
        const fitted = series.map((s, i) => ({ m: s.m, v: meth.f(i, v) }));
        const errs = fitted.map((f, i) => (f.v !== null && v[i] ? Math.abs(v[i] - f.v) / v[i] : null)).filter((e): e is number => e !== null);
        const res = fitted.map((f, i) => (f.v !== null ? v[i] - f.v : null)).filter((e): e is number => e !== null);
        const rmse = res.length ? Math.sqrt(mean(res.map(r => r * r))) : 0;
        const ext = v.slice(); const future: ForecastResult["future"] = [];
        let lastM = series.length ? series[series.length - 1].m : "2026-01";
        for (let h = 0; h < horizon; h++) {
            const val = meth.f(ext.length, ext) ?? (ext.length ? ext[ext.length - 1] : 0);
            ext.push(val); lastM = addMonths(lastM + "-01", 1).slice(0, 7);
            future.push({ m: lastM, v: val, lo: Math.max(0, val - 1.96 * rmse), hi: val + 1.96 * rmse });
        }
        return { method: meth.name, history: series, fitted, future, mape: errs.length ? mean(errs) : null, note: `${meth.note} Bande = ±1,96 × RMSE du backtest (${n} mois d'historique) ; indicatif uniquement.` };
    });
}

// ---------------------------------------------------------------- root cause: decomposition of a revenue change
export interface Driver { dim: string; member: string; cur: number; prev: number; delta: number; share: number }
export function decomposeRevenue(ix: Index, cur: Ctx, prev: Ctx): { total: number; priceVolume: { volume: number; price: number }; drivers: Driver[] } {
    const dims: Array<{ dim: string; key: (o: Row) => string }> = [
        { dim: "Département", key: o => ix.deptName(ix.empDept(o.sales_owner_id)) }, { dim: "Canal", key: o => o.sales_channel },
        { dim: "Région", key: o => ix.cust.get(o.customer_id)?.region ?? "—" }, { dim: "Segment", key: o => ix.cust.get(o.customer_id)?.customer_segment ?? "—" }
    ];
    const a = orders(ix, cur).filter(isRevenue), b = orders(ix, prev).filter(isRevenue);
    const ta = sum(a, o => o.net_amount_tnd), tb = sum(b, o => o.net_amount_tnd), total = ta - tb;
    const drivers: Driver[] = [];
    dims.forEach(dm => {
        const ga = groupBy(a, dm.key), gb = groupBy(b, dm.key);
        new Set([...ga.keys(), ...gb.keys()]).forEach(k => { const c = sum(ga.get(k) ?? [], o => o.net_amount_tnd), p = sum(gb.get(k) ?? [], o => o.net_amount_tnd); drivers.push({ dim: dm.dim, member: k, cur: c, prev: p, delta: c - p, share: total ? (c - p) / total : 0 }); });
    });
    // product category (line grain)
    const cat = (list: Row[]): Map<string, number> => { const m = new Map<string, number>(); list.forEach(o => (ix.linesByOrder.get(o.order_id) ?? []).forEach(l => { const k = ix.prod.get(l.product_id)?.category ?? "—"; m.set(k, (m.get(k) ?? 0) + l.net_line_amount_tnd); })); return m; };
    const ca = cat(a), cb = cat(b);
    new Set([...ca.keys(), ...cb.keys()]).forEach(k => { const c = ca.get(k) ?? 0, p = cb.get(k) ?? 0; drivers.push({ dim: "Catégorie de produit", member: k, cur: c, prev: p, delta: c - p, share: total ? (c - p) / total : 0 }); });
    const aovA = div(ta, a.length) ?? 0, aovB = div(tb, b.length) ?? 0;
    return { total, priceVolume: { volume: (a.length - b.length) * aovB, price: a.length * (aovA - aovB) }, drivers: drivers.sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta)) };
}

// ---------------------------------------------------------------- scenario engine (What-If, Scenario Lab, Sandbox)
export interface ScenarioInputs { revenuePct: number; costPct: number; discountPts: number; headcount: number; churnPct: number; supplierCostPct: number; marketingPct: number }
export const ZERO_INPUTS: ScenarioInputs = { revenuePct: 0, costPct: 0, discountPts: 0, headcount: 0, churnPct: 0, supplierCostPct: 0, marketingPct: 0 };
export interface Baseline { revenue: number; productCost: number; opex: number; payroll: number; marketing: number; collectionRate: number; activeEmployees: number; payrollPerHead: number; months: number }
export interface ScenarioResult { revenue: number; productCost: number; opex: number; cost: number; grossProfit: number; operatingProfit: number; margin: number | null; cash: number; risk: number; bridge: Array<{ step: string; value: number }> }
/** Baseline = actual trailing 12 months to the reference date. */
export function baseline(ix: Index): Baseline {
    const p = period("12m", ix.ref, ix.first); const k = kpis(ix, { p, dept: "" });
    const exp = ix.d.expenses.filter(e => inP(e.expense_date, p) && e.approval_status !== "Rejeté");
    const payroll = sum(exp.filter(e => e.expense_category === "Masse salariale"), e => e.amount_tnd);
    const marketing = sum(exp.filter(e => e.expense_category === "Marketing"), e => e.amount_tnd);
    const active = ix.d.employees.filter(e => e.employment_status === "Actif").length || 1;
    return { revenue: k.netRevenue, productCost: k.cost, opex: k.expenses, payroll, marketing, collectionRate: k.collectionRate ?? 0, activeEmployees: active, payrollPerHead: payroll / active, months: 12 };
}
/** First-order model: every input moves one line; no hidden elasticities. */
export function simulate(b: Baseline, i: ScenarioInputs): ScenarioResult {
    const bridge: Array<{ step: string; value: number }> = [];
    const baseProfit = b.revenue - b.productCost - b.opex;
    const revAfterChange = b.revenue * (1 + i.revenuePct);
    const revAfterChurn = revAfterChange * (1 - i.churnPct);
    const revenue = revAfterChurn * (1 - i.discountPts);
    const productCost = b.productCost * (revAfterChurn / (b.revenue || 1)) * (1 + i.supplierCostPct);
    const opexOther = (b.opex - b.payroll - b.marketing) * (1 + i.costPct);
    const payroll = b.payroll + i.headcount * b.payrollPerHead;
    const marketing = b.marketing * (1 + i.marketingPct);
    const opex = opexOther + payroll + marketing;
    const op = revenue - productCost - opex;
    bridge.push({ step: "Résultat de référence", value: baseProfit });
    bridge.push({ step: "Variation du CA", value: (revAfterChange - b.revenue) * (1 - b.productCost / (b.revenue || 1)) });
    bridge.push({ step: "Attrition", value: (revAfterChurn - revAfterChange) * (1 - b.productCost / (b.revenue || 1)) });
    bridge.push({ step: "Remise", value: revenue - revAfterChurn });
    bridge.push({ step: "Coût fournisseurs", value: -(productCost - b.productCost * (revAfterChurn / (b.revenue || 1))) });
    bridge.push({ step: "Coûts d'exploitation", value: -(opexOther - (b.opex - b.payroll - b.marketing)) });
    bridge.push({ step: "Effectif", value: -(payroll - b.payroll) });
    bridge.push({ step: "Marketing", value: -(marketing - b.marketing) });
    const margin = div(revenue - productCost, revenue);
    const baseMargin = div(b.revenue - b.productCost, b.revenue) ?? 0;
    // transparent risk score 0-100: margin erosion (40) + churn (30) + operating loss (30)
    const risk = Math.round(Math.min(40, Math.max(0, (baseMargin - (margin ?? 0)) * 400)) + Math.min(30, i.churnPct * 150) + (op < 0 ? 30 : op < baseProfit * 0.5 ? 15 : 0));
    return { revenue, productCost, opex, cost: productCost + opex, grossProfit: revenue - productCost, operatingProfit: op, margin, cash: revenue * b.collectionRate, risk, bridge };
}
/** Map a row of scenarios.csv to simulator inputs (retention change = − churn; margin change applied to supplier cost). */
export function scenarioInputs(s: Row): ScenarioInputs {
    return { ...ZERO_INPUTS, revenuePct: s.revenue_change_pct || 0, costPct: s.cost_change_pct || 0, churnPct: Math.max(0, -(s.retention_change_pct || 0)), supplierCostPct: -(s.margin_change_pct || 0) };
}

// ---------------------------------------------------------------- crisis simulator
export interface CrisisResult { template: string; severity: number; exposure: number; profitImpact: number; affected: Array<{ name: string; value: number; kind: string }>; levers: Array<{ lever: string; offset: number; note: string }>; explanation: string }
export function crisis(ix: Index, b: Baseline, template: "revenue" | "cost" | "churn" | "supplier" | "system", severity: number): CrisisResult {
    const p = period("12m", ix.ref, ix.first);
    const rev = orders(ix, { p, dept: "" }).filter(isRevenue);
    const byCust = Array.from(groupBy(rev, o => o.customer_id).entries()).map(([id, l]) => ({ id, v: sum(l, o => o.net_amount_tnd) })).sort((a, c) => c.v - a.v);
    const byDept = Array.from(groupBy(rev, o => ix.empDept(o.sales_owner_id)).entries()).map(([id, l]) => ({ name: ix.deptName(id), value: sum(l, o => o.net_amount_tnd), kind: "Département" })).sort((a, c) => c.value - a.value);
    const gmRate = 1 - b.productCost / (b.revenue || 1);
    let exposure = 0, profitImpact = 0, explanation = "", affected: CrisisResult["affected"] = [];
    if (template === "revenue") { exposure = b.revenue * severity; profitImpact = -exposure * gmRate; explanation = `Le CA baisse de ${Math.round(severity * 100)} % partout ; le taux de marge brute (${(gmRate * 100).toFixed(1).replace(".", ",")} %) est perdu sur le CA manquant.`; affected = byDept.map(x => ({ ...x, value: x.value * severity })); }
    if (template === "cost") { exposure = b.opex * severity; profitImpact = -exposure; explanation = `Les charges d'exploitation augmentent de ${Math.round(severity * 100)} % ; chaque dinar supplémentaire réduit d'autant le résultat d'exploitation.`; affected = Array.from(groupBy(ix.d.expenses.filter(e => inP(e.expense_date, p) && e.approval_status !== "Rejeté"), e => e.department_id).entries()).map(([id, l]) => ({ name: ix.deptName(id), value: sum(l, e => e.amount_tnd) * severity, kind: "Département" })).sort((a, c) => c.value - a.value); }
    if (template === "churn") {
        const atRisk = byCust.filter(c => ix.cust.get(c.id)?.customer_status === "À risque");
        const n = Math.round(ix.d.customers.length * severity); const lost = atRisk.concat(byCust.filter(c => !atRisk.includes(c))).slice(0, n);
        exposure = sum(lost, c => c.v); profitImpact = -exposure * gmRate; explanation = `${n} clients (${Math.round(severity * 100)} % de la base) partent, en commençant par les clients à risque ; leur CA des 12 derniers mois est perdu.`;
        affected = lost.slice(0, 10).map(c => ({ name: ix.custName(c.id), value: c.v, kind: "Client" }));
    }
    if (template === "supplier") {
        const high = new Set(ix.d.suppliers.filter(s => s.risk_level === "Élevée" || s.supplier_status === "Bloqué").map(s => s.supplier_id));
        const prods = new Set(ix.d.inventory_snapshots.filter(i => high.has(i.supplier_id)).map(i => i.product_id));
        const lines = rev.flatMap(o => ix.linesByOrder.get(o.order_id) ?? []).filter(l => prods.has(l.product_id));
        const exposedRev = sum(lines, l => l.net_line_amount_tnd); const exposedCost = sum(lines, l => l.line_cost_tnd);
        exposure = exposedCost * severity; profitImpact = -exposure; explanation = `Le coût des produits venant de ${high.size} fournisseurs à risque élevé ou bloqués augmente de ${Math.round(severity * 100)} % (choc de délai modélisé en coût). CA exposé : ${Math.round(exposedRev).toLocaleString("fr-FR")} TND.`;
        affected = Array.from(groupBy(lines, l => l.product_id).entries()).map(([id, l]) => ({ name: ix.prodName(id), value: sum(l, x => x.line_cost_tnd) * severity, kind: "Produit" })).sort((a, c) => c.value - a.value).slice(0, 10);
    }
    if (template === "system") {
        const hist = ix.d.incidents.filter(i => i.incident_type === "Panne système");
        const avg = mean(hist.map(i => i.estimated_impact_tnd)) || mean(ix.d.incidents.map(i => i.estimated_impact_tnd));
        exposure = avg * (1 + severity * 4) + b.revenue / 365 * severity * 10; profitImpact = -exposure;
        explanation = `Incident système majeur : impact moyen historique d'une panne ${Math.round(avg).toLocaleString("fr-FR")} TND × facteur de gravité (${(1 + severity * 4).toFixed(1)}) plus ${Math.round(severity * 10)} jours de CA perdu (${Math.round(b.revenue / 365).toLocaleString("fr-FR")} TND/jour).`;
        affected = Array.from(groupBy(hist, i => i.department_id).entries()).map(([id, l]) => ({ name: ix.deptName(id), value: sum(l, i => i.estimated_impact_tnd), kind: "Département (historique)" })).sort((a, c) => c.value - a.value);
    }
    const levers = [
        { lever: "Hausse de prix de 3 % sur le CA conservé", offset: (b.revenue - (template === "revenue" ? exposure : 0)) * 0.03, note: "Suppose aucune perte de volume (optimiste)." },
        { lever: "Réduire les dépenses marketing de 20 %", offset: b.marketing * 0.2, note: "Peut ralentir le pipeline les mois suivants." },
        { lever: "Encaisser 50 % des paiements en retard", offset: sum(ix.d.payments.filter(pm => pm.payment_status === "En retard"), pm => pm.amount_tnd) * 0.5, note: "Effet sur la trésorerie, pas sur le résultat." },
        { lever: "Geler les recrutements (−3 postes)", offset: 3 * b.payrollPerHead, note: "Masse salariale par personne calculée sur les dépenses de paie récentes." }
    ];
    return { template, severity, exposure, profitImpact, affected, levers, explanation: explanation + " Estimation modélisée — ni une prévision ni un conseil financier." };
}

// ---------------------------------------------------------------- calendar: recurrence + conflicts
export interface CalEvent { id: string; base: string; title: string; type: string; priority: string; start: string; end: string; owner: string; dept: string; status: string; recurrence: string; occurrence: boolean; row: Row }
/** Expands Daily/Weekly/Monthly events inside [from, to] (local demo timestamps, no time-zone conversion; max 60 occurrences per event). */
export function expandEvents(rows: Row[], from: string, to: string): CalEvent[] {
    const out: CalEvent[] = [];
    rows.forEach(r => {
        if (!r.start_datetime) { return; }
        const mk = (start: string, end: string, occ: boolean): CalEvent => ({ id: occ ? `${r.event_id}@${start.slice(0, 10)}` : r.event_id, base: r.event_id, title: r.event_title, type: r.event_type, priority: r.priority, start, end, owner: r.owner_employee_id, dept: r.department_id, status: r.event_status, recurrence: r.recurrence_pattern, occurrence: occ, row: r });
        const durMs = Date.parse(r.end_datetime.replace(" ", "T") + ":00Z") - Date.parse(r.start_datetime.replace(" ", "T") + ":00Z");
        const shift = (iso: string, n: number, unit: string): string => { const d = new Date(iso.replace(" ", "T") + ":00Z"); if (unit === "Quotidienne") { d.setUTCDate(d.getUTCDate() + n); } else if (unit === "Hebdomadaire") { d.setUTCDate(d.getUTCDate() + 7 * n); } else { d.setUTCMonth(d.getUTCMonth() + n); } return d.toISOString().slice(0, 16).replace("T", " "); };
        const end = (s: string): string => new Date(Date.parse(s.replace(" ", "T") + ":00Z") + durMs).toISOString().slice(0, 16).replace("T", " ");
        if (r.recurrence_pattern === "Une fois" || !r.recurrence_pattern || r.event_status === "Annulé") { if (day(r.start_datetime) <= to && day(r.end_datetime) >= from) { out.push(mk(r.start_datetime, r.end_datetime, false)); } return; }
        for (let n = 0, count = 0; n < 400 && count < 60; n++) {
            const s = n === 0 ? r.start_datetime : shift(r.start_datetime, n, r.recurrence_pattern);
            if (day(s) > to) { break; }
            if (day(s) >= from) { out.push(mk(s, n === 0 ? r.end_datetime : end(s), n > 0)); count++; }
        }
    });
    return out.sort((a, b) => a.start.localeCompare(b.start));
}
/** Same owner, overlapping time intervals (cancelled events ignored). */
export function conflicts(events: CalEvent[]): Array<{ a: CalEvent; b: CalEvent }> {
    const out: Array<{ a: CalEvent; b: CalEvent }> = [];
    groupBy(events.filter(e => e.status !== "Annulé"), e => e.owner).forEach(list => {
        const s = list.slice().sort((x, y) => x.start.localeCompare(y.start));
        for (let i = 0; i < s.length; i++) { for (let j = i + 1; j < s.length && s[j].start < s[i].end; j++) { out.push({ a: s[i], b: s[j] }); } }
    });
    return out;
}

// ---------------------------------------------------------------- time machine snapshot (trailing 30 days ending on a date)
export interface Snapshot { date: string; revenue: number; orders: number; incidents: number; criticalIncidents: number; alerts: number; expenses: number; collections: number }
export function snapshot(ix: Index, date: string, dept = ""): Snapshot {
    const p = { from: addDays(date, -29), to: date, label: "" };
    const o = orders(ix, { p, dept }).filter(isRevenue);
    const inc = ix.d.incidents.filter(i => inP(i.incident_date, p) && (!dept || i.department_id === dept));
    const pays = ix.d.payments.filter(pm => inP(pm.payment_date, p) && (pm.payment_status === "Payé" || pm.payment_status === "Partiel"));
    return { date, revenue: sum(o, x => x.net_amount_tnd), orders: o.length, incidents: inc.length, criticalIncidents: inc.filter(i => i.severity === "Critique").length, alerts: ix.d.alerts.filter(a => inP(a.alert_date, p)).length, expenses: sum(ix.d.expenses.filter(e => inP(e.expense_date, p) && e.approval_status !== "Rejeté" && (!dept || e.department_id === dept)), e => e.amount_tnd), collections: sum(pays, pm => pm.amount_tnd) };
}

// ---------------------------------------------------------------- graph helpers
export interface GNode { id: string; type: string; label: string; degree: number }
export interface GEdge { id: string; s: string; t: string; type: string; strength: number; basis: string }
export function graph(ix: Index): { nodes: GNode[]; edges: GEdge[] } {
    const nodes = new Map<string, GNode>(); const edges: GEdge[] = [];
    const node = (type: string, id: string): string => { const k = `${type}:${id}`; const n = nodes.get(k); if (n) { n.degree++; } else { nodes.set(k, { id: k, type, label: ix.entityLabel(type, id), degree: 1 }); } return k; };
    ix.d.entity_relationships.forEach(r => edges.push({ id: r.relationship_id, s: node(r.source_entity_type, r.source_entity_id), t: node(r.target_entity_type, r.target_entity_id), type: r.relationship_type, strength: r.relationship_strength, basis: r.relationship_basis }));
    return { nodes: Array.from(nodes.values()), edges };
}
/** Shortest path (BFS, undirected) between two node ids. */
export function path(edges: GEdge[], from: string, to: string): string[] {
    const adj = new Map<string, string[]>(); edges.forEach(e => { (adj.get(e.s) ?? adj.set(e.s, []).get(e.s))?.push(e.t); (adj.get(e.t) ?? adj.set(e.t, []).get(e.t))?.push(e.s); });
    const prev = new Map<string, string>(); const q = [from]; const seen = new Set([from]);
    while (q.length) { const n = q.shift() as string; if (n === to) { break; } (adj.get(n) ?? []).forEach(m => { if (!seen.has(m)) { seen.add(m); prev.set(m, n); q.push(m); } }); }
    if (!seen.has(to)) { return []; }
    const out = [to]; while (out[0] !== from) { out.unshift(prev.get(out[0]) as string); }
    return out;
}

// ---------------------------------------------------------------- KPI dependency graph (mathematical, not causal)
export const KPI_DEPS: Array<{ id: string; label: string; formula: string; inputs: string[] }> = [
    { id: "orders", label: "Commandes", formula: "nombre de commandes génératrices de CA", inputs: [] },
    { id: "pricing", label: "Prix unitaire", formula: "Σ qty × unit price ÷ Σ qty", inputs: [] },
    { id: "discount", label: "Remise", formula: "montant catalogue − montant net des lignes", inputs: ["pricing"] },
    { id: "mix", label: "Mix produits", formula: "part du CA par catégorie", inputs: [] },
    { id: "revenue", label: "CA net", formula: "Σ net des commandes (Terminé + En traitement)", inputs: ["orders", "pricing", "discount", "mix", "churn"] },
    { id: "cost", label: "Coût des produits", formula: "Σ coût des lignes", inputs: ["orders", "mix", "inventory"] },
    { id: "margin", label: "Marge brute", formula: "(CA − coût) ÷ CA", inputs: ["revenue", "cost"] },
    { id: "collections", label: "Encaissements", formula: "paid ÷ (paid + outstanding)", inputs: ["revenue"] },
    { id: "churn", label: "Attrition", formula: "clients Perdu ÷ tous les clients", inputs: ["incidents", "delivery"] },
    { id: "inventory", label: "Stocks", formula: "dernier stock disponible vs point de commande", inputs: [] },
    { id: "incidents", label: "Incidents", formula: "incidents ouverts et impact estimé", inputs: [] },
    { id: "delivery", label: "Réalisation des projets", formula: "avancement pondéré par le budget", inputs: ["incidents"] },
    { id: "opprofit", label: "Résultat d'exploitation", formula: "marge brute − dépenses", inputs: ["margin", "expenses"] },
    { id: "expenses", label: "Dépenses", formula: "Σ dépenses (hors Rejeté)", inputs: [] }
];
