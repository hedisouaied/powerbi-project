"use strict";

/** Right-side inspector: details, linked records, timeline and next steps for any selected entity or KPI. */
import type { Ctx } from "../app";
import { Row } from "../core/data";
import { day, isOverdueTask, isRevenue, kpis, monthRange, month, sum, addDays, addMonths, monthLabel, OPEN_INCIDENT } from "../core/engine";
import { STATUS_TONE } from "../core/theme";
import { btn, chip, drawer, fmt, h, icon } from "../core/ui";

export const KPI_DEFS: Record<string, { label: string; icon: string; fmt: (v: number) => string; get: (k: ReturnType<typeof kpis>) => number | null; good: boolean; rule: string }> = {
    netRevenue: { label: "Total revenue", icon: "TrendingUp", fmt: v => fmt.compact(v), get: k => k.netRevenue, good: true, rule: "Σ order net amount, Completed + Processing orders" },
    gm: { label: "Gross margin", icon: "Percent" as any, fmt: v => fmt.pct(v), get: k => k.gm, good: true, rule: "(net revenue − line cost) ÷ net revenue" },
    orders: { label: "Orders", icon: "Receipt", fmt: v => fmt.int(v), get: k => k.orders, good: true, rule: "count of orders, every status" },
    aov: { label: "Average order value", icon: "Coins", fmt: v => fmt.compact(v), get: k => k.aov, good: true, rule: "net revenue ÷ revenue orders" },
    collectionRate: { label: "Payment collection", icon: "Wallet", fmt: v => fmt.pct(v), get: k => k.collectionRate, good: true, rule: "Paid + Partial ÷ (Paid + Partial + Pending + Overdue)" },
    openIncidents: { label: "Open incidents", icon: "Siren", fmt: v => fmt.int(v), get: k => k.openIncidents, good: false, rule: "incidents Open or Investigating (current state)" },
    atRiskCustomers: { label: "At-risk customers", icon: "Users", fmt: v => fmt.int(v), get: k => k.atRiskCustomers, good: false, rule: "customers with status At Risk (current state)" },
    projectCompletion: { label: "Project delivery", icon: "ChartGantt", fmt: v => fmt.pct(v), get: k => k.projectCompletion, good: true, rule: "budget-weighted completion" },
    expenses: { label: "Expenses", icon: "Receipt", fmt: v => fmt.compact(v), get: k => k.expenses, good: false, rule: "Σ expenses, not Rejected" },
    grossProfit: { label: "Gross profit", icon: "Landmark", fmt: v => fmt.compact(v), get: k => k.grossProfit, good: true, rule: "net revenue − product cost" },
    openAlerts: { label: "Open alerts", icon: "Bell", fmt: v => fmt.int(v), get: k => k.openAlerts, good: false, rule: "alerts New / In Progress / Acknowledged" },
    overdueTasks: { label: "Overdue tasks", icon: "AlarmClock", fmt: v => fmt.int(v), get: k => k.overdueTasks, good: false, rule: "not Done and due before the reference date" }
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
        if (!rows.length) { return h("div", "mc-muted", "None"); }
        return h("div", "mc-ins-list", ...rows.slice(0, max).map(r => { const e = h("div", { class: `mc-ins-row${onClick ? " mc-click" : ""}`, tabindex: onClick ? 0 : null }, h("span", null, label(r)), h("span", "mc-muted", sub(r))); if (onClick) { e.onclick = (): void => onClick(r); } return e; }), rows.length > max ? h("div", "mc-muted", `+ ${rows.length - max} more`) : null);
    };
    const timeline = (events: Array<{ date: string; text: string; tone?: string }>): HTMLElement => h("div", "mc-timeline", ...events.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).map(e => h("div", `mc-tl-item mc-tone-${e.tone ?? "muted"}`, h("span", "mc-tl-date", fmt.date(e.date)), h("span", null, e.text))));
    let title = sel.id, ic = "Info";

    if (sel.type === "kpi") {
        const def = KPI_DEFS[sel.id];
        title = def?.label ?? sel.id; ic = def?.icon ?? "Gauge";
        const cur = kpis(ix, c.ec), prev = kpis(ix, c.prev);
        const a = def.get(cur), b = def.get(prev);
        section("Value", kv([["Current period", a === null ? "—" : def.fmt(a)], ["Previous period", b === null ? "—" : def.fmt(b)], ["Change", a !== null && b ? fmt.signedPct((a - b) / Math.abs(b)) : "—"], ["Rule", def.rule]]));
        const months = monthRange(month(addMonths(ix.ref, -11)), month(ix.ref));
        const trend = months.map(m => { const from = m + "-01"; const p = { from, to: addDays(addMonths(from, 1), -1), label: m }; return { m, v: def.get(kpis(ix, { p, dept: c.ec.dept })) ?? 0 }; });
        const chartEl = h("div", "mc-chart mc-h160"); section("12-month trend", chartEl);
        c.ch.line(chartEl, trend.map(t => monthLabel(t.m)), [{ name: def.label, data: trend.map(t => t.v) }], undefined, v => def.fmt(v));
        if (["netRevenue", "orders", "aov", "gm"].includes(sel.id)) {
            const top = Array.from(new Map(d.sales_orders.filter(o => isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to).map(o => [o.customer_id, 0])).keys())
                .map(id => ({ id, v: sum(d.sales_orders.filter(o => o.customer_id === id && isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to), o => o.net_amount_tnd) })).sort((x, y) => y.v - x.v);
            section("Top contributing customers", list(top as any, r => ix.custName(r.id), r => fmt.compact(r.v), r => c.select("customer", r.id)));
        }
        if (sel.id === "openIncidents") { section("Open incidents (largest impact)", list(d.incidents.filter(i => OPEN_INCIDENT.has(i.incident_status)).sort((x, y) => y.estimated_impact_tnd - x.estimated_impact_tnd), r => `${r.incident_type} · ${r.incident_id}`, r => `${r.severity} · ${fmt.compact(r.estimated_impact_tnd)}`, r => c.select("incident", r.incident_id))); }
        if (sel.id === "atRiskCustomers") { section("At-risk customers (largest contract)", list(d.customers.filter(x => x.customer_status === "At Risk").sort((x, y) => y.annual_contract_value_tnd - x.annual_contract_value_tnd), r => r.customer_name, r => `${r.region} · ${fmt.compact(r.annual_contract_value_tnd)}`, r => c.select("customer", r.customer_id))); }
        if (sel.id === "collectionRate") { section("Largest overdue payments", list(d.payments.filter(p => p.payment_status === "Overdue").sort((x, y) => y.amount_tnd - x.amount_tnd), r => `${r.payment_id} · ${ix.custName(ix.order.get(r.order_id)?.customer_id)}`, r => fmt.compact(r.amount_tnd), r => c.select("order", r.order_id))); }
        if (sel.id === "projectCompletion") { section("Projects", list(d.projects.slice().sort((x, y) => x.completion_percent - y.completion_percent), r => r.project_name, r => `${fmt.pct(r.completion_percent, 0)} · ${r.project_status}`, r => c.select("project", r.project_id))); }
        section("Next steps", h("div", "mc-row-gap", btn("Root cause", { icon: "GitBranch", small: true, onClick: () => { c.s.selection = null; c.go("rootcause"); } }), btn("Forecast", { icon: "Telescope", small: true, onClick: () => { c.s.selection = null; c.go("forecast"); } })));
    } else if (sel.type === "customer") {
        const r = ix.cust.get(sel.id); title = r?.customer_name ?? sel.id; ic = "Users";
        const ords = d.sales_orders.filter(o => o.customer_id === sel.id); const rev = ords.filter(isRevenue);
        const pays = ords.map(o => ix.payByOrder.get(o.order_id)).filter(Boolean) as Row[];
        const inter = d.customer_interactions.filter(i => i.customer_id === sel.id);
        const overdue = pays.filter(p => p.payment_status === "Overdue");
        const churnSignals = [r?.customer_status === "At Risk" ? "status At Risk" : "", overdue.length ? `${overdue.length} overdue payment(s)` : "", inter.filter(i => i.interaction_status === "Escalated").length ? `${inter.filter(i => i.interaction_status === "Escalated").length} escalated interaction(s)` : "", rev.length && day(rev.map(o => o.order_date).sort().slice(-1)[0]) < addDays(ix.ref, -120) ? "no order for 120+ days" : ""].filter(Boolean);
        section("Profile", kv([["Segment", r?.customer_segment], ["Industry", r?.industry], ["Region", r?.region], ["Status", st(r?.customer_status)], ["Customer since", fmt.date(r?.acquisition_date)], ["Contract value", fmt.money(r?.annual_contract_value_tnd)]]));
        section("Commercial", kv([["Orders", `${ords.length} (${rev.length} revenue)`], ["Net revenue", fmt.money(sum(rev, o => o.net_amount_tnd))], ["Paid", fmt.money(sum(pays.filter(p => p.payment_status === "Paid" || p.payment_status === "Partial"), p => p.amount_tnd))], ["Overdue", fmt.money(sum(overdue, p => p.amount_tnd))]]));
        section("Churn-risk indicators (rules, not a prediction)", churnSignals.length ? h("div", "mc-row-gap mc-wrap", ...churnSignals.map(x => chip(x, "bad"))) : h("div", "mc-muted", "No indicator fired."));
        section("Timeline", timeline([...ords.map(o => ({ date: o.order_date, text: `Order ${o.order_id} · ${o.order_status} · ${fmt.compact(o.gross_amount_tnd)}`, tone: STATUS_TONE[o.order_status] })), ...pays.map(p => ({ date: p.payment_date, text: `Payment ${p.payment_id} · ${p.payment_status} · ${fmt.compact(p.amount_tnd)}`, tone: STATUS_TONE[p.payment_status] })), ...inter.map(i => ({ date: i.interaction_date, text: `${i.channel} ${i.interaction_type} · ${i.interaction_status}`, tone: STATUS_TONE[i.interaction_status] }))]));
        section("Orders", list(ords.slice().sort((a, b) => b.order_date.localeCompare(a.order_date)), o => `${o.order_id} · ${fmt.date(o.order_date)}`, o => `${o.order_status} · ${fmt.compact(o.gross_amount_tnd)}`, o => c.select("order", o.order_id)));
    } else if (sel.type === "order") {
        const o = ix.order.get(sel.id); title = `Order ${sel.id}`; ic = "Receipt";
        if (o) {
            const lines = ix.linesByOrder.get(sel.id) ?? [], pay = ix.payByOrder.get(sel.id);
            const mismatch = Math.abs(o.gross_amount_tnd - o.net_amount_tnd - o.tax_amount_tnd) > 0.05, badDate = o.promised_delivery_date && day(o.promised_delivery_date) < day(o.order_date);
            section("Order", kv([["Customer", ix.custName(o.customer_id)], ["Date", fmt.date(o.order_date)], ["Owner", ix.empName(o.sales_owner_id)], ["Channel", o.sales_channel], ["Status", st(o.order_status)], ["Net", fmt.money2(o.net_amount_tnd)], ["Tax", fmt.money2(o.tax_amount_tnd)], ["Gross", fmt.money2(o.gross_amount_tnd)], ["Promised", fmt.date(o.promised_delivery_date)]]));
            if (mismatch || badDate) { section("Requires review", h("div", "mc-row-gap mc-wrap", mismatch ? chip(`gross ≠ net + tax (${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)})`, "bad") : null, badDate ? chip("promised before order date", "bad") : null)); }
            section("Lines", list(lines, l => `${ix.prodName(l.product_id)} × ${l.quantity}`, l => `${fmt.money2(l.net_line_amount_tnd)} · disc ${fmt.pct(l.discount_rate, 0)}`, l => c.select("product", l.product_id)));
            section("Payment", pay ? kv([["Payment", pay.payment_id], ["Status", st(pay.payment_status)], ["Amount", fmt.money2(pay.amount_tnd)], ["Method", pay.payment_method], ["Settled", fmt.date(pay.settlement_date)]]) : h("div", "mc-muted", "No payment"));
            section("Next steps", h("div", "mc-row-gap", btn("Open customer", { small: true, icon: "Users", onClick: () => c.select("customer", o.customer_id) }), btn("Investigate", { small: true, icon: "ScanSearch", onClick: () => { c.s.m.detectiveFocus = `Order:${o.order_id}`; c.s.selection = null; c.go("detective"); } })));
        }
    } else if (sel.type === "product") {
        const p = ix.prod.get(sel.id); title = p?.product_name ?? sel.id; ic = "Package";
        const lines = d.sales_order_items.filter(l => l.product_id === sel.id && isRevenue(ix.order.get(l.order_id) ?? {}));
        const inv = d.inventory_snapshots.filter(i => i.product_id === sel.id);
        const latest = Array.from(new Map(inv.slice().sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).map(i => [i.warehouse, i])).values());
        const rev = sum(lines, l => l.net_line_amount_tnd), cost = sum(lines, l => l.line_cost_tnd);
        section("Profile", kv([["Category", p?.category], ["Tier", p?.product_tier], ["Status", st(p?.product_status)], ["List price", fmt.money2(p?.list_price_tnd)], ["Unit cost", fmt.money2(p?.unit_cost_tnd)]]));
        section("Sales (all data)", kv([["Units", fmt.int(sum(lines, l => l.quantity))], ["Revenue", fmt.money(rev)], ["Margin", fmt.pct(rev ? (rev - cost) / rev : null)]]));
        section("Latest inventory by warehouse", list(latest, i => i.warehouse, i => `${i.quantity_on_hand} on hand · reorder ${i.reorder_point}${i.quantity_on_hand < i.reorder_point ? " · LOW" : ""} · ${ix.suppName(i.supplier_id)}`, i => c.select("supplier", i.supplier_id)));
    } else if (sel.type === "supplier") {
        const sp = ix.supp.get(sel.id); title = sp?.supplier_name ?? sel.id; ic = "Truck";
        const inv = d.inventory_snapshots.filter(i => i.supplier_id === sel.id); const prods = Array.from(new Set(inv.map(i => i.product_id)));
        section("Profile", kv([["Category", sp?.supplier_category], ["Country", sp?.country], ["Risk level", st(sp?.risk_level === "High" ? "At Risk" : sp?.risk_level)], ["Quality rating", sp?.quality_rating], ["Status", st(sp?.supplier_status)]]));
        section("Disruption exposure", kv([["Products supplied", prods.length], ["Revenue of those products", fmt.money(sum(d.sales_order_items.filter(l => prods.includes(l.product_id) && isRevenue(ix.order.get(l.order_id) ?? {})), l => l.net_line_amount_tnd))]]));
        section("Products", list(prods.map(id => ix.prod.get(id) as Row).filter(Boolean), r => r.product_name, r => r.category, r => c.select("product", r.product_id)));
    } else if (sel.type === "department") {
        const dep = ix.dept.get(sel.id); title = dep?.department_name ?? sel.id; ic = "Building";
        const k = kpis(ix, { p: c.ec.p, dept: sel.id });
        section("Department", kv([["Division", dep?.division], ["Location", dep?.primary_location], ["Mission", dep?.mission], ["Employees", d.employees.filter(e => e.department_id === sel.id).length]]));
        section(`KPIs · ${c.ec.p.label}`, kv([["Revenue (by sales owner)", fmt.money(k.netRevenue)], ["Expenses", fmt.money(k.expenses)], ["Open incidents", `${k.openIncidents} (${k.criticalIncidents} critical)`], ["Overdue tasks", k.overdueTasks], ["At-risk projects", k.atRiskProjects]]));
        section("Projects", list(d.projects.filter(p => p.department_id === sel.id), p => p.project_name, p => `${p.project_status} · ${fmt.pct(p.completion_percent, 0)}`, p => c.select("project", p.project_id)));
        section("Open incidents", list(d.incidents.filter(i => i.department_id === sel.id && OPEN_INCIDENT.has(i.incident_status)), i => `${i.incident_type} · ${i.incident_id}`, i => `${i.severity} · ${fmt.compact(i.estimated_impact_tnd)}`, i => c.select("incident", i.incident_id)));
    } else if (sel.type === "employee") {
        const e = ix.emp.get(sel.id); title = e?.employee_name ?? sel.id; ic = "User";
        section("Employee", kv([["Job", e?.job_title], ["Department", ix.deptName(e?.department_id)], ["Status", st(e?.employment_status)], ["Location", e?.location], ["Hired", fmt.date(e?.hire_date)]]));
        section("Open tasks", list(d.tasks.filter(t => t.assignee_employee_id === sel.id && t.task_status !== "Done"), t => t.task_title, t => `${t.task_status} · due ${fmt.date(t.due_date)}${isOverdueTask(t, ix.ref) ? " · OVERDUE" : ""}`, t => c.select("task", t.task_id)));
        section("Upcoming events", list(d.calendar_events.filter(ev => ev.owner_employee_id === sel.id && day(ev.start_datetime) >= ix.ref).sort((a, b) => a.start_datetime.localeCompare(b.start_datetime)), ev => ev.event_title, ev => `${fmt.date(ev.start_datetime)} ${fmt.time(ev.start_datetime)}`));
    } else if (sel.type === "project") {
        const p = ix.proj.get(sel.id); title = p?.project_name ?? sel.id; ic = "ChartGantt";
        const tk = d.tasks.filter(t => t.project_id === sel.id);
        section("Project", kv([["Theme", p?.strategic_theme], ["Department", ix.deptName(p?.department_id)], ["Owner", ix.empName(p?.project_owner_id)], ["Status", st(p?.project_status)], ["Start", fmt.date(p?.start_date)], ["Planned end", fmt.date(p?.planned_end_date)], ["Budget", fmt.money(p?.approved_budget_tnd)], ["Completion", fmt.pct(p?.completion_percent, 0)]]));
        section("Tasks", list(tk, t => t.task_title, t => `${t.task_status} · ${t.priority}${isOverdueTask(t, ix.ref) ? " · OVERDUE" : ""}`, t => c.select("task", t.task_id)));
        section("Linked events", list(d.calendar_events.filter(ev => ev.related_project_id === sel.id), ev => ev.event_title, ev => fmt.date(ev.start_datetime)));
    } else if (sel.type === "task") {
        const t = d.tasks.find(x => x.task_id === sel.id); title = t?.task_title ?? sel.id; ic = "SquareKanban";
        if (t) { section("Task", kv([["Status", st(t.task_status)], ["Priority", t.priority], ["Type", t.task_type], ["Assignee", ix.empName(t.assignee_employee_id)], ["Project", ix.projName(t.project_id)], ["Department", ix.deptName(t.department_id)], ["Created", fmt.date(t.created_date)], ["Due", fmt.date(t.due_date)]])); }
        section("Next steps", h("div", "mc-row-gap", btn("Open in Task Manager", { small: true, icon: "SquareKanban", onClick: () => { c.s.selection = null; c.go("tasks"); } })));
    } else if (sel.type === "alert" || sel.type === "incident" || sel.type === "risk") {
        const r = sel.type === "alert" ? d.alerts.find(x => x.alert_id === sel.id) : sel.type === "incident" ? d.incidents.find(x => x.incident_id === sel.id) : d.risk_register.find(x => x.risk_id === sel.id);
        title = `${sel.type === "alert" ? "Alert" : sel.type === "incident" ? "Incident" : "Risk"} ${sel.id}`; ic = sel.type === "alert" ? "Bell" : sel.type === "incident" ? "Siren" : "ShieldAlert";
        if (r) { section("Details", kv(Object.keys(r).filter(k => !k.endsWith("_id")).map(k => [k.replace(/_/g, " "), typeof r[k] === "number" ? (k.endsWith("_tnd") ? fmt.money(r[k]) : k.includes("score") ? fmt.pct(r[k], 0) : String(r[k])) : k.includes("date") ? fmt.date(r[k]) : r[k]] as [string, string]))); }
        section("Recommended next step", h("div", "mc-muted", sel.type === "incident" ? "Confirm the owner, check linked tasks, and update the status once mitigated." : sel.type === "alert" ? "Acknowledge, then open a task from the alert template in the Task Manager." : "Review mitigation status and exposure with the risk owner."),
            h("div", "mc-row-gap", btn("Create task from this", { small: true, icon: "Plus", onClick: () => { c.s.m.taskTemplate = { title: `Follow up ${title}`, priority: (r?.severity === "Critical" ? "Critical" : "High") }; c.s.selection = null; c.go("tasks"); } })));
    }
    drawer(host, title, body, close, { icon: ic, width: 420 });
}
