"use strict";

/**
 * Data layer: decodes the columnar JSON feeds ({c: columns, r: rows}) produced by the "Feed <table>" DAX measures
 * into plain row objects, applies session/persisted workspace patches, and builds lookup indexes.
 * Pure TypeScript (no DOM, no Power BI API) so tools/test-engine.ps1 can run it in Node.
 */

export type Row = Record<string, any>;

export const TABLES = [
    "activity_log", "alerts", "approval_requests", "calendar_events", "collaboration_comments", "customer_interactions", "customers",
    "data_quality_issues", "data_sources", "decisions", "departments", "employees", "entity_relationships", "expenses", "incidents",
    "inventory_snapshots", "investigation_cases", "investigation_evidence", "kpi_targets", "missions", "notifications", "payments",
    "products", "projects", "risk_register", "sales_order_items", "sales_orders", "scenarios", "strategic_goals", "suppliers", "tasks"
] as const;
export type TableName = typeof TABLES[number];
export type Dataset = Record<TableName, Row[]>;

export function emptyDataset(): Dataset {
    const d = {} as Dataset;
    TABLES.forEach(t => { d[t] = []; });
    return d;
}

/** {c:[...], r:[[...]]} -> row objects. Bad or missing feeds give an empty table (the UI then shows empty states). */
export function decode(text: string | { c: string[]; r: unknown[][] } | undefined | null): Row[] {
    if (!text) { return []; }
    if (typeof text === "object") { return Array.isArray(text.c) && Array.isArray(text.r) ? text.r.map(r => { const o: Row = {}; text.c.forEach((c, i) => { o[c] = r[i] ?? null; }); return o; }) : []; }
    try {
        let f: { c: string[]; r: unknown[][] };
        // Fallback for numbers written as "5." (DAX FORMAT "0.####" on whole numbers): strict JSON rejects the trailing dot.
        try { f = JSON.parse(text); } catch { f = JSON.parse(text.replace(/(d).(?=[,]])/g, "$1")); }
        if (!f || !Array.isArray(f.c) || !Array.isArray(f.r)) { return []; }
        return f.r.map(r => { const o: Row = {}; f.c.forEach((c, i) => { o[c] = r[i] ?? null; }); return o; });
    } catch { return []; }
}

/** Primary key of each table (first column of the feed). */
export const KEYS: Record<TableName, string> = {
    activity_log: "activity_id", alerts: "alert_id", approval_requests: "approval_id", calendar_events: "event_id",
    collaboration_comments: "comment_id", customer_interactions: "interaction_id", customers: "customer_id", data_quality_issues: "issue_id",
    data_sources: "source_id", decisions: "decision_id", departments: "department_id", employees: "employee_id", entity_relationships: "relationship_id",
    expenses: "expense_id", incidents: "incident_id", inventory_snapshots: "product_id", investigation_cases: "case_id", investigation_evidence: "evidence_id",
    kpi_targets: "department_id", missions: "mission_id", notifications: "notification_id", payments: "payment_id", products: "product_id",
    projects: "project_id", risk_register: "risk_id", sales_order_items: "order_id", sales_orders: "order_id", scenarios: "scenario_id",
    strategic_goals: "goal_id", suppliers: "supplier_id", tasks: "task_id"
};

/** Workspace patches: user edits kept on top of the model rows (session, or persisted in the report if the user opts in). */
export interface TablePatch { added: Row[]; changed: Record<string, Row>; removed: string[] }
export type Workspace = Partial<Record<TableName, TablePatch>>;

export function applyWorkspace(base: Dataset, ws: Workspace): Dataset {
    const out = { ...base } as Dataset;
    (Object.keys(ws) as TableName[]).forEach(t => {
        const p = ws[t];
        if (!p || !base[t]) { return; }
        const key = KEYS[t];
        const removed = new Set(p.removed ?? []);
        out[t] = base[t].filter(r => !removed.has(String(r[key])))
            .map(r => (p.changed?.[String(r[key])] ? { ...r, ...p.changed[String(r[key])] } : r))
            .concat((p.added ?? []).filter(r => !removed.has(String(r[key]))).map(r => (p.changed?.[String(r[key])] ? { ...r, ...p.changed[String(r[key])] } : r)));
    });
    return out;
}

/** Lookup indexes built once per dataset. */
export class Index {
    public readonly dept = new Map<string, Row>();
    public readonly emp = new Map<string, Row>();
    public readonly cust = new Map<string, Row>();
    public readonly prod = new Map<string, Row>();
    public readonly supp = new Map<string, Row>();
    public readonly proj = new Map<string, Row>();
    public readonly order = new Map<string, Row>();
    public readonly linesByOrder = new Map<string, Row[]>();
    public readonly payByOrder = new Map<string, Row>();
    public readonly ref: string;
    public readonly first: string;

    constructor(public readonly d: Dataset) {
        d.departments.forEach(r => this.dept.set(r.department_id, r));
        d.employees.forEach(r => this.emp.set(r.employee_id, r));
        d.customers.forEach(r => this.cust.set(r.customer_id, r));
        d.products.forEach(r => this.prod.set(r.product_id, r));
        d.suppliers.forEach(r => this.supp.set(r.supplier_id, r));
        d.projects.forEach(r => this.proj.set(r.project_id, r));
        d.sales_orders.forEach(r => this.order.set(r.order_id, r));
        d.sales_order_items.forEach(r => { const l = this.linesByOrder.get(r.order_id); if (l) { l.push(r); } else { this.linesByOrder.set(r.order_id, [r]); } });
        d.payments.forEach(r => this.payByOrder.set(r.order_id, r));
        let max = "", min = "9999";
        d.sales_orders.forEach(r => { if (r.order_date > max) { max = r.order_date; } if (r.order_date < min) { min = r.order_date; } });
        this.ref = max || new Date().toISOString().slice(0, 10);
        this.first = min === "9999" ? this.ref : min;
    }

    public deptName(id: string | null | undefined): string { return (id && this.dept.get(id)?.department_name) || "—"; }
    public empName(id: string | null | undefined): string { return (id && this.emp.get(id)?.employee_name) || "—"; }
    public empDept(id: string | null | undefined): string { return (id && this.emp.get(id)?.department_id) || ""; }
    public custName(id: string | null | undefined): string { return (id && this.cust.get(id)?.customer_name) || "—"; }
    public prodName(id: string | null | undefined): string { return (id && this.prod.get(id)?.product_name) || "—"; }
    public suppName(id: string | null | undefined): string { return (id && this.supp.get(id)?.supplier_name) || "—"; }
    public projName(id: string | null | undefined): string { return (id && this.proj.get(id)?.project_name) || "—"; }

    /** Human label of any entity id used in the relationship graph. */
    public entityLabel(type: string, id: string): string {
        switch (type) {
            case "Client": return this.custName(id);
            case "Produit": return this.prodName(id);
            case "Fournisseur": return this.suppName(id);
            case "Employé": return this.empName(id);
            case "Département": return this.deptName(id);
            case "Projet": return this.projName(id);
            default: return id;
        }
    }
}
