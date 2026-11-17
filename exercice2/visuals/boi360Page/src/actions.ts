"use strict";

/**
 * Management Action Center: create / edit / delete for tasks, projects and employees.
 * Every change is recorded as an operation and saved INSIDE THE REPORT (the visual's own persisted
 * property "crud.changes", written with persistProperties): after File › Save, the .pbix keeps it and the
 * changes come back on reopen, and they are re-applied on top of the model data after every refresh.
 * Limits (custom visuals receive the model read-only, they are not database clients):
 *  - the CSV files and the Power BI data model are NOT changed, so other pages and DAX measures don't include the edits;
 *  - in the Power BI Service, a viewer's edits are not saved (only an author editing the report saves them).
 * To change the source data for every page: edit exercice2\data\*.csv (keep the IDs), then Home › Refresh.
 */

import { icon, IconName, NEON } from "../../shared/neon";
import { daysBetween, Dataset, Employee, isOverdue, Lookup, Project, projectRisk, Task } from "./metrics";

type Entity = "tasks" | "projects" | "employees";
type Row = Task | Project | Employee;

interface Field {
    key: string;
    label: string;
    type: "text" | "email" | "date" | "number" | "select";
    options?: () => Array<{ value: string; label: string }>;
    required?: boolean;
    min?: number;
    max?: number;
}

/** One saved operation. The list of operations is what the report stores. */
interface LogEntry { action: "Created" | "Updated" | "Deleted"; entity: Entity; id: string; row?: Row; time: string }

const TASK_STATUS = ["To Do", "In Progress", "Blocked", "Done"];
const PRIORITY = ["Critical", "High", "Medium", "Low"];
const SOURCES = ["Dashboard", "Email", "Meeting", "Management"];
const PROJECT_STATUS = ["Planned", "In Progress", "On Hold", "Completed"];
const PROJECT_PRIORITY = ["High", "Medium", "Low"];
const EMP_STATUS = ["Active", "On Leave"];
const PAGE_SIZE = 16;

export class ActionCenter {
    private data: Dataset;
    private lookup: Lookup;
    private tasks: Task[] = [];
    private projects: Project[] = [];
    private employees: Employee[] = [];
    private entity: Entity = "tasks";
    private selected = "";
    private search = "";
    private sort = { key: "id", desc: false };
    private pageIndex = 0;
    private log: LogEntry[] = [];
    private modal: { mode: "create" | "edit" | "delete"; values: Record<string, string>; errors: Record<string, string> } | null = null;
    private toast: { text: string; tone: "ok" | "bad" } | null = null;
    private toastTimer = 0;

    private saved = "";

    constructor(private readonly rerender: () => void, private readonly persist: (json: string) => void) { }

    /** Saved operations read from the report (crud.changes). Re-applied on top of the model data. */
    public restore(json: string): void {
        if (json === this.saved) { return; }
        this.saved = json;
        try { const ops = json ? JSON.parse(json) : []; this.log = Array.isArray(ops) ? ops : []; } catch { this.log = []; }
        if (this.data) { this.rebuild(); }
    }

    /** Model rows + every saved operation, in order. */
    private rebuild(): void {
        this.tasks = this.data.tasks.map(t => ({ ...t }));
        this.projects = this.data.projects.map(p => ({ ...p }));
        this.employees = this.data.employees.map(e => ({ ...e }));
        this.log.forEach(op => {
            const list = this.rows(op.entity) as Array<{ id: string }>;
            const i = list.findIndex(r => r.id === op.id);
            if (op.action === "Deleted") { if (i >= 0) { list.splice(i, 1); } }
            else if (op.row) { if (i >= 0) { list[i] = { ...op.row }; } else { list.push({ ...op.row }); } }
        });
    }

    /** Writes the operation list into the report; Power BI keeps it in the .pbix when the file is saved. */
    private commit(): void {
        this.saved = JSON.stringify(this.log);
        this.persist(this.saved);
    }

    /** Called when the model data changes (open, refresh): saved changes are re-applied on top of the new data. */
    public load(data: Dataset, lookup: Lookup): void {
        this.data = data;
        this.lookup = lookup;
        this.rebuild();
        this.selected = "";
        this.modal = null;
    }

    public render(page: HTMLElement): void {
        const banner = this.el("div", "ac-banner", page);
        banner.appendChild(icon("TriangleAlert", 18));
        const text = this.el("div", "", banner);
        this.el("strong", "", text, "Changes are saved in this report (.pbix) — not in the CSV source or the data model.");
        this.el("span", "", text, "  Save the file (Ctrl+S) to keep them; they come back on reopen and survive a refresh. Other pages and measures read the model, so they don't include these edits. To change the source for every page: edit exercice2\\data\\*.csv, then Refresh.");

        const layout = this.el("div", "ac-layout", page);
        const main = this.el("div", "bx-card ac-main", layout);
        const side = this.el("div", "ac-side", layout);
        this.renderMain(main);
        this.renderQueue(side);
        this.renderLog(side);
        if (this.modal) { this.renderModal(page); }
        if (this.toast) { const t = this.el("div", `ac-toast ac-toast-${this.toast.tone}`, page); t.appendChild(icon(this.toast.tone === "ok" ? "Check" : "TriangleAlert", 14)); t.appendChild(document.createTextNode(" " + this.toast.text)); }
    }

    // ---------- table ----------

    private renderMain(card: HTMLElement): void {
        const head = this.el("div", "ac-head", card);
        const tabs = this.el("div", "ac-tabs", head);
        ([["tasks", "Tasks", "ClipboardList"], ["projects", "Projects", "FolderKanban"], ["employees", "Employees", "Users"]] as Array<[Entity, string, IconName]>).forEach(([key, label, ic]) => {
            const b = this.el("button", `ac-tab ${this.entity === key ? "ac-tab-on" : ""}`, tabs);
            b.appendChild(icon(ic, 13));
            b.appendChild(document.createTextNode(` ${label} (${this.rows(key).length})`));
            b.onclick = () => { this.entity = key; this.selected = ""; this.search = ""; this.pageIndex = 0; this.sort = { key: "id", desc: false }; this.rerender(); };
        });
        const tools = this.el("div", "ac-tools", head);
        const box = this.el("label", "bx-search", tools);
        box.appendChild(icon("Search", 12));
        const input = this.el("input", "", box) as HTMLInputElement;
        input.placeholder = "Search";
        input.value = this.search;
        input.setAttribute("data-search", "crud");
        input.oninput = () => {
            this.search = input.value; this.pageIndex = 0; const pos = input.selectionStart; this.rerender();
            const again = document.querySelector("[data-search=\"crud\"]") as HTMLInputElement | null;
            if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        };
        this.button(tools, "Plus", "New", "ac-btn-new", () => this.openCreate());
        this.button(tools, "Pencil", "Edit", "", () => this.openEdit(), !this.selected);
        this.button(tools, "Trash", "Delete", "ac-btn-del", () => { this.modal = { mode: "delete", values: {}, errors: {} }; this.rerender(); }, !this.selected);

        const columns = this.columns();
        let rows = this.rows(this.entity);
        if (this.search) {
            const q = this.search.toLowerCase();
            rows = rows.filter(r => columns.some(c => c.text(r).toLowerCase().includes(q)));
        }
        const col = columns.find(c => c.key === this.sort.key) ?? columns[0];
        rows = [...rows].sort((a, b) => { const cmp = col.sortValue(a) < col.sortValue(b) ? -1 : col.sortValue(a) > col.sortValue(b) ? 1 : 0; return this.sort.desc ? -cmp : cmp; });
        const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
        this.pageIndex = Math.min(this.pageIndex, pages - 1);
        const shown = rows.slice(this.pageIndex * PAGE_SIZE, (this.pageIndex + 1) * PAGE_SIZE);

        const scroll = this.el("div", "ac-table-wrap", card);
        const table = this.el("table", "bx-table ac-table", scroll);
        const hr = this.el("tr", "", this.el("thead", "", table));
        columns.forEach(c => {
            const th = this.el("th", c.right ? "bx-right" : "", hr, c.label + (this.sort.key === c.key ? (this.sort.desc ? " ▼" : " ▲") : ""));
            th.onclick = () => { this.sort = { key: c.key, desc: this.sort.key === c.key ? !this.sort.desc : false }; this.rerender(); };
        });
        const tb = this.el("tbody", "", table);
        shown.forEach(r => {
            const id = (r as { id: string }).id;
            const tr = this.el("tr", `bx-click ${this.selected === id ? "bx-active" : ""}`, tb);
            tr.onclick = () => { this.selected = this.selected === id ? "" : id; this.rerender(); };
            tr.ondblclick = () => { this.selected = id; this.openEdit(); };
            columns.forEach(c => { const td = this.el("td", c.right ? "bx-right" : "", tr, c.text(r)); const color = c.color?.(r); if (color) { td.style.color = color; td.classList.add("bx-strong"); } });
        });
        if (!shown.length) { this.el("td", "bx-muted", this.el("tr", "", tb), "No rows.").setAttribute("colspan", String(columns.length)); }

        const foot = this.el("div", "ac-foot", card);
        this.el("span", "bx-muted", foot, `${rows.length} rows · ${this.selected ? `selected ${this.selected} (double-click a row to edit)` : "click a row to select it"}`);
        const pager = this.el("div", "ac-pager", foot);
        this.button(pager, "ChevronLeft", "Prev", "", () => { this.pageIndex--; this.rerender(); }, this.pageIndex === 0);
        this.el("span", "", pager, `Page ${this.pageIndex + 1} / ${pages}`);
        this.button(pager, "ChevronRight", "Next", "", () => { this.pageIndex++; this.rerender(); }, this.pageIndex >= pages - 1);
    }

    private rows(entity: Entity): Row[] { return entity === "tasks" ? this.tasks : entity === "projects" ? this.projects : this.employees; }

    private columns(): Array<{ key: string; label: string; text: (r: Row) => string; sortValue: (r: Row) => string | number; right?: boolean; color?: (r: Row) => string | undefined }> {
        const L = this.lookup, ref = this.data.ref;
        const c = <T extends Row>(key: string, label: string, text: (r: T) => string, extra: { num?: (r: T) => number; right?: boolean; color?: (r: T) => string | undefined } = {}) =>
            ({ key, label, text: text as (r: Row) => string, sortValue: (extra.num ?? text) as (r: Row) => string | number, right: extra.right, color: extra.color as ((r: Row) => string | undefined) | undefined });
        if (this.entity === "tasks") {
            return [
                c<Task>("id", "ID", t => t.id), c<Task>("t", "Title", t => t.t), c<Task>("p", "Project", t => L.projName(t.p) || this.projectName(t.p)),
                c<Task>("a", "Assignee", t => this.employeeName(t.a)), c<Task>("pr", "Priority", t => t.pr, { color: t => (t.pr === "Critical" ? NEON.pink : undefined) }),
                c<Task>("st", "Status", t => t.st), c<Task>("dd", "Due", t => t.dd, { color: t => (isOverdue(t, ref) ? NEON.pink : undefined) })
            ];
        }
        if (this.entity === "projects") {
            return [
                c<Project>("id", "ID", p => p.id), c<Project>("n", "Project", p => p.n), c<Project>("pm", "Manager", p => this.employeeName(p.pm)),
                c<Project>("st", "Status", p => p.st), c<Project>("dl", "Deadline", p => p.dl),
                c<Project>("b", "Budget", p => this.money(p.b), { num: p => p.b, right: true }), c<Project>("ac", "Actual", p => this.money(p.ac), { num: p => p.ac, right: true, color: p => (p.ac > p.b ? NEON.pink : undefined) }),
                c<Project>("risk", "Risk", p => projectRisk(p, ref) || "On track", { color: p => (projectRisk(p, ref) ? NEON.amber : NEON.green) })
            ];
        }
        return [
            c<Employee>("id", "ID", e => e.id), c<Employee>("n", "Name", e => e.n), c<Employee>("d", "Department", e => L.deptName(e.d)),
            c<Employee>("j", "Job title", e => e.j), c<Employee>("c", "City", e => e.c), c<Employee>("s", "Status", e => e.s), c<Employee>("e", "Email", e => e.e)
        ];
    }

    // ---------- side panels ----------

    private renderQueue(side: HTMLElement): void {
        const card = this.el("div", "bx-card ac-queue", side);
        const head = this.el("div", "bx-card-title", card);
        head.appendChild(icon("ListChecks", 14));
        head.appendChild(document.createTextNode(" Action queue (follows your saved edits)"));
        const ref = this.data.ref;
        const overdue = this.tasks.filter(t => isOverdue(t, ref));
        const risky = this.projects.filter(p => projectRisk(p, ref));
        const pendingExp = this.data.expenses.filter(x => x.st === "Pending");
        const submittedLeave = this.data.leave.filter(l => l.st === "Submitted");
        const item = (ic: IconName, label: string, value: string, note: string, tone: string, go?: () => void): void => {
            const row = this.el("div", `ac-q ${tone} ${go ? "bx-click" : ""}`, card);
            const i = this.el("span", "ac-q-icon", row); i.appendChild(icon(ic, 14));
            const t = this.el("div", "ac-q-text", row); this.el("div", "", t, label); this.el("div", "bx-muted", t, note);
            this.el("div", "ac-q-value", row, value);
            if (go) { row.onclick = go; }
        };
        const oldest = overdue.reduce((m, t) => Math.max(m, daysBetween(t.dd, ref)), 0);
        item("AlarmClock", "Follow up overdue tasks", String(overdue.length), `Oldest ${oldest} days late`, "bx-bad", () => { this.entity = "tasks"; this.search = ""; this.sort = { key: "dd", desc: false }; this.rerender(); });
        item("ShieldAlert", "Escalate projects at risk", String(risky.length), "Over budget or past deadline", "bx-warn", () => { this.entity = "projects"; this.search = ""; this.sort = { key: "risk", desc: true }; this.rerender(); });
        item("Receipt", "Decide pending expenses", String(pendingExp.length), `${this.money(pendingExp.reduce((s, x) => s + x.a, 0))} TND waiting`, "bx-blue");
        item("Plane", "Decide leave requests", String(submittedLeave.length), `${submittedLeave.reduce((s, l) => s + l.w, 0)} days submitted`, "bx-violet");
    }

    private renderLog(side: HTMLElement): void {
        const card = this.el("div", "bx-card ac-log", side);
        const head = this.el("div", "ac-log-head", card);
        const t = this.el("div", "bx-card-title", head);
        t.appendChild(icon("ScrollText", 14));
        t.appendChild(document.createTextNode(` Saved changes (${this.log.length})`));
        if (this.log.length) { this.button(head, "RotateCcw", "Undo all", "", () => { this.log = []; this.commit(); this.rebuild(); this.selected = ""; this.notify("All changes removed — save the file to keep it that way", "ok"); }); }
        const list = this.el("div", "ac-log-list", card);
        if (!this.log.length) { this.el("div", "bx-muted", list, "No changes yet. Create, edit or delete a row: each change is saved in this report and listed here. Save the file (Ctrl+S) to keep it in the .pbix."); }
        const names: Record<Entity, string> = { tasks: "Task", projects: "Project", employees: "Employee" };
        this.log.slice().reverse().forEach(e => {
            const row = this.el("div", "ac-log-row", list);
            this.el("span", `ac-log-tag ac-${e.action.toLowerCase()}`, row, e.action);
            const rowName = e.row ? ((e.row as { t?: string; n?: string }).t ?? (e.row as { n?: string }).n ?? "") : "";
            this.el("span", "", row, `${names[e.entity] ?? e.entity} ${e.id}${rowName ? " · " + rowName : ""}`);
            this.el("span", "bx-muted", row, `${e.time} · saved in report`);
        });
    }

    // ---------- forms ----------

    private fields(): Field[] {
        const emps = (): Array<{ value: string; label: string }> => this.employees.map(e => ({ value: e.id, label: `${e.n} (${e.id})` }));
        const list = (values: string[]) => (): Array<{ value: string; label: string }> => values.map(v => ({ value: v, label: v }));
        if (this.entity === "tasks") {
            return [
                { key: "t", label: "Title", type: "text", required: true },
                { key: "p", label: "Project", type: "select", required: true, options: () => this.projects.map(p => ({ value: p.id, label: `${p.n} (${p.id})` })) },
                { key: "a", label: "Assignee", type: "select", required: true, options: emps },
                { key: "cd", label: "Created", type: "date", required: true },
                { key: "dd", label: "Due date", type: "date", required: true },
                { key: "st", label: "Status", type: "select", required: true, options: list(TASK_STATUS) },
                { key: "pr", label: "Priority", type: "select", required: true, options: list(PRIORITY) },
                { key: "so", label: "Source", type: "select", required: true, options: list(SOURCES) }
            ];
        }
        if (this.entity === "projects") {
            return [
                { key: "n", label: "Project name", type: "text", required: true },
                { key: "pm", label: "Project manager", type: "select", required: true, options: emps },
                { key: "d", label: "Owning department", type: "select", required: true, options: () => this.data.departments.map(d => ({ value: d.id, label: d.n })) },
                { key: "sd", label: "Start date", type: "date", required: true },
                { key: "dl", label: "Deadline", type: "date", required: true },
                { key: "b", label: "Budget (TND)", type: "number", required: true, min: 1000, max: 5000000 },
                { key: "ac", label: "Actual cost (TND)", type: "number", required: true, min: 0, max: 5000000 },
                { key: "st", label: "Status", type: "select", required: true, options: list(PROJECT_STATUS) },
                { key: "pr", label: "Priority", type: "select", required: true, options: list(PROJECT_PRIORITY) }
            ];
        }
        return [
            { key: "first", label: "First name", type: "text", required: true },
            { key: "last", label: "Last name", type: "text", required: true },
            { key: "e", label: "Email", type: "email", required: true },
            { key: "d", label: "Department", type: "select", required: true, options: () => this.data.departments.map(d => ({ value: d.id, label: d.n })) },
            { key: "j", label: "Job title", type: "text", required: true },
            { key: "c", label: "City", type: "text", required: true },
            { key: "h", label: "Hire date", type: "date", required: true },
            { key: "s", label: "Employment status", type: "select", required: true, options: list(EMP_STATUS) }
        ];
    }

    private openCreate(): void {
        const today = this.data.ref;
        const defaults: Record<Entity, Record<string, string>> = {
            tasks: { cd: today, dd: today, st: "To Do", pr: "Medium", so: "Management" },
            projects: { sd: today, dl: today, st: "Planned", pr: "Medium", ac: "0" },
            employees: { h: today, s: "Active" }
        };
        this.modal = { mode: "create", values: { ...defaults[this.entity] }, errors: {} };
        this.rerender();
    }

    private openEdit(): void {
        const row = this.rows(this.entity).find(r => (r as { id: string }).id === this.selected);
        if (!row) { return; }
        const values: Record<string, string> = {};
        Object.entries(row).forEach(([k, v]) => { values[k] = String(v ?? ""); });
        if (this.entity === "employees") { const [first, ...rest] = (row as Employee).n.split(" "); values.first = first; values.last = rest.join(" "); }
        this.modal = { mode: "edit", values, errors: {} };
        this.rerender();
    }

    private validate(values: Record<string, string>): Record<string, string> {
        const errors: Record<string, string> = {};
        const fields = this.fields();
        fields.forEach(f => {
            const v = (values[f.key] ?? "").trim();
            if (f.required && !v) { errors[f.key] = "Required"; return; }
            if (f.type === "text" && v.length > 80) { errors[f.key] = "80 characters maximum"; }
            if (f.type === "email" && v && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { errors[f.key] = "Not a valid email address"; }
            if (f.type === "number" && v) {
                const n = Number(v);
                if (!isFinite(n)) { errors[f.key] = "Must be a number"; }
                else if (f.min !== undefined && n < f.min) { errors[f.key] = `Minimum ${f.min.toLocaleString("en-US")}`; }
                else if (f.max !== undefined && n > f.max) { errors[f.key] = `Maximum ${f.max.toLocaleString("en-US")}`; }
            }
            if (f.type === "date" && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) { errors[f.key] = "Use the date picker"; }
            if (f.type === "select" && v && f.options && !f.options().some(o => o.value === v)) { errors[f.key] = "Not a valid choice"; }
        });
        if (this.entity === "tasks" && values.cd && values.dd && values.dd < values.cd) { errors.dd = "Due date is before the created date"; }
        if (this.entity === "projects" && values.sd && values.dl && values.dl < values.sd) { errors.dl = "Deadline is before the start date"; }
        if (this.entity === "employees") {
            if (values.h && values.h > this.data.ref) { errors.h = "Hire date is after the data date"; }
            const email = (values.e ?? "").trim().toLowerCase();
            const clash = this.employees.find(e => e.e.toLowerCase() === email && e.id !== values.id);
            if (email && clash && !errors.e) { errors.e = `Already used by ${clash.n} (${clash.id})`; }
        }
        return errors;
    }

    private save(): void {
        if (!this.modal) { return; }
        const v = this.modal.values;
        const errors = this.validate(v);
        if (Object.keys(errors).length) { this.modal.errors = errors; this.notify(`${Object.keys(errors).length} field(s) need attention`, "bad"); return; }
        const creating = this.modal.mode === "create";
        const label = this.entity === "tasks" ? "Task" : this.entity === "projects" ? "Project" : "Employee";
        let id = v.id;
        if (creating) { id = this.nextId(); }
        if (this.entity === "tasks") {
            const row: Task = { id, t: v.t.trim(), p: v.p, a: v.a, cd: v.cd, dd: v.dd, st: v.st, pr: v.pr, so: v.so };
            this.upsert(this.tasks, row, creating);
        } else if (this.entity === "projects") {
            const row: Project = { id, n: v.n.trim(), pm: v.pm, d: v.d, sd: v.sd, dl: v.dl, b: Number(v.b), ac: Number(v.ac), st: v.st, pr: v.pr };
            this.upsert(this.projects, row, creating);
        } else {
            const old = this.employees.find(e => e.id === id);
            const row: Employee = { id, n: `${v.first.trim()} ${v.last.trim()}`, d: v.d, j: v.j.trim(), c: v.c.trim(), h: v.h, s: v.s, e: v.e.trim(), x: old?.x ?? false };
            this.upsert(this.employees, row, creating);
        }
        const saved = this.rows(this.entity).find(r => (r as { id: string }).id === id);
        this.addLog(creating ? "Created" : "Updated", id, saved);
        this.selected = id;
        this.modal = null;
        this.notify(`${label} ${id} ${creating ? "created" : "updated"} — saved in this report (save the file to keep it)`, "ok");
    }

    private remove(): void {
        const label = this.entity === "tasks" ? "Task" : this.entity === "projects" ? "Project" : "Employee";
        const id = this.selected;
        if (this.entity === "projects" && this.tasks.some(t => t.p === id)) {
            this.modal = null;
            this.notify(`Project ${id} still has ${this.tasks.filter(t => t.p === id).length} tasks: delete or move them first`, "bad");
            return;
        }
        if (this.entity === "employees" && (this.tasks.some(t => t.a === id) || this.projects.some(p => p.pm === id))) {
            this.modal = null;
            this.notify(`Employee ${id} is still assigned to tasks or projects`, "bad");
            return;
        }
        if (this.entity === "tasks") { this.tasks = this.tasks.filter(t => t.id !== id); }
        if (this.entity === "projects") { this.projects = this.projects.filter(p => p.id !== id); }
        if (this.entity === "employees") { this.employees = this.employees.filter(e => e.id !== id); }
        this.addLog("Deleted", id);
        this.selected = "";
        this.modal = null;
        this.notify(`${label} ${id} deleted — saved in this report (save the file to keep it)`, "ok");
    }

    private renderModal(page: HTMLElement): void {
        const m = this.modal;
        if (!m) { return; }
        const veil = this.el("div", "bx-veil", page);
        veil.onclick = () => { this.modal = null; this.rerender(); };
        const box = this.el("div", "ac-modal", page);
        const label = this.entity === "tasks" ? "task" : this.entity === "projects" ? "project" : "employee";
        if (m.mode === "delete") {
            const t = this.el("div", "ac-modal-title", box); t.appendChild(icon("Trash", 18)); t.appendChild(document.createTextNode(` Delete ${label} ${this.selected}?`));
            this.el("p", "bx-muted", box, "The deletion is saved in this report (save the file to keep it). The CSV file and the Power BI model are not changed; use Undo all to bring the row back.");
            const actions = this.el("div", "ac-modal-actions", box);
            this.button(actions, "X", "Cancel", "", () => { this.modal = null; this.rerender(); });
            this.button(actions, "Trash", "Delete", "ac-btn-del", () => this.remove());
            return;
        }
        const t = this.el("div", "ac-modal-title", box);
        t.appendChild(icon(m.mode === "create" ? "Plus" : "Pencil", 18));
        t.appendChild(document.createTextNode(m.mode === "create" ? ` New ${label}` : ` Edit ${label} ${m.values.id}`));
        this.el("div", "ac-modal-note", box, "Validated and saved in this report (.pbix) — not in the CSV source or the data model.");
        const form = this.el("div", "ac-form", box);
        this.fields().forEach(f => {
            const cell = this.el("label", `ac-field ${m.errors[f.key] ? "ac-field-bad" : ""}`, form);
            this.el("span", "ac-field-label", cell, f.label + (f.required ? " *" : ""));
            let input: HTMLInputElement | HTMLSelectElement;
            if (f.type === "select") {
                input = this.el("select", "bx-select", cell) as HTMLSelectElement;
                const empty = this.el("option", "", input, "Choose…") as HTMLOptionElement; empty.value = "";
                (f.options?.() ?? []).forEach(o => { const opt = this.el("option", "", input, o.label) as HTMLOptionElement; opt.value = o.value; });
            } else {
                input = this.el("input", "ac-input", cell) as HTMLInputElement;
                input.type = f.type === "email" ? "email" : f.type;
                if (f.min !== undefined) { input.min = String(f.min); }
                if (f.max !== undefined) { input.max = String(f.max); }
            }
            input.value = m.values[f.key] ?? "";
            input.oninput = input.onchange = () => { m.values[f.key] = input.value; if (m.errors[f.key]) { delete m.errors[f.key]; cell.classList.remove("ac-field-bad"); const e = cell.querySelector(".ac-error"); if (e) { e.remove(); } } };
            if (m.errors[f.key]) { this.el("span", "ac-error", cell, m.errors[f.key]); }
        });
        const actions = this.el("div", "ac-modal-actions", box);
        this.button(actions, "X", "Cancel", "", () => { this.modal = null; this.rerender(); });
        this.button(actions, "Save", m.mode === "create" ? "Create" : "Save changes", "ac-btn-new", () => this.save());
    }

    // ---------- helpers ----------

    private upsert<T extends { id: string }>(list: T[], row: T, creating: boolean): void {
        if (creating) { list.push(row); return; }
        const i = list.findIndex(r => r.id === row.id);
        if (i >= 0) { list[i] = row; }
    }

    private nextId(): string {
        const prefix = this.entity === "tasks" ? "TSK" : this.entity === "projects" ? "P" : "E";
        const width = this.entity === "tasks" ? 3 : 3;
        const all = [...this.data[this.entity].map(r => r.id), ...this.rows(this.entity).map(r => (r as { id: string }).id)];
        const max = all.reduce((m, id) => Math.max(m, Number(id.replace(/\D/g, "")) || 0), 0);
        return `${prefix}${String(max + 1).padStart(width, "0")}`;
    }

    private addLog(action: LogEntry["action"], id: string, row?: Row): void {
        const now = new Date();
        const pad = (n: number): string => String(n).padStart(2, "0");
        this.log.push({ action, entity: this.entity, id, row: row ? { ...row } : undefined, time: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}` });
        this.commit();
    }

    private notify(text: string, tone: "ok" | "bad"): void {
        this.toast = { text, tone };
        window.clearTimeout(this.toastTimer);
        this.toastTimer = window.setTimeout(() => { this.toast = null; this.rerender(); }, 3200);
        this.rerender();
    }

    private employeeName(id: string): string { return this.employees.find(e => e.id === id)?.n ?? this.lookup.empName(id); }
    private projectName(id: string): string { return this.projects.find(p => p.id === id)?.n ?? id; }
    private money(v: number): string { return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    private button(parent: HTMLElement, ic: IconName, text: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
        const b = this.el("button", `ac-btn ${className}`, parent) as HTMLButtonElement;
        b.appendChild(icon(ic, 13));
        b.appendChild(document.createTextNode(` ${text}`));
        b.disabled = disabled;
        b.onclick = (e) => { e.stopPropagation(); if (!disabled) { onClick(); } };
        return b;
    }

    private el(tag: string, className: string, parent: HTMLElement, text?: string): HTMLElement {
        const element = document.createElement(tag);
        if (className) { element.className = className; }
        if (text !== undefined) { element.textContent = text; }
        parent.appendChild(element);
        return element;
    }
}
