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
export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
    { key: "30d", label: "Last 30 days" }, { key: "mtd", label: "Month to date" }, { key: "3m", label: "Last 3 months" },
    { key: "6m", label: "Last 6 months" }, { key: "ytd", label: "Year to date" }, { key: "12m", label: "Last 12 months" }, { key: "all", label: "All data" }
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
    return { from: addDays(p.from, -len), to: addDays(p.from, -1), label: "Previous period" };
}
export interface Ctx { p: Period; dept: string }
const inP = (iso: string, p: Period): boolean => { const d = day(iso); return d >= p.from && d <= p.to; };

export const REVENUE_STATUSES = new Set(["Completed", "Processing"]);
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
export const OPEN_INCIDENT = new Set(["Open", "Investigating"]);
export const OPEN_ALERT = new Set(["New", "In Progress", "Acknowledged"]);
export function isAtRiskProject(p: Row, ref: string): boolean { return p.project_status === "At Risk" || (day(p.planned_end_date) < ref && p.project_status !== "Completed"); }
export function isOverdueTask(t: Row, ref: string): boolean { return t.task_status !== "Done" && day(t.due_date) < ref; }

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
    const paid = sum(pays.filter(p => p.payment_status === "Paid" || p.payment_status === "Partial"), p => p.amount_tnd);
    const outstanding = sum(pays.filter(p => p.payment_status === "Pending" || p.payment_status === "Overdue"), p => p.amount_tnd);
    const overdueP = pays.filter(p => p.payment_status === "Overdue");
    const exp = d.expenses.filter(e => inP(e.expense_date, c.p) && e.approval_status !== "Rejected" && (!c.dept || e.department_id === c.dept));
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
        completed: all.filter(o => o.order_status === "Completed").length, cancelled: all.filter(o => o.order_status === "Cancelled").length,
        returned: all.filter(o => o.order_status === "Returned").length, units: sum(lines, l => l.quantity),
        aov: div(net, rev.length), discount: list - sum(lines, l => l.net_line_amount_tnd), cost, grossProfit: net - cost, gm: div(net - cost, net),
        paid, outstanding, collectionRate: div(paid, paid + outstanding), overdue: sum(overdueP, p => p.amount_tnd), overdueCount: overdueP.length,
        expenses, operatingProfit: net - cost - expenses, expenseRatio: div(expenses, net),
        openIncidents: inc.length, criticalIncidents: inc.filter(i => i.severity === "Critical").length, incidentImpact: sum(inc, i => i.estimated_impact_tnd),
        openAlerts: alerts.length, criticalAlerts: alerts.filter(a => a.severity === "Critical").length,
        atRiskCustomers: d.customers.filter(cu => cu.customer_status === "At Risk").length,
        projectCompletion: div(sum(projects, p => p.approved_budget_tnd * p.completion_percent), budget),
        atRiskProjects: projects.filter(p => isAtRiskProject(p, ref)).length,
        openTasks: tasks.filter(t => t.task_status !== "Done").length, overdueTasks: tasks.filter(t => isOverdueTask(t, ref)).length,
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
export interface DeptHealth { id: string; name: string; score: number; status: "Healthy" | "Watch" | "Critical"; revenue: number; expenses: number; openIncidents: number; critical: number; overdueTasks: number; atRiskProjects: number; openRiskExposure: number; drivers: string[] }
export function deptHealth(ix: Index, c: Ctx): DeptHealth[] {
    return ix.d.departments.map(dep => {
        const k = kpis(ix, { p: c.p, dept: dep.department_id });
        const risks = ix.d.risk_register.filter(r => r.department_id === dep.department_id && (r.mitigation_status === "Open" || r.mitigation_status === "Mitigating"));
        const exposure = sum(risks, r => r.estimated_exposure_tnd);
        const drivers: string[] = [];
        let score = 100;
        const pen = (cond: boolean, pts: number, why: string): void => { if (cond) { score -= pts; drivers.push(`−${pts} ${why}`); } };
        pen(k.criticalIncidents > 0, Math.min(25, k.criticalIncidents * 6), `${k.criticalIncidents} critical open incident(s)`);
        pen(k.openIncidents > 8, 10, `${k.openIncidents} open incidents`);
        pen(k.overdueTasks > 20, Math.min(20, Math.round(k.overdueTasks / 3)), `${k.overdueTasks} overdue tasks`);
        pen(k.atRiskProjects > 0, Math.min(20, k.atRiskProjects * 7), `${k.atRiskProjects} at-risk project(s)`);
        pen(exposure > 500000, 10, `open risk exposure ${Math.round(exposure / 1000)}K TND`);
        score = Math.max(0, score);
        return { id: dep.department_id, name: dep.department_name, score, status: score >= 70 ? "Healthy" : score >= 45 ? "Watch" : "Critical", revenue: k.netRevenue, expenses: k.expenses, openIncidents: k.openIncidents, critical: k.criticalIncidents, overdueTasks: k.overdueTasks, atRiskProjects: k.atRiskProjects, openRiskExposure: exposure, drivers };
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
        out.push({ metric, delta: d, tone: (d > 0) === upGood ? "good" : "bad", text: `${metric} ${d > 0 ? "rose" : "fell"} ${Math.abs(d * 100).toFixed(1)}% (${fmt(b)} → ${fmt(a)})` });
    };
    const k = (v: number): string => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : v.toFixed(0));
    add("Net revenue", cur.netRevenue, prev.netRevenue, true, k);
    add("Orders", cur.orders, prev.orders, true, k);
    add("Average order value", cur.aov ?? 0, prev.aov ?? 0, true, k);
    add("Expenses", cur.expenses, prev.expenses, false, k);
    add("Cancelled orders", cur.cancelled, prev.cancelled, false, k, 0.15);
    add("Returned orders", cur.returned, prev.returned, false, k, 0.15);
    if (cur.gm !== null && prev.gm !== null && Math.abs(cur.gm - prev.gm) >= 0.01) {
        out.push({ metric: "Gross margin", delta: cur.gm - prev.gm, tone: cur.gm > prev.gm ? "good" : "bad", text: `Gross margin ${cur.gm > prev.gm ? "improved" : "declined"} ${(Math.abs(cur.gm - prev.gm) * 100).toFixed(1)} pts (${(prev.gm * 100).toFixed(1)}% → ${(cur.gm * 100).toFixed(1)}%)` });
    }
    if (cur.collectionRate !== null && prev.collectionRate !== null && Math.abs(cur.collectionRate - prev.collectionRate) >= 0.02) {
        out.push({ metric: "Collection rate", delta: cur.collectionRate - prev.collectionRate, tone: cur.collectionRate > prev.collectionRate ? "good" : "bad", text: `Collection rate ${cur.collectionRate > prev.collectionRate ? "improved" : "worsened"} ${(Math.abs(cur.collectionRate - prev.collectionRate) * 100).toFixed(1)} pts` });
    }
    if (!out.length) { out.push({ metric: "Stable", delta: null, tone: "neutral", text: "No KPI moved more than 5% versus the previous period." }); }
    return out.sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0));
}

// ---------------------------------------------------------------- queue priority scoring (transparent)
export interface QueueItem { id: string; type: "Alert" | "Incident" | "Overdue task" | "At-risk project" | "Data quality" | "Approval"; title: string; severity: string; owner: string; dept: string; status: string; date: string; impact: number; confidence: number; score: number; parts: Record<string, number>; module: string; row: Row }
export const SEVERITY_W: Record<string, number> = { Critical: 1, High: 0.75, Warning: 0.5, Medium: 0.5, Low: 0.25, Info: 0.15 };
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
    d.alerts.filter(a => OPEN_ALERT.has(a.alert_status)).forEach(a => items.push({ id: a.alert_id, type: "Alert", title: `${a.alert_type}: ${a.alert_description}`, severity: a.severity, owner: "—", dept: a.affected_area, status: a.alert_status, date: a.alert_date, impact: 0, confidence: a.confidence_score, module: "risk", row: a }));
    d.incidents.filter(i => OPEN_INCIDENT.has(i.incident_status)).forEach(i => items.push({ id: i.incident_id, type: "Incident", title: `${i.incident_type} (${i.impact_domain})`, severity: i.severity, owner: ix.empName(i.incident_owner_id), dept: ix.deptName(i.department_id), status: i.incident_status, date: i.incident_date, impact: i.estimated_impact_tnd, confidence: 0.8, module: "queue", row: i }));
    d.tasks.filter(t => isOverdueTask(t, ref)).forEach(t => items.push({ id: t.task_id, type: "Overdue task", title: `${t.task_title} · due ${day(t.due_date)}`, severity: t.priority, owner: ix.empName(t.assignee_employee_id), dept: ix.deptName(t.department_id), status: t.task_status, date: t.due_date, impact: 0, confidence: 1, module: "tasks", row: t }));
    d.projects.filter(p => isAtRiskProject(p, ref)).forEach(p => items.push({ id: p.project_id, type: "At-risk project", title: `${p.project_name} · ${Math.round(p.completion_percent * 100)}% done`, severity: p.project_status === "At Risk" ? "High" : "Medium", owner: ix.empName(p.project_owner_id), dept: ix.deptName(p.department_id), status: p.project_status, date: p.planned_end_date, impact: p.approved_budget_tnd * (1 - p.completion_percent), confidence: 0.9, module: "projects", row: p }));
    d.data_quality_issues.filter(q => q.issue_status === "Open" || q.issue_status === "Under Review").forEach(q => items.push({ id: q.issue_id, type: "Data quality", title: `${q.issue_type} in ${q.source_table}`, severity: q.severity, owner: "Data team", dept: "—", status: q.issue_status, date: q.detected_date, impact: 0, confidence: 0.6, module: "doctor", row: q }));
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
export const OPEN_RISK = new Set(["Open", "Mitigating"]);
export function riskByCategory(ix: Index, dept = ""): Array<{ cat: string; score: number; open: number; exposure: number }> {
    const rs = ix.d.risk_register.filter(r => !dept || r.department_id === dept);
    const max = Math.max(1, ...rs.map(r => r.estimated_exposure_tnd));
    return Array.from(groupBy(rs, r => r.risk_category).entries()).map(([cat, list]) => {
        const open = list.filter(r => OPEN_RISK.has(r.mitigation_status));
        return { cat, score: Math.round(mean(open.map(r => riskScore(r, max).score))) || 0, open: open.length, exposure: sum(open, r => r.estimated_exposure_tnd) };
    }).sort((a, b) => a.cat.localeCompare(b.cat));
}

// ---------------------------------------------------------------- anomaly detection (rules + statistics)
export interface Anomaly { id: string; rule: string; severity: "Critical" | "High" | "Medium" | "Low"; table: string; record: string; evidence: string; explanation: string }
export function anomalies(ix: Index): Anomaly[] {
    const d = ix.d, out: Anomaly[] = [];
    d.sales_orders.forEach(o => {
        const diff = o.gross_amount_tnd - (o.net_amount_tnd + o.tax_amount_tnd);
        if (Math.abs(diff) > 0.05) { out.push({ id: `AN-GROSS-${o.order_id}`, rule: "Amount mismatch", severity: "Critical", table: "sales_orders", record: o.order_id, evidence: `gross ${o.gross_amount_tnd.toFixed(2)} vs net ${o.net_amount_tnd.toFixed(2)} + tax ${o.tax_amount_tnd.toFixed(2)} = ${(o.net_amount_tnd + o.tax_amount_tnd).toFixed(2)}`, explanation: "Gross should equal net + tax. A difference this large usually means a keying or integration error; it inflates Gross Revenue." }); }
        if (o.promised_delivery_date && day(o.promised_delivery_date) < day(o.order_date)) { out.push({ id: `AN-DATE-${o.order_id}`, rule: "Invalid date order", severity: "High", table: "sales_orders", record: o.order_id, evidence: `promised ${day(o.promised_delivery_date)} is before order date ${day(o.order_date)}`, explanation: "A delivery cannot be promised before the order exists. Delivery-lead-time metrics would be negative for this order." }); }
    });
    // statistical outliers on order gross (z > 3)
    const g = d.sales_orders.map(o => o.gross_amount_tnd); const m = mean(g), s = std(g);
    d.sales_orders.forEach(o => { const z = s ? (o.gross_amount_tnd - m) / s : 0; if (z > 3) { out.push({ id: `AN-OUT-${o.order_id}`, rule: "Statistical outlier", severity: "Medium", table: "sales_orders", record: o.order_id, evidence: `gross ${o.gross_amount_tnd.toFixed(0)} is ${z.toFixed(1)}σ above the mean ${m.toFixed(0)}`, explanation: "Unusually large order. May be legitimate (large deal) — requires review, not a conclusion." }); } });
    // payment vs order mismatch for fully "Paid" payments
    d.payments.forEach(p => { const o = ix.order.get(p.order_id); if (o && p.payment_status === "Paid" && Math.abs(p.amount_tnd - o.gross_amount_tnd) / Math.max(1, o.gross_amount_tnd) > 0.25) { out.push({ id: `AN-PAY-${p.payment_id}`, rule: "Payment mismatch", severity: "High", table: "payments", record: p.payment_id, evidence: `paid ${p.amount_tnd.toFixed(2)} vs order gross ${o.gross_amount_tnd.toFixed(2)} (${p.order_id})`, explanation: "A payment marked Paid differs from the order gross by more than 25%." }); } });
    // possible duplicates: same customer, same day, same net amount
    const seen = new Map<string, string>();
    d.sales_orders.forEach(o => { const k = `${o.customer_id}|${o.order_date}|${o.net_amount_tnd}`; const prev = seen.get(k); if (prev) { out.push({ id: `AN-DUP-${o.order_id}`, rule: "Possible duplicate", severity: "Medium", table: "sales_orders", record: o.order_id, evidence: `same customer, day and amount as ${prev}`, explanation: "Two identical orders on the same day may be a double submission." }); } else { seen.set(k, o.order_id); } });
    // sudden monthly revenue change (> 40% vs previous complete month)
    const rm = revenueByMonth(ix); const ms = Array.from(rm.keys()).sort();
    for (let i = 1; i < ms.length - 1; i++) { const a = rm.get(ms[i - 1])?.net ?? 0, b = rm.get(ms[i])?.net ?? 0; const ch = a ? (b - a) / a : 0; if (Math.abs(ch) > 0.4) { out.push({ id: `AN-MOM-${ms[i]}`, rule: "Sudden change", severity: "Medium", table: "sales_orders", record: ms[i], evidence: `net revenue ${ch > 0 ? "+" : ""}${(ch * 100).toFixed(0)}% vs ${monthLabel(ms[i - 1])}`, explanation: "Month-over-month change above 40%. Check for seasonality, large deals or missing data." }); } }
    // expense outliers per category (z > 3)
    groupBy(d.expenses, e => e.expense_category).forEach((list, cat) => { const v = list.map(e => e.amount_tnd); const mm = mean(v), ss = std(v); list.forEach(e => { if (ss && (e.amount_tnd - mm) / ss > 3) { out.push({ id: `AN-EXP-${e.expense_id}`, rule: "Statistical outlier", severity: "Low", table: "expenses", record: e.expense_id, evidence: `${cat} ${e.amount_tnd.toFixed(0)} TND vs category mean ${mm.toFixed(0)}`, explanation: "Expense far above its category's usual size." }); } }); });
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

// ---------------------------------------------------------------- Data Doctor checks
export interface Check { id: string; table: string; check: string; severity: "Critical" | "High" | "Medium" | "Low"; count: number; examples: string[]; formula: string }
export function dataDoctor(ix: Index): { checks: Check[]; score: number; formula: string } {
    const d = ix.d, checks: Check[] = [];
    const add = (table: string, check: string, severity: Check["severity"], rows: string[], formula: string): void => { checks.push({ id: `${table}:${check}`, table, check, severity, count: rows.length, examples: rows.slice(0, 6), formula }); };
    add("sales_orders", "Gross ≠ net + tax", "Critical", d.sales_orders.filter(o => Math.abs(o.gross_amount_tnd - o.net_amount_tnd - o.tax_amount_tnd) > 0.05).map(o => o.order_id), "|gross − (net + tax)| > 0.05");
    add("sales_orders", "Promised delivery before order", "High", d.sales_orders.filter(o => o.promised_delivery_date && day(o.promised_delivery_date) < day(o.order_date)).map(o => o.order_id), "promised_delivery_date < order_date");
    add("sales_orders", "Order net ≠ sum of lines", "High", d.sales_orders.filter(o => Math.abs(o.net_amount_tnd - sum(ix.linesByOrder.get(o.order_id) ?? [], l => l.net_line_amount_tnd)) > 0.05).map(o => o.order_id), "|net − Σ line net| > 0.05");
    add("payments", "Order without payment", "Medium", d.sales_orders.filter(o => !ix.payByOrder.has(o.order_id)).map(o => o.order_id), "order_id not in payments");
    add("strategic_goals", "Target date before start date", "Medium", d.strategic_goals.filter(g => day(g.target_date) < day(g.start_date)).map(g => g.goal_id), "target_date < start_date");
    add("missions", "Target date before start date", "Medium", d.missions.filter(m => day(m.target_date) < day(m.start_date)).map(m => m.mission_id), "target_date < start_date");
    add("missions", "Completed below threshold", "Low", d.missions.filter(m => m.mission_status === "Completed" && m.progress_pct < m.completion_threshold_pct).map(m => m.mission_id), "status Completed and progress < threshold");
    add("strategic_goals", "Status inconsistent with values", "Low", d.strategic_goals.filter(g => g.goal_status === "Achieved" && g.current_value < g.target_value).map(g => g.goal_id), "status Achieved but current < target");
    add("projects", "Planned end before start", "High", d.projects.filter(p => day(p.planned_end_date) < day(p.start_date)).map(p => p.project_id), "planned_end_date < start_date");
    add("calendar_events", "End before start", "Medium", d.calendar_events.filter(e => e.end_datetime < e.start_datetime).map(e => e.event_id), "end_datetime < start_datetime");
    const empIds = new Set(d.employees.map(e => e.employee_id));
    add("tasks", "Unknown assignee", "High", d.tasks.filter(t => t.assignee_employee_id && !empIds.has(t.assignee_employee_id)).map(t => t.task_id), "assignee_employee_id not in employees");
    const g = d.sales_orders.map(o => o.gross_amount_tnd); const m = mean(g), s = std(g);
    add("sales_orders", "Gross amount outlier (z > 3)", "Low", d.sales_orders.filter(o => s && (o.gross_amount_tnd - m) / s > 3).map(o => o.order_id), "(gross − mean) / std > 3");
    const w = { Critical: 5, High: 3, Medium: 1.5, Low: 0.5 };
    const totalRows = Object.values(d).reduce((s2, t) => s2 + t.length, 0);
    const penalty = checks.reduce((s2, c) => s2 + w[c.severity] * c.count, 0);
    const score = Math.max(0, Math.round(1000 * (1 - penalty / Math.max(1, totalRows))) / 10);
    return { checks: checks.sort((a, b) => w[b.severity] * b.count - w[a.severity] * a.count), score, formula: `100 × (1 − Σ(severity weight × failing rows) ÷ ${totalRows} rows); weights Critical 5, High 3, Medium 1.5, Low 0.5` };
}

// ---------------------------------------------------------------- forecasting (transparent methods + backtest)
export interface ForecastResult { method: string; history: Array<{ m: string; v: number }>; fitted: Array<{ m: string; v: number | null }>; future: Array<{ m: string; v: number; lo: number; hi: number }>; mape: number | null; note: string }
export function forecast(series: Array<{ m: string; v: number }>, horizon = 3): ForecastResult[] {
    const v = series.map(s => s.v), n = v.length;
    const methods: Array<{ name: string; f: (i: number, hist: number[]) => number | null; note: string }> = [
        { name: "3-month moving average", note: "Average of the previous 3 months.", f: (i, h) => (i >= 3 ? (h[i - 1] + h[i - 2] + h[i - 3]) / 3 : null) },
        { name: "Linear trend", note: "Least-squares line through all previous months.", f: (i, h) => { if (i < 4) { return null; } const xs = h.slice(0, i).map((_, k) => k); const mx = mean(xs), my = mean(h.slice(0, i)); const b = xs.reduce((s, x, k) => s + (x - mx) * (h[k] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0); return my + b * (i - mx); } },
        { name: "Seasonal naive", note: "Same month last year.", f: (i, h) => (i >= 12 ? h[i - 12] : null) }
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
        return { method: meth.name, history: series, fitted, future, mape: errs.length ? mean(errs) : null, note: `${meth.note} Band = ±1.96 × backtest RMSE (${n} months of history); indicative only.` };
    });
}

// ---------------------------------------------------------------- root cause: decomposition of a revenue change
export interface Driver { dim: string; member: string; cur: number; prev: number; delta: number; share: number }
export function decomposeRevenue(ix: Index, cur: Ctx, prev: Ctx): { total: number; priceVolume: { volume: number; price: number }; drivers: Driver[] } {
    const dims: Array<{ dim: string; key: (o: Row) => string }> = [
        { dim: "Department", key: o => ix.deptName(ix.empDept(o.sales_owner_id)) }, { dim: "Channel", key: o => o.sales_channel },
        { dim: "Region", key: o => ix.cust.get(o.customer_id)?.region ?? "—" }, { dim: "Segment", key: o => ix.cust.get(o.customer_id)?.customer_segment ?? "—" }
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
    new Set([...ca.keys(), ...cb.keys()]).forEach(k => { const c = ca.get(k) ?? 0, p = cb.get(k) ?? 0; drivers.push({ dim: "Product category", member: k, cur: c, prev: p, delta: c - p, share: total ? (c - p) / total : 0 }); });
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
    const exp = ix.d.expenses.filter(e => inP(e.expense_date, p) && e.approval_status !== "Rejected");
    const payroll = sum(exp.filter(e => e.expense_category === "Payroll"), e => e.amount_tnd);
    const marketing = sum(exp.filter(e => e.expense_category === "Marketing"), e => e.amount_tnd);
    const active = ix.d.employees.filter(e => e.employment_status === "Active").length || 1;
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
    bridge.push({ step: "Baseline profit", value: baseProfit });
    bridge.push({ step: "Revenue change", value: (revAfterChange - b.revenue) * (1 - b.productCost / (b.revenue || 1)) });
    bridge.push({ step: "Churn", value: (revAfterChurn - revAfterChange) * (1 - b.productCost / (b.revenue || 1)) });
    bridge.push({ step: "Discount", value: revenue - revAfterChurn });
    bridge.push({ step: "Supplier cost", value: -(productCost - b.productCost * (revAfterChurn / (b.revenue || 1))) });
    bridge.push({ step: "Operating cost", value: -(opexOther - (b.opex - b.payroll - b.marketing)) });
    bridge.push({ step: "Headcount", value: -(payroll - b.payroll) });
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
    const byDept = Array.from(groupBy(rev, o => ix.empDept(o.sales_owner_id)).entries()).map(([id, l]) => ({ name: ix.deptName(id), value: sum(l, o => o.net_amount_tnd), kind: "Department" })).sort((a, c) => c.value - a.value);
    const gmRate = 1 - b.productCost / (b.revenue || 1);
    let exposure = 0, profitImpact = 0, explanation = "", affected: CrisisResult["affected"] = [];
    if (template === "revenue") { exposure = b.revenue * severity; profitImpact = -exposure * gmRate; explanation = `Revenue falls ${Math.round(severity * 100)}% across the board; gross margin rate (${(gmRate * 100).toFixed(1)}%) is lost on the missing revenue.`; affected = byDept.map(x => ({ ...x, value: x.value * severity })); }
    if (template === "cost") { exposure = b.opex * severity; profitImpact = -exposure; explanation = `Operating expenses rise ${Math.round(severity * 100)}%; every extra dinar reduces operating profit one-for-one.`; affected = Array.from(groupBy(ix.d.expenses.filter(e => inP(e.expense_date, p) && e.approval_status !== "Rejected"), e => e.department_id).entries()).map(([id, l]) => ({ name: ix.deptName(id), value: sum(l, e => e.amount_tnd) * severity, kind: "Department" })).sort((a, c) => c.value - a.value); }
    if (template === "churn") {
        const atRisk = byCust.filter(c => ix.cust.get(c.id)?.customer_status === "At Risk");
        const n = Math.round(ix.d.customers.length * severity); const lost = atRisk.concat(byCust.filter(c => !atRisk.includes(c))).slice(0, n);
        exposure = sum(lost, c => c.v); profitImpact = -exposure * gmRate; explanation = `${n} customers (${Math.round(severity * 100)}% of the base) leave, At-Risk customers first; their trailing-12-month revenue is lost.`;
        affected = lost.slice(0, 10).map(c => ({ name: ix.custName(c.id), value: c.v, kind: "Customer" }));
    }
    if (template === "supplier") {
        const high = new Set(ix.d.suppliers.filter(s => s.risk_level === "High" || s.supplier_status === "Blocked").map(s => s.supplier_id));
        const prods = new Set(ix.d.inventory_snapshots.filter(i => high.has(i.supplier_id)).map(i => i.product_id));
        const lines = rev.flatMap(o => ix.linesByOrder.get(o.order_id) ?? []).filter(l => prods.has(l.product_id));
        const exposedRev = sum(lines, l => l.net_line_amount_tnd); const exposedCost = sum(lines, l => l.line_cost_tnd);
        exposure = exposedCost * severity; profitImpact = -exposure; explanation = `Cost of products sourced from ${high.size} high-risk/blocked suppliers rises ${Math.round(severity * 100)}% (lead-time shock modeled as cost). Exposed revenue: ${Math.round(exposedRev).toLocaleString("en-US")} TND.`;
        affected = Array.from(groupBy(lines, l => l.product_id).entries()).map(([id, l]) => ({ name: ix.prodName(id), value: sum(l, x => x.line_cost_tnd) * severity, kind: "Product" })).sort((a, c) => c.value - a.value).slice(0, 10);
    }
    if (template === "system") {
        const hist = ix.d.incidents.filter(i => i.incident_type === "System Outage");
        const avg = mean(hist.map(i => i.estimated_impact_tnd)) || mean(ix.d.incidents.map(i => i.estimated_impact_tnd));
        exposure = avg * (1 + severity * 4) + b.revenue / 365 * severity * 10; profitImpact = -exposure;
        explanation = `Major system incident: historical average outage impact ${Math.round(avg).toLocaleString("en-US")} TND × severity factor (${(1 + severity * 4).toFixed(1)}) plus ${Math.round(severity * 10)} days of lost revenue (${Math.round(b.revenue / 365).toLocaleString("en-US")} TND/day).`;
        affected = Array.from(groupBy(hist, i => i.department_id).entries()).map(([id, l]) => ({ name: ix.deptName(id), value: sum(l, i => i.estimated_impact_tnd), kind: "Department (history)" })).sort((a, c) => c.value - a.value);
    }
    const levers = [
        { lever: "Price increase +3% on retained revenue", offset: (b.revenue - (template === "revenue" ? exposure : 0)) * 0.03, note: "Assumes no volume loss (optimistic)." },
        { lever: "Cut marketing spend 20%", offset: b.marketing * 0.2, note: "May slow pipeline in later months." },
        { lever: "Collect 50% of overdue payments", offset: sum(ix.d.payments.filter(pm => pm.payment_status === "Overdue"), pm => pm.amount_tnd) * 0.5, note: "Cash effect, not profit." },
        { lever: "Freeze hiring (−3 heads)", offset: 3 * b.payrollPerHead, note: "Payroll per head from trailing payroll expenses." }
    ];
    return { template, severity, exposure, profitImpact, affected, levers, explanation: explanation + " Modeled estimate — not a prediction or financial advice." };
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
        const shift = (iso: string, n: number, unit: string): string => { const d = new Date(iso.replace(" ", "T") + ":00Z"); if (unit === "Daily") { d.setUTCDate(d.getUTCDate() + n); } else if (unit === "Weekly") { d.setUTCDate(d.getUTCDate() + 7 * n); } else { d.setUTCMonth(d.getUTCMonth() + n); } return d.toISOString().slice(0, 16).replace("T", " "); };
        const end = (s: string): string => new Date(Date.parse(s.replace(" ", "T") + ":00Z") + durMs).toISOString().slice(0, 16).replace("T", " ");
        if (r.recurrence_pattern === "Once" || !r.recurrence_pattern || r.event_status === "Cancelled") { if (day(r.start_datetime) <= to && day(r.end_datetime) >= from) { out.push(mk(r.start_datetime, r.end_datetime, false)); } return; }
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
    groupBy(events.filter(e => e.status !== "Cancelled"), e => e.owner).forEach(list => {
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
    const pays = ix.d.payments.filter(pm => inP(pm.payment_date, p) && (pm.payment_status === "Paid" || pm.payment_status === "Partial"));
    return { date, revenue: sum(o, x => x.net_amount_tnd), orders: o.length, incidents: inc.length, criticalIncidents: inc.filter(i => i.severity === "Critical").length, alerts: ix.d.alerts.filter(a => inP(a.alert_date, p)).length, expenses: sum(ix.d.expenses.filter(e => inP(e.expense_date, p) && e.approval_status !== "Rejected" && (!dept || e.department_id === dept)), e => e.amount_tnd), collections: sum(pays, pm => pm.amount_tnd) };
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
    { id: "orders", label: "Orders", formula: "count of revenue orders", inputs: [] },
    { id: "pricing", label: "Unit price", formula: "Σ qty × unit price ÷ Σ qty", inputs: [] },
    { id: "discount", label: "Discount", formula: "list amount − net line amount", inputs: ["pricing"] },
    { id: "mix", label: "Product mix", formula: "revenue share by category", inputs: [] },
    { id: "revenue", label: "Net revenue", formula: "Σ order net (Completed + Processing)", inputs: ["orders", "pricing", "discount", "mix", "churn"] },
    { id: "cost", label: "Product cost", formula: "Σ line cost", inputs: ["orders", "mix", "inventory"] },
    { id: "margin", label: "Gross margin", formula: "(revenue − cost) ÷ revenue", inputs: ["revenue", "cost"] },
    { id: "collections", label: "Collections", formula: "paid ÷ (paid + outstanding)", inputs: ["revenue"] },
    { id: "churn", label: "Churn", formula: "customers Churned ÷ all customers", inputs: ["incidents", "delivery"] },
    { id: "inventory", label: "Inventory", formula: "latest on-hand vs reorder point", inputs: [] },
    { id: "incidents", label: "Incidents", formula: "open incidents & estimated impact", inputs: [] },
    { id: "delivery", label: "Project delivery", formula: "budget-weighted completion", inputs: ["incidents"] },
    { id: "opprofit", label: "Operating profit", formula: "gross profit − expenses", inputs: ["margin", "expenses"] },
    { id: "expenses", label: "Expenses", formula: "Σ expenses (not Rejected)", inputs: [] }
];
