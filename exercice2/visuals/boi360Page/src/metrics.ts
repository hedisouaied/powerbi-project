"use strict";

/**
 * Data model and business rules of the BOI 360 visual. Pure functions: no DOM, no Power BI API,
 * so tools/test-metrics.ps1 can run them in Node against the model's JSON feeds and compare with DAX.
 * Rules (same as dax/measures.dax):
 *   Revenue  = every payment status except Cancelled. Collected = Paid. Receivables = Pending + Overdue.
 *   Expenses = Approved only. Pending = pipeline. Rejected excluded from totals.
 *   "Today"  = reference date (last sales date) for overdue tasks and past-deadline projects.
 */

export interface Department { id: string; n: string; dv: string; c: string }
export interface Employee { id: string; n: string; d: string; j: string; c: string; h: string; s: string; e: string; x: boolean }
export interface Customer { id: string; n: string; g: string; c: string }
export interface Product { id: string; n: string; c: string; l: number }
export interface Sale { id: string; d: string; c: string; p: string; s: string; q: number; u: number; dc: number; r: number; k: number; pf: number; st: string; rg: string }
export interface TargetRow { id: string; e: string; m: string; t: number; a: number }
export interface Project { id: string; n: string; pm: string; d: string; sd: string; dl: string; b: number; ac: number; st: string; pr: string }
export interface Task { id: string; t: string; p: string; a: string; cd: string; dd: string; st: string; pr: string; so: string }
export interface Expense { id: string; dt: string; d: string; p: string; c: string; st: string; a: number; ds: string }
export interface Leave { id: string; e: string; t: string; sd: string; ed: string; w: number; st: string; cm: string }

export interface Dataset {
    ref: string;
    departments: Department[];
    employees: Employee[];
    customers: Customer[];
    products: Product[];
    sales: Sale[];
    targets: TargetRow[];
    projects: Project[];
    tasks: Task[];
    expenses: Expense[];
    leave: Leave[];
}

export const EMPTY_DATASET: Dataset = {
    ref: "", departments: [], employees: [], customers: [], products: [], sales: [], targets: [], projects: [], tasks: [], expenses: [], leave: []
};

/** Filters of a page. Every value is "" (all) or one selected value. Months are "yyyy-mm". */
export type Filters = Record<string, string>;

export const sum = <T>(rows: T[], pick: (row: T) => number): number => rows.reduce((total, row) => total + (pick(row) || 0), 0);
export const divide = (a: number, b: number): number | null => (b ? a / b : null);
export const distinct = (values: string[]): string[] => Array.from(new Set(values.filter(v => v !== "" && v !== null && v !== undefined))).sort();
export const month = (isoDate: string): string => (isoDate || "").slice(0, 7);

/** Lookup helpers built once per dataset. */
export class Lookup {
    public readonly dept = new Map<string, Department>();
    public readonly emp = new Map<string, Employee>();
    public readonly cust = new Map<string, Customer>();
    public readonly prod = new Map<string, Product>();
    public readonly proj = new Map<string, Project>();

    constructor(public readonly data: Dataset) {
        data.departments.forEach(d => this.dept.set(d.id, d));
        data.employees.forEach(e => this.emp.set(e.id, e));
        data.customers.forEach(c => this.cust.set(c.id, c));
        data.products.forEach(p => this.prod.set(p.id, p));
        data.projects.forEach(p => this.proj.set(p.id, p));
    }

    public deptName(id: string): string { return this.dept.get(id)?.n ?? (id ? id : "No department"); }
    public empName(id: string): string { return this.emp.get(id)?.n ?? id; }
    public empDept(id: string): string { return this.deptName(this.emp.get(id)?.d ?? ""); }
    public projName(id: string): string { return id ? (this.proj.get(id)?.n ?? id) : "No project"; }
}

// ---------- filtering: what "department" and "period" mean for each table (same as the model) ----------

function inPeriod(f: Filters, isoDate: string): boolean {
    const m = month(isoDate);
    return (!f.from || m >= f.from) && (!f.to || m <= f.to);
}
const is = (selected: string | undefined, value: string): boolean => !selected || selected === value;

export function filterSales(data: Lookup, f: Filters): Sale[] {
    return data.data.sales.filter(s => {
        const customer = data.cust.get(s.c);
        const product = data.prod.get(s.p);
        return inPeriod(f, s.d)
            && is(f.dept, data.empDept(s.s)) && is(f.seller, data.empName(s.s))
            && is(f.category, product?.c ?? "") && is(f.product, product?.n ?? "")
            && is(f.payment, s.st) && is(f.region, s.rg)
            && is(f.segment, customer?.g ?? "") && is(f.ccity, customer?.c ?? "") && is(f.customer, customer?.n ?? "");
    });
}

/** Targets only know seller and month: product, payment, region and customer filters do not apply (as in the model). */
export function filterTargets(data: Lookup, f: Filters): TargetRow[] {
    return data.data.targets.filter(t => inPeriod(f, t.m) && is(f.dept, data.empDept(t.e)) && is(f.seller, data.empName(t.e)));
}

export function filterEmployees(data: Lookup, f: Filters): Employee[] {
    return data.data.employees.filter(e => is(f.dept, data.deptName(e.d)) && is(f.city, e.c) && is(f.estatus, e.s) && is(f.job, e.j));
}

export function filterLeave(data: Lookup, f: Filters): Leave[] {
    return data.data.leave.filter(l => {
        const e = data.emp.get(l.e);
        return inPeriod(f, l.sd) && is(f.dept, data.empDept(l.e)) && is(f.city, e?.c ?? "") && is(f.estatus, e?.s ?? "")
            && is(f.leaveType, l.t) && is(f.leaveStatus, l.st);
    });
}

/** Projects: department = owning department; no date filter (budget and cost are lifetime figures). */
export function filterProjects(data: Lookup, f: Filters): Project[] {
    return data.data.projects.filter(p => is(f.dept, data.deptName(p.d)) && is(f.pm, data.empName(p.pm))
        && is(f.pstatus, p.st) && is(f.ppriority, p.pr) && is(f.project, p.n));
}

/** Tasks: department = assignee's department; period = due date. */
export function filterTasks(data: Lookup, f: Filters): Task[] {
    return data.data.tasks.filter(t => inPeriod(f, t.dd) && is(f.dept, data.empDept(t.a)) && is(f.project, data.projName(t.p))
        && is(f.tpriority, t.pr) && is(f.tstatus, t.st) && is(f.assignee, data.empName(t.a)));
}

/** Expenses: department = spending department; period = expense date. */
export function filterExpenses(data: Lookup, f: Filters): Expense[] {
    return data.data.expenses.filter(x => inPeriod(f, x.dt) && is(f.dept, data.deptName(x.d)) && is(f.expCategory, x.c)
        && is(f.approval, x.st) && is(f.project, data.projName(x.p)));
}

// ---------- measures ----------

export const notCancelled = (s: Sale): boolean => s.st !== "Cancelled";

export interface SalesKpis {
    gross: number; revenue: number; collected: number; receivables: number; overdue: number; cancelled: number;
    cost: number; profit: number; margin: number | null; transactions: number; aov: number | null; units: number;
    discount: number | null; customers: number; revenuePerCustomer: number | null; cancellationRate: number | null; collectionRate: number | null;
}

export function salesKpis(rows: Sale[]): SalesKpis {
    const kept = rows.filter(notCancelled);
    const revenue = sum(kept, s => s.r);
    const profit = sum(kept, s => s.pf);
    const beforeDiscount = sum(kept, s => s.q * s.u);
    const gross = sum(rows, s => s.r);
    const cancelled = sum(rows.filter(s => s.st === "Cancelled"), s => s.r);
    const collected = sum(rows.filter(s => s.st === "Paid"), s => s.r);
    const customers = new Set(kept.map(s => s.c)).size;
    return {
        gross, revenue, collected,
        receivables: sum(rows.filter(s => s.st === "Pending" || s.st === "Overdue"), s => s.r),
        overdue: sum(rows.filter(s => s.st === "Overdue"), s => s.r),
        cancelled, cost: sum(kept, s => s.k), profit, margin: divide(profit, revenue),
        transactions: kept.length, aov: divide(revenue, kept.length), units: sum(kept, s => s.q),
        discount: beforeDiscount ? 1 - revenue / beforeDiscount : null,
        customers, revenuePerCustomer: divide(revenue, customers),
        cancellationRate: divide(cancelled, gross), collectionRate: divide(collected, revenue)
    };
}

export interface TargetKpis { target: number; actual: number; achievement: number | null; gap: number; below: number }

export function targetKpis(rows: TargetRow[]): TargetKpis {
    const target = sum(rows, t => t.t);
    const actual = sum(rows, t => t.a);
    const bySeller = new Map<string, { t: number; a: number }>();
    rows.forEach(r => { const v = bySeller.get(r.e) ?? { t: 0, a: 0 }; v.t += r.t; v.a += r.a; bySeller.set(r.e, v); });
    const below = Array.from(bySeller.values()).filter(v => v.t > 0 && v.a < v.t).length;
    return { target, actual, achievement: divide(actual, target), gap: actual - target, below };
}

export interface ExpenseKpis { approved: number; pending: number; rejected: number; submitted: number; approvalRate: number | null; claims: number; withoutProject: number; crossDepartment: number }

export function expenseKpis(rows: Expense[], data: Lookup): ExpenseKpis {
    const approvedRows = rows.filter(x => x.st === "Approved");
    const approved = sum(approvedRows, x => x.a);
    const rejected = sum(rows.filter(x => x.st === "Rejected"), x => x.a);
    return {
        approved, rejected,
        pending: sum(rows.filter(x => x.st === "Pending"), x => x.a),
        submitted: sum(rows, x => x.a),
        approvalRate: divide(approved, approved + rejected),
        claims: rows.length,
        withoutProject: sum(approvedRows.filter(x => !x.p), x => x.a),
        crossDepartment: sum(approvedRows.filter(x => x.p && data.proj.get(x.p) && data.proj.get(x.p)?.d !== x.d), x => x.a)
    };
}

export const isOverBudget = (p: Project): boolean => p.ac > p.b;
export const isPastDeadline = (p: Project, ref: string): boolean => p.st !== "Completed" && p.dl < ref;
export function projectRisk(p: Project, ref: string): string {
    const over = isOverBudget(p);
    const past = isPastDeadline(p, ref);
    return over && past ? "Over budget · Past deadline" : over ? "Over budget" : past ? "Past deadline" : "";
}

export interface ProjectKpis { projects: number; budget: number; cost: number; variance: number; utilization: number | null; overBudget: number; pastDeadline: number }

export function projectKpis(rows: Project[], ref: string): ProjectKpis {
    const budget = sum(rows, p => p.b);
    const cost = sum(rows, p => p.ac);
    return {
        projects: rows.length, budget, cost, variance: budget - cost, utilization: divide(cost, budget),
        overBudget: rows.filter(isOverBudget).length, pastDeadline: rows.filter(p => isPastDeadline(p, ref)).length
    };
}

export const isOpen = (t: Task): boolean => t.st !== "Done";
export const isOverdue = (t: Task, ref: string): boolean => isOpen(t) && t.dd < ref;
export function daysBetween(fromIso: string, toIso: string): number {
    return Math.round((Date.parse(toIso + "T00:00:00Z") - Date.parse(fromIso + "T00:00:00Z")) / 86400000);
}

export interface TaskKpis { tasks: number; open: number; done: number; blocked: number; overdue: number; completion: number | null; overdueRate: number | null; avgDaysOverdue: number | null }

export function taskKpis(rows: Task[], ref: string): TaskKpis {
    const overdue = rows.filter(t => isOverdue(t, ref));
    const open = rows.filter(isOpen).length;
    const done = rows.length - open;
    return {
        tasks: rows.length, open, done, blocked: rows.filter(t => t.st === "Blocked").length, overdue: overdue.length,
        completion: divide(done, rows.length), overdueRate: divide(overdue.length, open),
        avgDaysOverdue: overdue.length ? sum(overdue, t => daysBetween(t.dd, ref)) / overdue.length : null
    };
}

export interface PeopleKpis { employees: number; active: number; onLeave: number; sharedEmail: number }

export function peopleKpis(rows: Employee[]): PeopleKpis {
    return { employees: rows.length, active: rows.filter(e => e.s === "Active").length, onLeave: rows.filter(e => e.s === "On Leave").length, sharedEmail: rows.filter(e => e.x).length };
}

export interface LeaveKpis { requests: number; days: number; approvedDays: number; pendingDays: number; approvalRate: number | null }

export function leaveKpis(rows: Leave[]): LeaveKpis {
    const approved = rows.filter(l => l.st === "Approved").length;
    const rejected = rows.filter(l => l.st === "Rejected").length;
    return {
        requests: rows.length, days: sum(rows, l => l.w),
        approvedDays: sum(rows.filter(l => l.st === "Approved"), l => l.w),
        pendingDays: sum(rows.filter(l => l.st === "Submitted"), l => l.w),
        approvalRate: divide(approved, approved + rejected)
    };
}

// ---------- grouping ----------

export interface Group<T> { key: string; rows: T[] }

export function groupBy<T>(rows: T[], key: (row: T) => string): Array<Group<T>> {
    const map = new Map<string, T[]>();
    rows.forEach(r => { const k = key(r); const list = map.get(k); if (list) { list.push(r); } else { map.set(k, [r]); } });
    return Array.from(map.entries()).map(([k, list]) => ({ key: k, rows: list }));
}

/** Months between two "yyyy-mm" keys, inclusive. */
export function monthRange(from: string, to: string): string[] {
    const out: string[] = [];
    let [y, m] = from.split("-").map(Number);
    const [ty, tm] = to.split("-").map(Number);
    while (y < ty || (y === ty && m <= tm)) {
        out.push(`${y}-${String(m).padStart(2, "0")}`);
        m++;
        if (m > 12) { m = 1; y++; }
    }
    return out;
}

/** The months a page shows: the selected period, else the data coverage (first sale .. reference date). */
export function periodMonths(data: Lookup, f: Filters): string[] {
    const first = data.data.sales.reduce((min, s) => (s.d < min ? s.d : min), "9999-12-31");
    const from = f.from || month(first);
    const to = f.to || month(data.data.ref);
    return from <= to ? monthRange(from, to) : [];
}

export function runAll(data: Dataset): Record<string, number | null> {
    const lookup = new Lookup(data);
    const none: Filters = {};
    const s = salesKpis(filterSales(lookup, none));
    const t = targetKpis(filterTargets(lookup, none));
    const x = expenseKpis(filterExpenses(lookup, none), lookup);
    const p = projectKpis(filterProjects(lookup, none), data.ref);
    const k = taskKpis(filterTasks(lookup, none), data.ref);
    const e = peopleKpis(filterEmployees(lookup, none));
    const l = leaveKpis(filterLeave(lookup, none));
    return {
        "Revenue": s.revenue, "Gross Revenue": s.gross, "Collected Revenue": s.collected, "Receivables": s.receivables, "Overdue Revenue": s.overdue,
        "Cancelled Revenue": s.cancelled, "Cost": s.cost, "Profit": s.profit, "Profit Margin %": s.margin, "Transactions": s.transactions,
        "Average Order Value": s.aov, "Units Sold": s.units, "Average Discount %": s.discount, "Customers with Sales": s.customers,
        "Revenue per Customer": s.revenuePerCustomer, "Cancellation Rate %": s.cancellationRate, "Collection Rate %": s.collectionRate,
        "Target Amount": t.target, "Target Actual Sales": t.actual, "Target Achievement %": t.achievement, "Gap to Target": t.gap, "Sellers Below Target": t.below,
        "Approved Expenses": x.approved, "Pending Expenses": x.pending, "Rejected Expenses": x.rejected, "Submitted Expenses": x.submitted,
        "Expense Approval Rate %": x.approvalRate, "Expense Claims": x.claims, "Expenses Without Project": x.withoutProject, "Cross-Department Project Expenses": x.crossDepartment,
        "Project Budget": p.budget, "Project Actual Cost": p.cost, "Budget Variance": p.variance, "Budget Utilization %": p.utilization,
        "Projects": p.projects, "Projects Over Budget": p.overBudget, "Projects Past Deadline": p.pastDeadline,
        "Tasks": k.tasks, "Open Tasks": k.open, "Completed Tasks": k.done, "Blocked Tasks": k.blocked, "Overdue Tasks": k.overdue,
        "Task Completion Rate %": k.completion, "Overdue Rate %": k.overdueRate, "Average Days Overdue": k.avgDaysOverdue,
        "Employees": e.employees, "Active Employees": e.active, "Employees On Leave": e.onLeave, "Employees with Shared Email": e.sharedEmail,
        "Leave Requests": l.requests, "Leave Days": l.days, "Approved Leave Days": l.approvedDays, "Pending Leave Days": l.pendingDays, "Leave Approval Rate %": l.approvalRate
    };
}
