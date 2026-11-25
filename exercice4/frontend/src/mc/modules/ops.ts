"use strict";

/**
 * Operations modules. Every edit goes through the Store (session-only by default, or kept in the report when the user
 * opts in under Settings) and is labelled; nothing is written to the CSV files or the semantic model.
 */
import type { Ctx } from "../app";
import { Row } from "../core/data";
import { addDays, addMonths, CalEvent, conflicts, day, daysBetween, expandEvents, groupBy, isAtRiskProject, isOverdueTask, missionQueue, month, monthLabel, QueueItem } from "../core/engine";
import { STATUS_TONE } from "../core/theme";
import { bar, btn, card, chip, dataTable, drawer, empty, fmt, formGrid, h, icon, iconBtn, input, modal, newTableState, ring, select, sessionTag, tabs, TableState } from "../core/ui";

const tone = (s: string): string => STATUS_TONE[s] ?? "muted";
const sevTone = (s: string): string => (s === "Critique" ? "bad" : s === "Élevée" || s === "Avertissement" ? "warn" : s === "Moyenne" ? "info" : "muted");
const opts = (vals: string[]): Array<{ value: string; label: string }> => vals.map(v => ({ value: v, label: v }));
const uniq = (rows: Row[], k: string): string[] => Array.from(new Set(rows.map(r => r[k]).filter(Boolean))).sort();
function title(el: HTMLElement, t: string, sub: string, ...extra: Array<Node | null>): void { el.appendChild(h("div", "mc-page-title", h("h1", null, t), h("span", "mc-muted", sub), h("div", "mc-row-gap mc-push", ...extra.filter(Boolean) as Node[]))); }
function nextId(rows: Row[], key: string, prefix: string, width: number): string {
    const max = rows.reduce((m, r) => Math.max(m, Number(String(r[key]).replace(/\D/g, "")) || 0), 0);
    return `${prefix}${String(max + 1).padStart(width, "0")}`;
}

// ======================================================================== Mission Queue & Case Board
export function queue(c: Ctx, el: HTMLElement): void {
    const f = c.m<Record<string, string>>("queueF", () => ({ type: "", severity: "", status: "", dept: "", owner: "" }));
    const states = c.m<Record<string, { status?: string; owner?: string; notes?: string[] }>>("queueState", () => ({}));
    const view = c.m<string>("queueView", () => "queue");
    const all = missionQueue(c.ix).map(x => ({ ...x, status: states[x.id]?.status ?? x.status, owner: states[x.id]?.owner ?? x.owner }));
    const rows = all.filter(x => (!f.type || x.type === f.type) && (!f.severity || x.severity === f.severity) && (!f.status || x.status === f.status) && (!f.dept || x.dept === f.dept) && (!f.owner || x.owner === f.owner));
    title(el, "File des missions · tableau des dossiers", "Alertes, incidents, tâches en retard, projets à risque et problèmes de qualité des données dans une seule file priorisée.", sessionTag(false));
    el.appendChild(h("div", "mc-hint", icon("Info", 14), "Priorité = 40 × poids de gravité + 30 × impact (échelle log) + 20 × ancienneté (90 jours max.) + 10 × confiance. Les changements de statut / d'affectation ici sont une simulation limitée à la session."));
    const bar1 = h("div", "mc-filters");
    ([["type", "Type", uniq(all as any, "type")], ["severity", "Gravité", uniq(all as any, "severity")], ["status", "Statut", uniq(all as any, "status")], ["dept", "Département", uniq(all as any, "dept")], ["owner", "Responsable", uniq(all as any, "owner")]] as Array<[string, string, string[]]>)
        .forEach(([k, l, v]) => bar1.appendChild(select(opts(v), f[k], x => { f[k] = x; c.rerender(); }, l, "Tous")));
    bar1.appendChild(tabs([{ id: "queue", label: "File", icon: "ListChecks", count: rows.length }, { id: "board", label: "Tableau des dossiers", icon: "SquareKanban" }], view, id => { c.s.m.queueView = id; c.rerender(); }));
    el.appendChild(bar1);
    const open = (x: QueueItem): void => {
        const st = states[x.id] ?? (states[x.id] = {});
        const notes = st.notes ?? (st.notes = []);
        const noteIn = input("", () => undefined, "Ajouter une note…", "text", "queue-note");
        const body = h("div", "mc-inspector",
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Synthèse"), h("div", null, x.title), h("div", "mc-row-gap mc-wrap", chip(x.type, "muted"), chip(x.severity, sevTone(x.severity)), chip(x.status, tone(x.status)))),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Détail du score de priorité"), h("div", "mc-score-parts", ...Object.entries(x.parts).map(([k, v]) => h("div", null, h("span", null, k), bar(v / (k === "severity" ? 40 : k === "impact" ? 30 : k === "age" ? 20 : 10)), h("b", null, String(v))))), h("div", "mc-small mc-muted", `Total ${x.score}/100 · impact ${fmt.money(x.impact)} · ancienneté ${Math.max(0, daysBetween(x.date, c.ix.ref))} jours · confiance ${fmt.pct(x.confidence, 0)}`)),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Affectation et statut (session)"), h("div", "mc-row-gap mc-wrap",
                select(opts(["Nouveau", "Pris en compte", "En cours", "En investigation", "Résolu", "Clôturé"]), st.status ?? x.status, v => { st.status = v; c.store.audit("File des missions", "Statut modifié", `${x.id} → ${v}`); c.toast(`${x.id} passé à ${v} (session uniquement)`); c.rerender(); }, "Statut"),
                select(c.d.employees.map(e => ({ value: e.employee_name, label: e.employee_name })), st.owner ?? x.owner, v => { st.owner = v; c.store.audit("File des missions", "Affecté", `${x.id} → ${v}`); c.toast(`${x.id} affecté à ${v} (session uniquement)`); c.rerender(); }, "Responsable"))),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Enregistrement lié"), h("div", "mc-row-gap", btn("Ouvrir le module source", { small: true, icon: "ArrowUpRight", onClick: () => { c.s.m.queueOpen = ""; c.go(x.module); } }), btn("Créer une tâche", { small: true, icon: "Plus", onClick: () => { c.s.m.taskTemplate = { title: `Traiter ${x.type.toLowerCase()} ${x.id}`, priority: x.severity === "Critique" ? "Critique" : "Élevée" }; c.s.m.queueOpen = ""; c.go("tasks"); } }))),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Chronologie"), h("div", "mc-timeline", h("div", "mc-tl-item", h("span", "mc-tl-date", fmt.date(x.date)), h("span", null, `${x.type} enregistré`)), ...c.store.extras.log.filter(l => l.detail.startsWith(x.id)).map(l => h("div", "mc-tl-item mc-tone-info", h("span", "mc-tl-date", l.time), h("span", null, `${l.action}: ${l.detail}`))))),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Notes (session)"), ...notes.map(n => h("div", "mc-note", n)), h("div", "mc-chat-input", noteIn, iconBtn("Send", "Ajouter la note", () => { if (noteIn.value.trim()) { notes.push(noteIn.value.trim()); c.store.audit("File des missions", "Note ajoutée", x.id); c.rerender(); } }))),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Prochaine étape recommandée"), h("div", "mc-muted", x.type === "Incident" ? "Confirmez le responsable, atténuez, puis résolvez." : x.type === "Alerte" ? "Prenez en compte et vérifiez le signal dans les données sources." : x.type === "Tâche en retard" ? "Replanifiez l'échéance ou escaladez le blocage." : x.type === "Projet à risque" ? "Revoyez le périmètre et le budget avec le responsable du projet." : "Vérifiez la table source et marquez comme examiné dans le docteur des données.")));
        drawer(c.overlay, `${x.type} ${x.id}`, body, () => { c.s.m.queueOpen = ""; c.rerender(); }, { icon: "ListChecks", width: 440 });
    };
    if (view === "queue") {
        const ts = c.m<TableState>("queueTable", () => newTableState("score", true, 14));
        el.appendChild(dataTable<QueueItem>([
            { key: "score", label: "Priorité", get: r => r.score, num: true, render: r => h("span", "mc-score", String(r.score)) },
            { key: "type", label: "Type", get: r => r.type, render: r => chip(r.type, "muted") }, { key: "title", label: "Élément", get: r => r.title },
            { key: "severity", label: "Gravité", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) },
            { key: "status", label: "Statut", get: r => r.status, render: r => chip(r.status, tone(r.status)) },
            { key: "owner", label: "Responsable", get: r => r.owner }, { key: "dept", label: "Dépt / domaine", get: r => r.dept }, { key: "date", label: "Date", get: r => day(r.date), render: r => fmt.date(r.date) }
        ], rows, ts, () => c.rerender(), { onRow: r => { c.s.m.queueOpen = r.id; c.rerender(); }, id: "queue", chooser: true }));
    } else {
        const cols = ["Nouveau", "Pris en compte", "En cours", "En investigation", "Ouvert", "Résolu"];
        const board = h("div", "mc-kanban");
        cols.forEach(col => {
            const items = rows.filter(x => x.status === col || (col === "Ouvert" && !cols.includes(x.status) && x.status !== "Résolu"));
            const lane = h("div", "mc-lane", h("div", "mc-lane-head", h("span", null, col), chip(String(items.length), "muted")));
            lane.ondragover = (e: DragEvent): void => { e.preventDefault(); lane.classList.add("mc-drop"); };
            lane.ondragleave = (): void => lane.classList.remove("mc-drop");
            lane.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain") ?? ""; (states[id] ?? (states[id] = {})).status = col; c.store.audit("Tableau des dossiers", "Déplacé", `${id} → ${col}`); c.rerender(); };
            items.slice(0, 25).forEach(x => { const k = h("div", { class: "mc-kcard", draggable: "true", tabindex: 0 }, h("div", "mc-row-gap", h("span", "mc-score", String(x.score)), chip(x.severity, sevTone(x.severity))), h("div", null, x.title), h("div", "mc-small mc-muted", `${x.type} · ${x.owner}`)); k.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", x.id); }; k.onclick = (): void => { c.s.m.queueOpen = x.id; c.rerender(); }; lane.appendChild(k); });
            if (items.length > 25) { lane.appendChild(h("div", "mc-small mc-muted", `+ ${items.length - 25} de plus (filtrez pour affiner)`)); }
            board.appendChild(lane);
        });
        el.appendChild(board);
    }
    const openId = c.s.m.queueOpen as string | undefined; const sel = openId ? all.find(x => x.id === openId) : undefined; if (sel) { open(sel); }
}

// ======================================================================== Missions (26)
export function missions(c: Ctx, el: HTMLElement): void {
    const f = c.m<Record<string, string>>("missionF", () => ({ priority: "", status: "", category: "" }));
    const rows = c.d.missions.filter(m => (!f.priority || m.priority === f.priority) && (!f.status || m.mission_status === f.status) && (!f.category || m.mission_category === f.category) && (!c.ec.dept || m.department_id === c.ec.dept));
    const achieved = c.d.missions.filter(m => m.progress_pct >= m.completion_threshold_pct);
    title(el, "Mission Control · missions de l'entreprise", "Objectifs stratégiques présentés comme des missions : avancement vs seuil d'achèvement, priorité, département responsable, badges.");
    const top = h("div", "mc-grid mc-g-4");
    [["Actif", "Actif", "Rocket"], ["Bloqué", "Bloqué", "Ban"], ["Terminé", "Terminé", "CircleCheck"], ["Non démarré", "Non démarré", "Hourglass"]].forEach(([l, s2, ic]) => { const n = c.d.missions.filter(m => m.mission_status === s2).length; const b = h("button", { class: `mc-stat-card${f.status === s2 ? " mc-on" : ""}`, type: "button" }, icon(ic, 18), h("b", null, String(n)), h("span", null, l)); b.onclick = (): void => { f.status = f.status === s2 ? "" : s2; c.rerender(); }; top.appendChild(b); });
    el.appendChild(top);
    const fb = h("div", "mc-filters"); [["priority", "Priorité"], ["category", "Catégorie"]].forEach(([k, l]) => fb.appendChild(select(opts(uniq(c.d.missions, k === "priority" ? "priority" : "mission_category")), f[k], v => { f[k] = v; c.rerender(); }, l, "Tous"))); el.appendChild(fb);
    el.appendChild(h("div", "mc-hint", icon("Award", 14), `${achieved.length} missions ont atteint leur seuil d'achèvement (badge). Objectifs stratégiques : ${c.d.strategic_goals.filter(g => g.goal_status === "Atteint").length} atteints · ${c.d.strategic_goals.filter(g => g.goal_status === "Hors trajectoire").length} hors trajectoire.`));
    const g = h("div", "mc-mission-grid");
    rows.sort((a, b) => b.progress_pct - a.progress_pct).forEach(m => {
        const done = m.progress_pct >= m.completion_threshold_pct, late = day(m.target_date) < c.ix.ref && m.mission_status !== "Terminé";
        g.appendChild(h("div", "mc-mission-card",
            h("div", "mc-row-gap", ring(m.progress_pct, 56, m.mission_status === "Bloqué" ? "bad" : done ? "good" : "accent", fmt.pct(m.progress_pct, 0)), h("div", "mc-grow", h("b", null, m.mission_title), h("div", "mc-small mc-muted", `${m.mission_category} · ${c.ix.deptName(m.department_id)}`)), done ? h("span", { class: "mc-badge-award", title: "Seuil atteint" }, icon("Award", 18)) : null),
            h("div", "mc-row-gap mc-wrap", chip(m.mission_status, tone(m.mission_status)), chip(`Priorité ${m.priority}`, sevTone(m.priority)), late ? chip("Date cible dépassée", "bad") : null),
            h("div", "mc-small", `Seuil ${fmt.pct(m.completion_threshold_pct, 0)} · cible ${fmt.date(m.target_date)} · valeur ${fmt.compact(m.target_value_tnd)}`), bar(m.progress_pct / Math.max(0.01, m.completion_threshold_pct), done ? "good" : "accent")));
    });
    if (!rows.length) { g.appendChild(empty("Aucune mission ne correspond aux filtres.")); }
    el.appendChild(g);
}

// ======================================================================== Task Manager (13)
const TASK_COLS = ["À planifier", "À faire", "En cours", "Bloqué", "Terminé"];
export function tasks(c: Ctx, el: HTMLElement): void {
    const f = c.m<Record<string, string>>("taskF", () => ({ q: "", priority: "", dept: "", assignee: "", project: "" }));
    const rows = c.d.tasks.filter(t => (!f.priority || t.priority === f.priority) && (!f.dept || t.department_id === f.dept) && (!c.ec.dept || t.department_id === c.ec.dept) && (!f.assignee || t.assignee_employee_id === f.assignee) && (!f.project || t.project_id === f.project) && (!f.q || `${t.task_title} ${t.task_id} ${c.ix.empName(t.assignee_employee_id)}`.toLowerCase().includes(f.q.toLowerCase())));
    title(el, "Gestion des tâches", "Tableau Kanban · glissez les cartes entre les colonnes · cliquez sur une carte pour le détail.", sessionTag(c.persisted), btn("Nouvelle tâche", { icon: "Plus", kind: "primary", onClick: () => { c.s.m.taskForm = { mode: "new" }; c.rerender(); } }));
    const fb = h("div", "mc-filters");
    const q = input(f.q, v => { f.q = v; c.rerender(); }, "Rechercher une tâche…", "search", "task-q"); fb.appendChild(h("label", "mc-search-box", icon("Search", 14), q));
    fb.appendChild(select(opts(["Critique", "Élevée", "Moyenne", "Faible"]), f.priority, v => { f.priority = v; c.rerender(); }, "Priorité", "Tous"));
    fb.appendChild(select(c.d.departments.map(d => ({ value: d.department_id, label: d.department_name })), f.dept, v => { f.dept = v; c.rerender(); }, "Département", "Tous"));
    fb.appendChild(select(c.d.employees.map(e => ({ value: e.employee_id, label: e.employee_name })), f.assignee, v => { f.assignee = v; c.rerender(); }, "Responsable", "Tous"));
    fb.appendChild(select(c.d.projects.map(p => ({ value: p.project_id, label: p.project_name })), f.project, v => { f.project = v; c.rerender(); }, "Projet", "Tous"));
    el.appendChild(fb);
    const tpl = c.s.m.taskTemplate as { title: string; priority: string } | undefined;
    if (tpl || c.s.m.newTask) { c.s.m.taskForm = { mode: "new", tpl }; c.s.m.taskTemplate = undefined; c.s.m.newTask = false; }
    el.appendChild(h("div", "mc-hint", icon("Wand", 14), "Modèles : ouvrez une alerte, un incident ou un élément de la file et utilisez « Créer une tâche » — le formulaire est prérempli."));
    const board = h("div", "mc-kanban");
    TASK_COLS.forEach(col => {
        const items = rows.filter(t => t.task_status === col);
        const lane = h("div", "mc-lane", h("div", "mc-lane-head", h("span", null, col), chip(String(items.length), "muted")));
        lane.ondragover = (e: DragEvent): void => { e.preventDefault(); lane.classList.add("mc-drop"); };
        lane.ondragleave = (): void => lane.classList.remove("mc-drop");
        lane.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain") ?? ""; if (id) { c.store.change("tasks", id, { task_status: col }, "Gestionnaire de tâches", `${id} → ${col}`); c.toast(`${id} déplacé vers ${col}`); c.rerender(); } };
        const pr = { "Critique": 0, "Élevée": 1, "Moyenne": 2, "Faible": 3 } as Record<string, number>;
        const mine = new Set([...(c.store.ws.tasks?.added ?? []).map(r => r.task_id), ...Object.keys(c.store.ws.tasks?.changed ?? {})]); // your new/edited tasks first, so they are never hidden by the cap
        items.sort((a, b) => (Number(mine.has(b.task_id)) - Number(mine.has(a.task_id))) || (pr[a.priority] - pr[b.priority]) || a.due_date.localeCompare(b.due_date)).slice(0, 40).forEach(t => {
            const od = isOverdueTask(t, c.ix.ref);
            const k = h("div", { class: `mc-kcard${od ? " mc-kcard-late" : ""}`, draggable: "true", tabindex: 0, "aria-label": `${t.task_title}, ${t.priority}, ${col}` },
                h("div", "mc-row-gap", chip(t.priority, sevTone(t.priority)), h("span", "mc-small mc-muted", t.task_id), mine.has(t.task_id) ? chip((c.store.ws.tasks?.added ?? []).some(r => r.task_id === t.task_id) ? "Nouveau" : "Modifié", "accent") : null), h("div", null, t.task_title),
                h("div", "mc-small mc-muted", `${c.ix.empName(t.assignee_employee_id)} · ${od ? "en retard depuis le " : "échéance "}${fmt.date(t.due_date)}`));
            k.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", t.task_id); k.classList.add("mc-dragging"); };
            k.onclick = (): void => { c.s.m.taskForm = { mode: "edit", id: t.task_id }; c.rerender(); };
            k.onkeydown = (e: KeyboardEvent): void => { const i = TASK_COLS.indexOf(col); if (e.key === "ArrowRight" && i < TASK_COLS.length - 1) { c.store.change("tasks", t.task_id, { task_status: TASK_COLS[i + 1] }, "Gestionnaire de tâches", `${t.task_id} → ${TASK_COLS[i + 1]}`); c.rerender(); } if (e.key === "ArrowLeft" && i > 0) { c.store.change("tasks", t.task_id, { task_status: TASK_COLS[i - 1] }, "Gestionnaire de tâches", `${t.task_id} → ${TASK_COLS[i - 1]}`); c.rerender(); } if (e.key === "Enter") { k.click(); } };
            lane.appendChild(k);
        });
        if (items.length > 40) { lane.appendChild(h("div", "mc-small mc-muted", `+ ${items.length - 40} de plus — filtrez pour affiner`)); }
        if (!items.length) { lane.appendChild(h("div", "mc-lane-empty", "Déposer ici")); }
        board.appendChild(lane);
    });
    el.appendChild(board);
    const form = c.s.m.taskForm as { mode: "new" | "edit"; id?: string; tpl?: { title: string; priority: string }; v?: Row; err?: Record<string, string> } | undefined;
    if (form) {
        const t = form.mode === "edit" ? c.d.tasks.find(x => x.task_id === form.id) : undefined;
        const v = form.v ?? (form.v = t ? { ...t } : { task_title: form.tpl?.title ?? "", priority: form.tpl?.priority ?? "Moyenne", task_status: "À faire", task_type: "Opérationnel", due_date: addDays(c.ix.ref, 7), created_date: c.ix.ref, department_id: c.d.departments[0]?.department_id, assignee_employee_id: c.d.employees[0]?.employee_id, project_id: c.d.projects[0]?.project_id });
        const err = form.err ?? {};
        const close = (): void => { c.s.m.taskForm = undefined; c.rerender(); };
        const save = (): void => {
            const e2: Record<string, string> = {};
            if (!String(v.task_title ?? "").trim()) { e2.task_title = "Obligatoire"; }
            if (!v.due_date) { e2.due_date = "Obligatoire"; } else if (v.created_date && v.due_date < v.created_date) { e2.due_date = "L'échéance est antérieure à la date de création"; }
            if (Object.keys(e2).length) { form.err = e2; c.rerender(); return; }
            if (form.mode === "new") { const id = nextId(c.d.tasks, "task_id", "T", 4); c.store.add("tasks", { ...v, task_id: id, task_title: String(v.task_title).trim() }, "Gestionnaire de tâches", `${id} créé`); c.toast(`Tâche ${id} créée${c.persisted ? "" : " (session uniquement)"}`); }
            else { c.store.change("tasks", form.id as string, { ...v }, "Gestionnaire de tâches", `${form.id} modifié`); c.toast(`Tâche ${form.id} enregistrée`); }
            close();
        };
        const bind = (k: string): (x: string) => void => (x: string): void => { v[k] = x; };
        const body = formGrid([
            { label: "Titre *", el: input(v.task_title ?? "", bind("task_title"), "Titre de la tâche", "text", "tf-title"), error: err.task_title, wide: true },
            { label: "Statut", el: select(opts(TASK_COLS), v.task_status, bind("task_status")) }, { label: "Priorité", el: select(opts(["Critique", "Élevée", "Moyenne", "Faible"]), v.priority, bind("priority")) },
            { label: "Responsable", el: select(c.d.employees.map(e => ({ value: e.employee_id, label: e.employee_name })), v.assignee_employee_id, bind("assignee_employee_id")) },
            { label: "Département", el: select(c.d.departments.map(d => ({ value: d.department_id, label: d.department_name })), v.department_id, bind("department_id")) },
            { label: "Projet", el: select(c.d.projects.map(p => ({ value: p.project_id, label: p.project_name })), v.project_id, bind("project_id")) },
            { label: "Type (libellé)", el: select(opts(uniq(c.d.tasks, "task_type")), v.task_type, bind("task_type")) },
            { label: "Créé", el: input(v.created_date ?? "", bind("created_date"), "", "date") }, { label: "Échéance *", el: input(v.due_date ?? "", bind("due_date"), "", "date"), error: err.due_date }
        ]);
        modal(c.overlay, form.mode === "new" ? "Nouvelle tâche" : `Modifier ${form.id}`, h("div", null, sessionTag(c.persisted), body), [
            form.mode === "edit" ? btn("Supprimer", { icon: "Trash", kind: "danger", onClick: () => { c.store.remove("tasks", form.id as string, "Gestionnaire de tâches", `${form.id} supprimé`); c.toast(`Tâche ${form.id} supprimée`); close(); } }) : null,
            btn("Annuler", { onClick: close }), btn(form.mode === "new" ? "Créer" : "Save", { kind: "primary", icon: "Save", onClick: save })].filter(Boolean) as Node[], close, form.mode === "new" ? "Plus" : "Pencil");
    }
}

// ======================================================================== Projects (14)
export function projects(c: Ctx, el: HTMLElement): void {
    const rows = c.d.projects.filter(p => !c.ec.dept || p.department_id === c.ec.dept);
    title(el, "Portefeuille de projets", "Diagramme de Gantt, budget, avancement, responsables et signaux de risque (statut À risque, ou fin prévue dépassée sans être terminé).");
    const min = rows.reduce((m, p) => (p.start_date < m ? p.start_date : m), "9999"), max = rows.reduce((m, p) => (p.planned_end_date > m ? p.planned_end_date : m), c.ix.ref);
    const span = Math.max(1, daysBetween(min, max));
    const pos = (iso: string): number => (daysBetween(min, iso) / span) * 100;
    const g = card("Gantt", { icon: "ChartGantt", sub: `${fmt.date(min)} – ${fmt.date(max)} · barre = période prévue, remplissage = avancement, ligne = date de référence` });
    const months = Array.from(new Set(rows.flatMap(p => [month(p.start_date), month(p.planned_end_date)]))).sort();
    const axis = h("div", "mc-gantt-axis"); (months.length ? monthRangeSafe(months[0], months[months.length - 1]) : []).forEach(m => { const x = pos(m + "-01"); if (x >= 0 && x <= 100) { axis.appendChild(h("span", { style: { left: `${x}%` } }, monthLabel(m))); } });
    const gantt = h("div", "mc-gantt", axis);
    rows.slice().sort((a, b) => a.start_date.localeCompare(b.start_date)).forEach(p => {
        const risk = isAtRiskProject(p, c.ix.ref), tasks = c.d.tasks.filter(t => t.project_id === p.project_id), inc = c.d.incidents.filter(i => i.department_id === p.department_id && (i.incident_status === "Ouvert" || i.incident_status === "En investigation"));
        const row = h("div", { class: "mc-gantt-row mc-click", tabindex: 0 },
            h("div", "mc-gantt-label", h("b", null, p.project_name), h("span", "mc-small mc-muted", `${c.ix.empName(p.project_owner_id)} · ${tasks.length} tâches · ${inc.length} incidents du département`)),
            h("div", "mc-gantt-track", h("div", { class: `mc-gantt-bar mc-tone-${risk ? "bad" : tone(p.project_status)}`, style: { left: `${pos(p.start_date)}%`, width: `${Math.max(1, pos(p.planned_end_date) - pos(p.start_date))}%` }, title: `${p.project_status} · ${fmt.pct(p.completion_percent, 0)}` }, h("div", { class: "mc-gantt-fill", style: { width: `${p.completion_percent * 100}%` } }), h("span", null, `${fmt.pct(p.completion_percent, 0)}`)), h("div", { class: "mc-gantt-today", style: { left: `${pos(c.ix.ref)}%` } }), h("div", { class: "mc-gantt-milestone", style: { left: `${pos(p.planned_end_date)}%` }, title: `Jalon : fin prévue le ${fmt.date(p.planned_end_date)}` })),
            h("div", "mc-gantt-meta", chip(p.project_status, tone(p.project_status)), risk && p.project_status !== "À risque" ? chip("Fin prévue dépassée", "bad", "La fin prévue est antérieure à la date de référence et le projet n'est pas terminé") : null, h("span", "mc-small", fmt.compact(p.approved_budget_tnd))));
        row.onclick = (): void => c.select("project", p.project_id);
        gantt.appendChild(row);
    });
    g.body.appendChild(gantt); el.appendChild(g.el);
    const ts = c.m<TableState>("projTable", () => newTableState("approved_budget_tnd", true, 10));
    const t = card("Tableau du portefeuille", { icon: "Table", sub: "Budget vs avancement estimé : dépensé ≈ budget × avancement (pas de colonne de coût réel dans les données)" });
    t.body.appendChild(dataTable<Row>([
        { key: "project_name", label: "Projet", get: r => r.project_name }, { key: "dept", label: "Dépt", get: r => c.ix.deptName(r.department_id) }, { key: "owner", label: "Responsable", get: r => c.ix.empName(r.project_owner_id) },
        { key: "project_status", label: "Statut", get: r => r.project_status, render: r => chip(r.project_status, tone(r.project_status)) },
        { key: "approved_budget_tnd", label: "Budget", get: r => r.approved_budget_tnd, num: true, render: r => fmt.compact(r.approved_budget_tnd) },
        { key: "completion_percent", label: "Terminé", get: r => r.completion_percent, num: true, render: r => fmt.pct(r.completion_percent, 0) },
        { key: "proxy", label: "Budget × done", get: r => r.approved_budget_tnd * r.completion_percent, num: true, render: r => fmt.compact(r.approved_budget_tnd * r.completion_percent) },
        { key: "planned_end_date", label: "Fin prévue", get: r => r.planned_end_date, render: r => fmt.date(r.planned_end_date) },
        { key: "risk", label: "Flag", get: r => (isAtRiskProject(r, c.ix.ref) ? "À risque" : ""), render: r => (isAtRiskProject(r, c.ix.ref) ? chip("À risque", "bad") : "") }
    ], rows, ts, () => c.rerender(), { onRow: r => c.select("project", r.project_id), id: "proj" }));
    el.appendChild(t.el);
}
function monthRangeSafe(a: string, b: string): string[] { const out: string[] = []; let m = a; let guard = 0; while (m <= b && guard++ < 60) { out.push(m); m = addMonths(m + "-01", 1).slice(0, 7); } return out; }

// ======================================================================== Approvals (15)
export function approvals(c: Ctx, el: HTMLElement): void {
    const f = c.m<Record<string, string>>("apprF", () => ({ status: "", type: "", priority: "" }));
    const rows = c.d.approval_requests.filter(r => (!f.status || r.approval_status === f.status) && (!f.type || r.request_type === f.type) && (!f.priority || r.priority === f.priority));
    title(el, "Circuit d'approbation", "Soumettez des demandes, puis faites-les passer par En attente → Informations requises → Approuvé / Rejeté.", sessionTag(c.persisted), btn("Soumettre une demande", { icon: "Plus", kind: "primary", onClick: () => { c.s.m.apprForm = { request_type: "Dépense", priority: "Moyenne", requested_amount_tnd: "1000", request_description: "", approver_employee_id: c.d.employees[1]?.employee_id }; c.rerender(); } }));
    const steps = ["En attente", "Informations requises", "Approuvé", "Rejeté"];
    el.appendChild(h("div", "mc-grid mc-g-4", ...steps.map(s2 => { const n = c.d.approval_requests.filter(r => r.approval_status === s2); const b = h("button", { class: `mc-stat-card${f.status === s2 ? " mc-on" : ""}`, type: "button" }, h("b", null, String(n.length)), h("span", null, s2), h("span", "mc-small mc-muted", fmt.compact(n.reduce((a, r) => a + r.requested_amount_tnd, 0)))); b.onclick = (): void => { f.status = f.status === s2 ? "" : s2; c.rerender(); }; return b; })));
    const fb = h("div", "mc-filters"); fb.appendChild(select(opts(uniq(c.d.approval_requests, "request_type")), f.type, v => { f.type = v; c.rerender(); }, "Type", "Tous")); fb.appendChild(select(opts(["Critique", "Élevée", "Moyenne", "Faible"]), f.priority, v => { f.priority = v; c.rerender(); }, "Priorité", "Tous")); el.appendChild(fb);
    const ts = c.m<TableState>("apprTable", () => newTableState("request_date", true, 12));
    el.appendChild(dataTable<Row>([
        { key: "approval_id", label: "Demande", get: r => r.approval_id }, { key: "request_type", label: "Type", get: r => r.request_type }, { key: "priority", label: "Priorité", get: r => r.priority, render: r => chip(r.priority, sevTone(r.priority)) },
        { key: "requested_amount_tnd", label: "Montant", get: r => r.requested_amount_tnd, num: true, render: r => fmt.money(r.requested_amount_tnd) },
        { key: "req", label: "Demandeur", get: r => c.ix.empName(r.requester_employee_id) }, { key: "appr", label: "Approbateur", get: r => c.ix.empName(r.approver_employee_id) },
        { key: "approval_status", label: "Statut", get: r => r.approval_status, render: r => chip(r.approval_status, tone(r.approval_status)) },
        { key: "request_date", label: "Date", get: r => r.request_date, render: r => fmt.date(r.request_date) },
        { key: "act", label: "Action", get: () => "", render: r => (r.approval_status === "Approuvé" || r.approval_status === "Rejeté") ? h("span", "mc-muted mc-small", "decided") : h("div", "mc-row-gap",
            btn("", { icon: "Check", small: true, title: "Approuver", onClick: () => { c.store.change("approval_requests", r.approval_id, { approval_status: "Approuvé" }, "Approbations", `${r.approval_id} approuvée`); c.toast(`${r.approval_id} approuvée`); c.rerender(); } }),
            btn("", { icon: "Info", small: true, title: "Demander des informations", onClick: () => { c.store.change("approval_requests", r.approval_id, { approval_status: "Informations requises" }, "Approbations", `${r.approval_id} : informations requises`); c.rerender(); } }),
            btn("", { icon: "X", small: true, kind: "danger", title: "Rejeter", onClick: () => { c.store.change("approval_requests", r.approval_id, { approval_status: "Rejeté" }, "Approbations", `${r.approval_id} rejetée`); c.toast(`${r.approval_id} rejetée`, "info"); c.rerender(); } })) }
    ], rows, ts, () => c.rerender(), { id: "appr", onRow: r => { c.s.m.apprOpen = r.approval_id; c.rerender(); } }));
    const openId = c.s.m.apprOpen as string | undefined; const r0 = openId ? c.d.approval_requests.find(r => r.approval_id === openId) : undefined;
    if (r0) {
        const idx = steps.indexOf(r0.approval_status);
        const log = c.store.extras.log.filter(l => l.detail.startsWith(r0.approval_id));
        drawer(c.overlay, `Approbation ${r0.approval_id}`, h("div", "mc-inspector",
            h("div", "mc-steps", ...["Soumise", "En attente", "Informations requises", "Décision"].map((s2, i) => h("div", `mc-step${i <= Math.max(1, idx >= 2 ? 3 : idx + 1) ? " mc-on" : ""}`, h("span", null, String(i + 1)), s2))),
            h("div", "mc-ins-section", h("div", "mc-ins-title", r0.request_description), h("div", null, `${r0.request_type} · ${fmt.money(r0.requested_amount_tnd)} · priorité ${r0.priority}`), h("div", "mc-muted", `${c.ix.empName(r0.requester_employee_id)} → ${c.ix.empName(r0.approver_employee_id)}`)),
            h("div", "mc-ins-section", h("div", "mc-ins-title", "Étapes"), h("div", "mc-timeline", h("div", "mc-tl-item", h("span", "mc-tl-date", fmt.date(r0.request_date)), "Soumise"), ...log.map(l => h("div", "mc-tl-item mc-tone-info", h("span", "mc-tl-date", l.time), l.action + " · " + l.detail))))), () => { c.s.m.apprOpen = ""; c.rerender(); }, { icon: "CheckCheck" });
    }
    const form = c.s.m.apprForm as Row | undefined;
    if (form) {
        const close = (): void => { c.s.m.apprForm = undefined; c.rerender(); };
        const bind = (k: string): (x: string) => void => (x: string): void => { form[k] = x; };
        modal(c.overlay, "Soumettre une demande d'approbation", h("div", null, sessionTag(c.persisted), formGrid([
            { label: "Type", el: select(opts(uniq(c.d.approval_requests, "request_type")), form.request_type, bind("request_type")) }, { label: "Priorité", el: select(opts(["Critique", "Élevée", "Moyenne", "Faible"]), form.priority, bind("priority")) },
            { label: "Montant (TND) *", el: input(String(form.requested_amount_tnd), bind("requested_amount_tnd"), "", "number"), error: form.err },
            { label: "Approbateur", el: select(c.d.employees.map(e => ({ value: e.employee_id, label: e.employee_name })), form.approver_employee_id, bind("approver_employee_id")) },
            { label: "Description", el: input(form.request_description, bind("request_description"), "Ce qui est demandé et pourquoi"), wide: true }])), [btn("Annuler", { onClick: close }), btn("Soumettre", { kind: "primary", icon: "Send", onClick: () => {
                const amt = Number(form.requested_amount_tnd); if (!(amt > 0) || amt > 10000000) { form.err = "Montant entre 1 et 10 000 000"; c.rerender(); return; }
                const id = nextId(c.d.approval_requests, "approval_id", "APR", 4);
                c.store.add("approval_requests", { approval_id: id, request_type: form.request_type, priority: form.priority, requested_amount_tnd: amt, requester_employee_id: c.d.employees[0]?.employee_id, approver_employee_id: form.approver_employee_id, approval_status: "En attente", request_date: c.ix.ref, request_description: form.request_description || "Nouvelle demande" }, "Approbations", `${id} soumise`);
                c.toast(`${id} soumise (En attente)`); close();
            } })], close, "Send");
    }
}

// ======================================================================== Calendar (16)
export function calendar(c: Ctx, el: HTMLElement): void {
    const view = c.m<string>("calView", () => (window.innerWidth <= 640 ? "agenda" : "month"));
    const date = c.m<string>("calDate", () => c.ix.ref);
    const f = c.m<Record<string, string>>("calF", () => ({ type: "", priority: "", status: "", owner: "", dept: "", location: "" }));
    let from = date, to = date;
    if (view === "month") { from = date.slice(0, 8) + "01"; to = addDays(addMonths(from, 1), -1); }
    if (view === "week" || view === "timeline") { const dow = (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7; from = addDays(date, -dow); to = addDays(from, view === "timeline" ? 13 : 6); }
    if (view === "agenda") { from = date; to = addDays(date, 30); }
    const evAll = expandEvents(c.d.calendar_events, addDays(from, -1), addDays(to, 1));
    const evs = evAll.filter(e => (!f.type || e.type === f.type) && (!f.priority || e.priority === f.priority) && (!f.status || e.status === f.status) && (!f.owner || e.owner === f.owner) && (!f.dept || e.dept === f.dept) && (!c.ec.dept || e.dept === c.ec.dept) && (!f.location || e.row.location_or_meeting_link === f.location));
    const cf = conflicts(evs);
    const conflictIds = new Set(cf.flatMap(x => [x.a.id, x.b.id]));
    const typeColor = (t: string): string => ({ "Réunion": "accent", Maintenance: "warn", "Revue": "info", "Formation": "good", "Appel client": "teal", "Jalon de projet": "violet", "Rappel": "muted", "Échéance de tâche": "bad" } as Record<string, string>)[t] ?? "muted";
    title(el, "Calendrier et gestion des événements", "Horaires locaux de démonstration (sans conversion de fuseau). Les événements récurrents sont développés pour l'affichage (60 max. par événement).", sessionTag(c.persisted), btn("Nouvel événement", { icon: "Plus", kind: "primary", onClick: () => { c.s.m.evForm = { mode: "new" }; c.rerender(); } }));
    const nav = h("div", "mc-cal-nav",
        tabs(([["month", "Mois"], ["week", "Semaine"], ["day", "Jour"], ["agenda", "Agenda"], ["timeline", "Chronologie"]] as Array<[string, string]>).map(([v, l]) => ({ id: v, label: l })), view, v => { c.s.m.calView = v; c.rerender(); }),
        iconBtn("ChevronLeft", "Précédent", () => { c.s.m.calDate = view === "month" ? addMonths(date, -1) : view === "day" ? addDays(date, -1) : addDays(date, view === "agenda" ? -30 : view === "timeline" ? -14 : -7); c.rerender(); }),
        btn("Aujourd'hui", { small: true, onClick: () => { c.s.m.calDate = c.ix.ref; c.rerender(); } }),
        iconBtn("ChevronRight", "Suivant", () => { c.s.m.calDate = view === "month" ? addMonths(date, 1) : view === "day" ? addDays(date, 1) : addDays(date, view === "agenda" ? 30 : view === "timeline" ? 14 : 7); c.rerender(); }),
        input(date, v => { if (/^\d{4}-\d{2}-\d{2}$/.test(v)) { c.s.m.calDate = v; c.rerender(); } }, "", "date"),
        h("b", "mc-cal-label", view === "month" ? monthLabel(month(date)).replace(" ", " 20") : `${fmt.date(from)}${from !== to ? " – " + fmt.date(to) : ""}`));
    el.appendChild(nav);
    const fb = h("div", "mc-filters");
    ([["type", "Type", uniq(c.d.calendar_events, "event_type")], ["priority", "Priorité", uniq(c.d.calendar_events, "priority")], ["status", "Statut", uniq(c.d.calendar_events, "event_status")], ["location", "Site", uniq(c.d.calendar_events, "location_or_meeting_link")]] as Array<[string, string, string[]]>).forEach(([k, l, v]) => fb.appendChild(select(opts(v), f[k], x => { f[k] = x; c.rerender(); }, l, "Tous")));
    fb.appendChild(select(c.d.employees.map(e => ({ value: e.employee_id, label: e.employee_name })), f.owner, v => { f.owner = v; c.rerender(); }, "Responsable", "Tous"));
    fb.appendChild(select(c.d.departments.map(d => ({ value: d.department_id, label: d.department_name })), f.dept, v => { f.dept = v; c.rerender(); }, "Équipe / département", "Tous"));
    el.appendChild(fb);
    el.appendChild(h("div", "mc-legend", ...["Réunion", "Maintenance", "Revue", "Formation", "Appel client", "Jalon de projet", "Rappel", "Échéance de tâche"].map(t => h("span", null, h("i", `mc-dot-legend mc-bg-${typeColor(t)}`), t)), h("span", null, icon("TriangleAlert", 12), "conflit"), h("span", null, icon("RefreshCw", 12), "récurrent"), h("span", null, h("i", "mc-dot-legend mc-ring-task"), "échéance de tâche (superposition)"), h("span", null, h("i", "mc-dot-legend mc-ring-ms"), "jalon de projet (superposition)"), h("span", null, h("i", "mc-dot-legend mc-ring-inc"), "incident (superposition)")));
    const chipEv = (e: CalEvent): HTMLElement => {
        const b = h("button", { class: `mc-ev mc-bg-${typeColor(e.type)}${e.status === "Annulé" ? " mc-ev-cancel" : ""}${conflictIds.has(e.id) ? " mc-ev-conflict" : ""}`, type: "button", draggable: "true", title: `${e.title} · ${fmt.time(e.start)}–${fmt.time(e.end)} · ${c.ix.empName(e.owner)} · ${e.status}` },
            conflictIds.has(e.id) ? icon("TriangleAlert", 10) : null, e.occurrence ? icon("RefreshCw", 10) : null, h("span", null, `${fmt.time(e.start)} ${e.title}`));
        b.ondragstart = (ev: DragEvent): void => { ev.dataTransfer?.setData("text/plain", e.base); };
        b.onclick = (ev): void => { ev.stopPropagation(); c.s.m.evOpen = e.id; c.rerender(); };
        return b;
    };
    const dropDay = (cell: HTMLElement, iso: string): void => {
        cell.ondragover = (e: DragEvent): void => { e.preventDefault(); cell.classList.add("mc-drop"); };
        cell.ondragleave = (): void => cell.classList.remove("mc-drop");
        cell.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain"); const r = c.d.calendar_events.find(x => x.event_id === id); if (r) { const sT = r.start_datetime.slice(10), eT = r.end_datetime.slice(10); const shift = daysBetween(day(r.start_datetime), iso); c.store.change("calendar_events", r.event_id, { start_datetime: iso + sT, end_datetime: addDays(day(r.end_datetime), shift) + eT, event_status: "Reprogrammé" }, "Calendrier", `${r.event_id} déplacé au ${iso}`); c.toast(`${r.event_title} reprogrammé au ${fmt.date(iso)}`); c.rerender(); } };
    };
    const overlays = (iso: string): Node[] => {
        const out: Node[] = [];
        c.d.tasks.filter(t => day(t.due_date) === iso && t.task_status !== "Terminé").slice(0, 2).forEach(t => out.push(h("div", { class: "mc-ov mc-ring-task", title: `Échéance de tâche : ${t.task_title}` }, `◇ ${t.task_title}`)));
        c.d.projects.filter(p => day(p.planned_end_date) === iso).forEach(p => out.push(h("div", { class: "mc-ov mc-ring-ms", title: "Jalon de projet (fin prévue)" }, `◆ ${p.project_name}`)));
        c.d.incidents.filter(i => day(i.incident_date) === iso && i.severity === "Critique").slice(0, 1).forEach(i => out.push(h("div", { class: "mc-ov mc-ring-inc", title: `Incident critique ${i.incident_id}` }, `! ${i.incident_type}`)));
        return out;
    };
    const main = h("div", "mc-cal-main");
    if (view === "month") {
        const g = h("div", "mc-cal-month"); ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "Sun"].forEach(d => g.appendChild(h("div", "mc-cal-dow", d)));
        const lead = (new Date(from + "T00:00:00Z").getUTCDay() + 6) % 7; for (let i = 0; i < lead; i++) { g.appendChild(h("div", "mc-cal-cell mc-cal-out")); }
        for (let iso = from; iso <= to; iso = addDays(iso, 1)) {
            const list = evs.filter(e => day(e.start) === iso);
            const cell = h("div", { class: `mc-cal-cell${iso === c.ix.ref ? " mc-today" : ""}`, tabindex: 0, "aria-label": `${fmt.date(iso)}, ${list.length} événements` }, h("div", "mc-cal-num", String(Number(iso.slice(8)))), ...list.slice(0, 3).map(chipEv), list.length > 3 ? h("div", "mc-small mc-muted", `+${list.length - 3} de plus`) : null, ...overlays(iso));
            cell.ondblclick = (): void => { c.s.m.calDate = iso; c.s.m.calView = "day"; c.rerender(); };
            dropDay(cell, iso); g.appendChild(cell);
        }
        main.appendChild(g);
    } else if (view === "week" || view === "day") {
        const days: string[] = []; for (let iso = from; iso <= to; iso = addDays(iso, 1)) { days.push(iso); }
        const g = h("div", { class: "mc-cal-week", style: { gridTemplateColumns: `52px repeat(${days.length}, 1fr)` } });
        g.appendChild(h("div")); days.forEach(d => g.appendChild(h("div", `mc-cal-dow${d === c.ix.ref ? " mc-today" : ""}`, fmt.date(d))));
        for (let hr = 7; hr <= 19; hr++) {
            g.appendChild(h("div", "mc-cal-hour", `${String(hr).padStart(2, "0")}:00`));
            days.forEach(d => { const slot = h("div", "mc-cal-slot", ...evs.filter(e => day(e.start) === d && Number(e.start.slice(11, 13)) === hr).map(chipEv)); dropDay(slot, d); g.appendChild(slot); });
        }
        main.appendChild(g);
        if (view === "day") { main.appendChild(h("div", "mc-cal-overlays", h("b", null, "Superpositions : "), ...overlays(from))); }
    } else if (view === "agenda") {
        const g = groupBy(evs, e => day(e.start)); const list = h("div", "mc-agenda");
        Array.from(g.keys()).sort().forEach(d => list.appendChild(h("div", "mc-agenda-day", h("div", "mc-agenda-date", fmt.date(d)), ...(g.get(d) ?? []).map(e => h("div", "mc-agenda-row", h("span", "mc-small", `${fmt.time(e.start)}–${fmt.time(e.end)}`), chipEv(e), h("span", "mc-muted mc-small", `${c.ix.empName(e.owner)} · ${e.row.location_or_meeting_link}`))))));
        if (!g.size) { list.appendChild(empty("Aucun événement dans les 30 prochains jours pour ces filtres.", "CalendarDays")); }
        main.appendChild(list);
    } else {
        const owners = Array.from(new Set(evs.map(e => e.owner))).slice(0, 18);
        const days: string[] = []; for (let iso = from; iso <= to; iso = addDays(iso, 1)) { days.push(iso); }
        const g = h("div", { class: "mc-cal-timeline", style: { gridTemplateColumns: `150px repeat(${days.length}, 1fr)` } });
        g.appendChild(h("div", "mc-cal-dow", "Responsable")); days.forEach(d => g.appendChild(h("div", "mc-cal-dow", d.slice(8))));
        owners.forEach(o => { g.appendChild(h("div", "mc-cal-owner", c.ix.empName(o))); days.forEach(d => g.appendChild(h("div", "mc-cal-slot", ...evs.filter(e => e.owner === o && day(e.start) === d).map(chipEv)))); });
        if (!owners.length) { g.appendChild(empty("Aucun événement.")); }
        main.appendChild(g);
    }
    const side = h("div", "mc-cal-side");
    const upcoming = expandEvents(c.d.calendar_events, c.ix.ref, addDays(c.ix.ref, 7)).filter(e => e.status !== "Annulé");
    const todayEv = upcoming.filter(e => day(e.start) === c.ix.ref);
    const overdueDl = c.d.tasks.filter(t => isOverdueTask(t, c.ix.ref)).length;
    const reminders = upcoming.filter(e => e.row.reminder_setting && e.row.reminder_setting !== "Aucun rappel").slice(0, 5);
    side.appendChild(card("Agenda du jour", { icon: "CalendarClock" }).el); (side.lastChild as HTMLElement).querySelector(".mc-card-body")?.append(...(todayEv.length ? todayEv.map(chipEv) : [h("div", "mc-muted", "Rien aujourd'hui")]));
    const nx = card("7 prochains jours", { icon: "CalendarDays", sub: `${upcoming.length} événements` }); upcoming.slice(0, 8).forEach(e => nx.body.appendChild(h("div", "mc-agenda-row", h("span", "mc-small", fmt.date(e.start)), chipEv(e)))); side.appendChild(nx.el);
    const rm = card("Rappels (dans le tableau de bord uniquement)", { icon: "Bell", sub: "De vrais rappels push / e-mail / Teams nécessitent un service externe" }); reminders.forEach(e => rm.body.appendChild(h("div", "mc-small", `${e.row.reminder_setting} avant · ${e.title} (${fmt.date(e.start)})`))); if (!reminders.length) { rm.body.appendChild(h("div", "mc-muted", "Aucun")); } side.appendChild(rm.el);
    const cfc = card("Conflits de planning", { icon: "TriangleAlert", sub: "même responsable, horaires qui se chevauchent, dans la vue" }); cf.slice(0, 6).forEach(x => { const r = h("div", "mc-conflict mc-click", h("b", null, c.ix.empName(x.a.owner)), h("span", "mc-small", `${x.a.title} ${fmt.time(x.a.start)}–${fmt.time(x.a.end)} ⟷ ${x.b.title} ${fmt.time(x.b.start)}–${fmt.time(x.b.end)} · ${fmt.date(x.a.start)}`)); r.onclick = (): void => { c.s.m.evOpen = x.a.id; c.s.m.evPair = x.b.id; c.rerender(); }; cfc.body.appendChild(r); }); if (!cf.length) { cfc.body.appendChild(h("div", "mc-muted", "Aucun conflit dans la vue")); } side.appendChild(cfc.el);
    side.appendChild(h("div", "mc-small mc-muted", `${overdueDl} échéances de tâches sont dépassées (affichées en ◇, pas comme des réunions).`));
    el.appendChild(h("div", "mc-cal-layout", main, side));
    // event detail
    const openId = c.s.m.evOpen as string | undefined; const ev = openId ? evAll.find(e => e.id === openId) : undefined;
    if (ev) {
        const pair = c.s.m.evPair ? evAll.find(e => e.id === c.s.m.evPair) : undefined; const r = ev.row;
        const kvx = (e2: CalEvent): HTMLElement => h("dl", "mc-kv", ...([["Type", e2.type], ["Début", `${fmt.date(e2.start)} ${fmt.time(e2.start)}`], ["Fin", `${fmt.date(e2.end)} ${fmt.time(e2.end)}`], ["Responsable", c.ix.empName(e2.owner)], ["Département", c.ix.deptName(e2.dept)], ["Lieu / lien", e2.row.location_or_meeting_link], ["Statut", e2.status], ["Priorité", e2.priority], ["Récurrence", `${e2.recurrence}${e2.occurrence ? " (occurrence)" : ""}`], ["Rappel", e2.row.reminder_setting], ["Projet lié", e2.row.related_project_id ? c.ix.projName(e2.row.related_project_id) : "—"], ["Tâche liée", e2.row.related_task_id ?? "—"], ["Description", e2.row.event_description]] as Array<[string, string]>).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v ?? "—")]));
        drawer(c.overlay, ev.title, h("div", "mc-inspector", kvx(ev), pair ? h("div", "mc-ins-section", h("div", "mc-ins-title mc-tone-warn", "En conflit avec"), kvx(pair)) : null,
            h("div", "mc-row-gap", btn("Modifier", { icon: "Pencil", onClick: () => { c.s.m.evForm = { mode: "edit", id: r.event_id }; c.s.m.evOpen = ""; c.rerender(); } }), btn("Supprimer", { icon: "Trash", kind: "danger", onClick: () => { c.store.remove("calendar_events", r.event_id, "Calendrier", `${r.event_id} supprimé`); c.s.m.evOpen = ""; c.toast("Événement supprimé"); c.rerender(); } }))), () => { c.s.m.evOpen = ""; c.s.m.evPair = ""; c.rerender(); }, { icon: "CalendarDays" });
    }
    if (c.s.m.newEvent) { c.s.m.evForm = { mode: "new" }; c.s.m.newEvent = false; }
    const form = c.s.m.evForm as { mode: string; id?: string; v?: Row; err?: string } | undefined;
    if (form) {
        const base = form.mode === "edit" ? c.d.calendar_events.find(x => x.event_id === form.id) : undefined;
        const v = form.v ?? (form.v = base ? { ...base, sd: day(base.start_datetime), st: base.start_datetime.slice(11, 16), et: base.end_datetime.slice(11, 16) } : { event_title: "", event_type: "Réunion", priority: "Moyenne", sd: date, st: "09:00", et: "10:00", owner_employee_id: c.d.employees[0]?.employee_id, department_id: c.d.departments[0]?.department_id, location_or_meeting_link: "En ligne", event_status: "Planifié", recurrence_pattern: "Une fois", reminder_setting: "Aucun rappel", event_description: "" });
        const close = (): void => { c.s.m.evForm = undefined; c.rerender(); };
        const bind = (k: string): (x: string) => void => (x: string): void => { v[k] = x; };
        const body = formGrid([
            { label: "Titre *", el: input(v.event_title, bind("event_title"), "Titre de l'événement", "text", "ev-title"), wide: true, error: form.err },
            { label: "Type", el: select(opts(uniq(c.d.calendar_events, "event_type")), v.event_type, bind("event_type")) }, { label: "Priorité", el: select(opts(uniq(c.d.calendar_events, "priority")), v.priority, bind("priority")) },
            { label: "Date", el: input(v.sd, bind("sd"), "", "date") }, { label: "Début", el: input(v.st, bind("st"), "", "time") }, { label: "Fin", el: input(v.et, bind("et"), "", "time") },
            { label: "Responsable", el: select(c.d.employees.map(e => ({ value: e.employee_id, label: e.employee_name })), v.owner_employee_id, bind("owner_employee_id")) },
            { label: "Département", el: select(c.d.departments.map(d => ({ value: d.department_id, label: d.department_name })), v.department_id, bind("department_id")) },
            { label: "Lieu / lien", el: input(v.location_or_meeting_link, bind("location_or_meeting_link")) }, { label: "Statut", el: select(opts(uniq(c.d.calendar_events, "event_status")), v.event_status, bind("event_status")) },
            { label: "Récurrence", el: select(opts(["Une fois", "Quotidienne", "Hebdomadaire", "Mensuelle"]), v.recurrence_pattern, bind("recurrence_pattern")) }, { label: "Rappel", el: select(opts(uniq(c.d.calendar_events, "reminder_setting")), v.reminder_setting, bind("reminder_setting")) },
            { label: "Description", el: input(v.event_description, bind("event_description")), wide: true }]);
        modal(c.overlay, form.mode === "new" ? "Nouvel événement" : `Modifier ${form.id}`, h("div", null, sessionTag(c.persisted), body), [btn("Annuler", { onClick: close }), btn("Save", { kind: "primary", icon: "Save", onClick: () => {
            if (!String(v.event_title).trim()) { form.err = "Le titre est obligatoire"; c.rerender(); return; }
            if (v.et <= v.st) { form.err = "L'heure de fin doit être après l'heure de début"; c.rerender(); return; }
            const row = { event_title: String(v.event_title).trim(), event_type: v.event_type, priority: v.priority, start_datetime: `${v.sd} ${v.st}`, end_datetime: `${v.sd} ${v.et}`, owner_employee_id: v.owner_employee_id, department_id: v.department_id, related_project_id: v.related_project_id ?? null, related_task_id: v.related_task_id ?? null, location_or_meeting_link: v.location_or_meeting_link, event_status: v.event_status, recurrence_pattern: v.recurrence_pattern, reminder_setting: v.reminder_setting, event_description: v.event_description };
            if (form.mode === "new") { const id = nextId(c.d.calendar_events, "event_id", "EV", 4); c.store.add("calendar_events", { event_id: id, ...row }, "Calendrier", `${id} créé`); c.toast(`Événement ${id} créé`); } else { c.store.change("calendar_events", form.id as string, row, "Calendrier", `${form.id} modifié`); c.toast("Événement enregistré"); }
            close();
        } })], close, "CalendarDays");
    }
}

// ======================================================================== Decision Register (12)
export function decisions(c: Ctx, el: HTMLElement): void {
    const flow = ["Proposé", "Approuvé", "Mis en œuvre", "En mesure", "Rejeté"];
    const f = c.m<Record<string, string>>("decF", () => ({ status: "", type: "" }));
    const rows = c.d.decisions.filter(d => (!f.status || d.decision_status === f.status) && (!f.type || d.decision_type === f.type) && (!c.ec.dept || d.department_id === c.ec.dept));
    title(el, "Analyse de l'impact des décisions", "Enregistrez des décisions, suivez l'impact attendu vs réel sur les KPI et leur statut.", sessionTag(c.persisted), btn("Enregistrer une décision", { icon: "Plus", kind: "primary", onClick: () => { c.s.m.decForm = { decision_type: "Réduction des coûts", expected_impact_tnd: "50000", expected_kpi_change_pct: "5", decision_notes: "", review: addMonths(c.ix.ref, 3) }; c.rerender(); } }));
    const measured = c.d.decisions.filter(d => d.decision_status === "Mis en œuvre" || d.decision_status === "En mesure");
    const hit = measured.filter(d => d.actual_kpi_change_pct >= d.expected_kpi_change_pct).length;
    el.appendChild(h("div", "mc-grid mc-g-4", ...flow.map(s2 => { const b = h("button", { class: `mc-stat-card${f.status === s2 ? " mc-on" : ""}`, type: "button" }, h("b", null, String(c.d.decisions.filter(d => d.decision_status === s2).length)), h("span", null, s2)); b.onclick = (): void => { f.status = f.status === s2 ? "" : s2; c.rerender(); }; return b; }), h("div", "mc-stat-card", h("b", null, fmt.pct(measured.length ? hit / measured.length : null, 0)), h("span", null, "décisions mises en œuvre atteignant l'effet attendu"))));
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const sc = card("Variation des KPI attendue vs réelle", { icon: "Scale", sub: "Chaque point est une décision · au-dessus de la diagonale = mieux que prévu" }); const ch = h("div", "mc-chart mc-h260"); sc.body.appendChild(ch); g.appendChild(sc.el);
    c.ch.scatter(ch, rows.map(d => ({ name: `${d.decision_id} ${d.decision_type}`, x: d.expected_kpi_change_pct * 100, y: d.actual_kpi_change_pct * 100, size: d.expected_impact_tnd, color: d.actual_kpi_change_pct >= d.expected_kpi_change_pct ? c.t.good : c.t.bad })), "Variation attendue du KPI (%)", "Variation réelle du KPI (%)", p => { c.s.m.decOpen = rows[p.dataIndex]?.decision_id; c.rerender(); });
    const tl = card("Chronologie des décisions", { icon: "Clock" }); rows.slice().sort((a, b) => b.decision_date.localeCompare(a.decision_date)).slice(0, 10).forEach(d => tl.body.appendChild(h("div", "mc-tl-item", h("span", "mc-tl-date", fmt.date(d.decision_date)), h("span", null, `${d.decision_type} · `), chip(d.decision_status, tone(d.decision_status))))); g.appendChild(tl.el);
    const ts = c.m<TableState>("decTable", () => newTableState("decision_date", true, 10));
    el.appendChild(dataTable<Row>([
        { key: "decision_id", label: "Décision", get: r => r.decision_id }, { key: "decision_type", label: "Type", get: r => r.decision_type }, { key: "owner", label: "Responsable", get: r => c.ix.empName(r.decision_owner_id) },
        { key: "decision_status", label: "Statut", get: r => r.decision_status, render: r => chip(r.decision_status, tone(r.decision_status)) },
        { key: "expected_impact_tnd", label: "Impact attendu", get: r => r.expected_impact_tnd, num: true, render: r => fmt.compact(r.expected_impact_tnd) },
        { key: "expected_kpi_change_pct", label: "Δ KPI attendu", get: r => r.expected_kpi_change_pct, num: true, render: r => fmt.pct(r.expected_kpi_change_pct) },
        { key: "actual_kpi_change_pct", label: "Δ KPI réel", get: r => r.actual_kpi_change_pct, num: true, render: r => h("span", r.actual_kpi_change_pct >= r.expected_kpi_change_pct ? "mc-tone-good" : "mc-tone-bad", fmt.pct(r.actual_kpi_change_pct)) },
        { key: "next", label: "Passer à", get: () => "", render: r => { const i = flow.indexOf(r.decision_status); return i >= 0 && i < 3 ? btn(flow[i + 1], { small: true, icon: "ArrowRight", onClick: () => { c.store.change("decisions", r.decision_id, { decision_status: flow[i + 1] }, "Décisions", `${r.decision_id} → ${flow[i + 1]}`); c.rerender(); } }) : ""; } }
    ], rows, ts, () => c.rerender(), { id: "dec", onRow: r => { c.s.m.decOpen = r.decision_id; c.rerender(); } }));
    const op = c.s.m.decOpen ? c.d.decisions.find(d => d.decision_id === c.s.m.decOpen) : undefined;
    if (op) { drawer(c.overlay, `${op.decision_id} · ${op.decision_type}`, h("div", "mc-inspector", h("dl", "mc-kv", ...([["Responsable", c.ix.empName(op.decision_owner_id)], ["Département", c.ix.deptName(op.department_id)], ["Date", fmt.date(op.decision_date)], ["Statut", op.decision_status], ["Hypothèse / impact attendu", fmt.money(op.expected_impact_tnd)], ["Variation attendue du KPI", fmt.pct(op.expected_kpi_change_pct)], ["Variation réelle du KPI", fmt.pct(op.actual_kpi_change_pct)], ["Écart", fmt.pct(op.actual_kpi_change_pct - op.expected_kpi_change_pct)], ["Date de revue", op.review_date ? fmt.date(op.review_date) : fmt.date(addMonths(op.decision_date, 3)) + " (décision + 3 mois)"], ["Enseignements / notes", op.decision_notes]] as Array<[string, string]>).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)]))), () => { c.s.m.decOpen = ""; c.rerender(); }, { icon: "Scale" }); }
    const form = c.s.m.decForm as Row | undefined;
    if (form) {
        const close = (): void => { c.s.m.decForm = undefined; c.rerender(); };
        const bind = (k: string): (x: string) => void => (x: string): void => { form[k] = x; };
        modal(c.overlay, "Enregistrer une décision", h("div", null, sessionTag(c.persisted), formGrid([
            { label: "Type", el: select(opts(uniq(c.d.decisions, "decision_type")), form.decision_type, bind("decision_type")) },
            { label: "Impact attendu (TND)", el: input(form.expected_impact_tnd, bind("expected_impact_tnd"), "", "number") },
            { label: "Variation attendue du KPI (%)", el: input(form.expected_kpi_change_pct, bind("expected_kpi_change_pct"), "", "number") },
            { label: "Date de revue", el: input(form.review, bind("review"), "", "date") },
            { label: "Hypothèse / notes", el: input(form.decision_notes, bind("decision_notes"), "Pourquoi nous attendons cet impact"), wide: true }])), [btn("Annuler", { onClick: close }), btn("Enregistrer", { kind: "primary", icon: "Save", onClick: () => {
                const id = nextId(c.d.decisions, "decision_id", "DEC", 4);
                c.store.add("decisions", { decision_id: id, decision_date: c.ix.ref, decision_type: form.decision_type, department_id: c.ec.dept || c.d.departments[0]?.department_id, decision_owner_id: c.d.employees[0]?.employee_id, decision_status: "Proposé", expected_impact_tnd: Number(form.expected_impact_tnd) || 0, expected_kpi_change_pct: (Number(form.expected_kpi_change_pct) || 0) / 100, actual_kpi_change_pct: 0, decision_notes: form.decision_notes || "Nouvelle décision", review_date: form.review }, "Décisions", `${id} enregistrée`);
                c.toast(`${id} enregistrée (Proposé)`); close();
            } })], close, "Scale");
    }
}

// ======================================================================== Notifications (2)
const MODULE_ROUTE: Record<string, string> = { "Centre de commande": "command", "Tableau des dossiers": "queue", "Radar des risques": "risk", "Docteur des données": "doctor", "Laboratoire de scénarios": "whatif", "Gestionnaire de tâches": "tasks", "Calendrier": "calendar", "Approbations": "approvals", "Missions": "missions", "Enquêteur": "detective" };
function notifList(c: Ctx, compact: boolean): HTMLElement {
    const f = c.m<Record<string, string>>("notifF", () => ({ state: "", category: "", severity: "" }));
    const rows = c.d.notifications.filter(n => (!f.state || n.read_status === f.state) && (!f.category || n.notification_category === f.category) && (!f.severity || n.severity === f.severity)).sort((a, b) => b.notification_date.localeCompare(a.notification_date));
    const wrap = h("div", "mc-notif");
    const fb = h("div", "mc-filters");
    fb.appendChild(tabs(["", "Non lu", "Lu", "Archivé"].map(s2 => ({ id: s2, label: s2 || "Tous", count: s2 ? c.d.notifications.filter(n => n.read_status === s2).length : c.d.notifications.length })), f.state, v => { f.state = v; c.rerender(); }));
    if (!compact) { fb.appendChild(select(opts(uniq(c.d.notifications, "notification_category")), f.category, v => { f.category = v; c.rerender(); }, "Catégorie", "Tous")); fb.appendChild(select(opts(uniq(c.d.notifications, "severity")), f.severity, v => { f.severity = v; c.rerender(); }, "Gravité", "Tous")); }
    fb.appendChild(btn("Tout marquer comme lu", { small: true, icon: "CheckCheck", onClick: () => { rows.filter(n => n.read_status === "Non lu").forEach(n => c.store.change("notifications", n.notification_id, { read_status: "Lu" }, "Notifications", `${n.notification_id} lue`)); c.rerender(); } }));
    wrap.appendChild(fb);
    rows.slice(0, compact ? 30 : 120).forEach(n => {
        const route = MODULE_ROUTE[n.source_module];
        wrap.appendChild(h("div", `mc-notif-row mc-notif-${n.read_status.toLowerCase()}`,
            h("span", `mc-sev-dot mc-bg-${sevTone(n.severity)}`), h("div", "mc-grow", h("div", null, h("b", null, n.notification_category), " · ", n.notification_message), h("div", "mc-small mc-muted", `${fmt.date(n.notification_date)} · ${n.severity} · ${n.source_module} · pour ${c.ix.empName(n.recipient_employee_id)}`)),
            route ? btn(n.action_type || "Ouvrir", { small: true, kind: "ghost", icon: "ArrowUpRight", onClick: () => { c.store.change("notifications", n.notification_id, { read_status: "Lu" }, "Notifications", `${n.notification_id} ouverte`); c.s.notifOpen = false; c.go(route); } }) : null,
            iconBtn(n.read_status === "Non lu" ? "MailOpen" : "Mail", n.read_status === "Non lu" ? "Marquer comme lu" : "Marquer comme non lu", () => { c.store.change("notifications", n.notification_id, { read_status: n.read_status === "Non lu" ? "Lu" : "Non lu" }, "Notifications", n.notification_id); c.rerender(); }),
            iconBtn("Archive", "Archive", () => { c.store.change("notifications", n.notification_id, { read_status: "Archivé" }, "Notifications", `${n.notification_id} archivée`); c.rerender(); })));
    });
    if (!rows.length) { wrap.appendChild(empty("Aucune notification pour ces filtres.", "Inbox")); }
    return wrap;
}
export function notifications(c: Ctx, el: HTMLElement): void {
    title(el, "Centre de notifications", "Boîte de réception avec lu / non lu / archivé, filtres et liens vers le module source.", sessionTag(c.persisted));
    el.appendChild(notifList(c, false));
}
export function notifDrawer(c: Ctx, host: HTMLElement): void {
    drawer(host, "Notifications", h("div", null, sessionTag(c.persisted), notifList(c, true)), () => { c.s.notifOpen = false; c.rerender(); }, { icon: "Bell", width: 460, actions: [btn("Ouvrir le centre", { small: true, kind: "ghost", onClick: () => { c.s.notifOpen = false; c.go("notifications"); } })] });
}

// ======================================================================== Collaboration (18)
export function collab(c: Ctx, el: HTMLElement): void {
    const f = c.m<Record<string, string>>("colF", () => ({ type: "", item: "" }));
    const draft = c.m<Record<string, string>>("colDraft", () => ({ text: "", type: "Projet", ref: c.d.projects[0]?.project_id ?? "" }));
    title(el, "Collaboration d'équipe", "Commentaires contextuels sur n'importe quel élément, mentions @ avec saisie automatique. Une vraie collaboration en temps réel nécessiterait un service externe.", sessionTag(c.persisted));
    const items = c.d.collaboration_comments.filter(r => (!f.type || r.linked_item_type === f.type) && (!f.item || r.linked_item_reference === f.item)).sort((a, b) => b.comment_date.localeCompare(a.comment_date));
    const g = h("div", "mc-grid mc-g-collab"); el.appendChild(g);
    const threads = card("Discussions par élément", { icon: "MessagesSquare" });
    Array.from(groupBy(c.d.collaboration_comments, r => `${r.linked_item_type}|${r.linked_item_reference}`).entries()).sort((a, b) => b[1].length - a[1].length).slice(0, 30).forEach(([k, l]) => { const [t, r] = k.split("|"); const row = h("div", `mc-ins-row mc-click${f.item === r ? " mc-on" : ""}`, h("span", null, `${t} · ${r}`), chip(String(l.length), "muted")); row.onclick = (): void => { f.type = t; f.item = f.item === r ? "" : r; c.rerender(); }; threads.body.appendChild(row); });
    g.appendChild(threads.el);
    const feed = card(f.item ? `Discussion · ${f.type} ${f.item}` : "Tous les commentaires", { icon: "MessageSquare" });
    const ta = h("textarea", { class: "mc-input mc-textarea", placeholder: "Écrivez un commentaire… tapez @ pour mentionner quelqu'un", "data-focus": "col-text", "aria-label": "Commentaire" }) as HTMLTextAreaElement;
    ta.value = draft.text;
    const mention = h("div", "mc-mentions");
    const refresh = (): void => { const m = /@(\w*)$/.exec(ta.value); mention.replaceChildren(); if (m) { c.d.employees.filter(e => e.employee_name.toLowerCase().replace(/\s/g, "").includes(m[1].toLowerCase())).slice(0, 5).forEach(e => { const b = h("button", { type: "button", class: "mc-mention" }, `@${e.employee_name}`); b.onclick = (): void => { ta.value = ta.value.replace(/@(\w*)$/, `@${e.employee_name.replace(/\s/g, "")} `); draft.text = ta.value; refresh(); ta.focus(); }; mention.appendChild(b); }); } };
    ta.oninput = (): void => { draft.text = ta.value; refresh(); };
    feed.body.appendChild(h("div", "mc-composer", h("div", "mc-row-gap", select(opts(["Projet", "Tâche", "Risque", "Client", "Décision", "Incident", "KPI"]), draft.type, v => { draft.type = v; }, "Type d'élément lié"), h("label", "mc-field", h("span", "mc-field-label", "Référence de l'élément"), input(draft.ref, v => { draft.ref = v; }, "ex. PR001, T0010, RSK0003"))), ta, mention,
        btn("Publier le commentaire", { icon: "Send", kind: "primary", onClick: () => {
            if (!draft.text.trim()) { c.toast("Écrivez d'abord quelque chose", "info"); return; }
            const id = nextId(c.d.collaboration_comments, "comment_id", "COM", 4);
            c.store.add("collaboration_comments", { comment_id: id, comment_date: c.ix.ref, author_employee_id: c.d.employees[0]?.employee_id, linked_item_type: draft.type, linked_item_reference: draft.ref || "—", comment_text: draft.text.trim(), comment_type: /@\w/.test(draft.text) ? "Mention" : "Note" }, "Collaboration", `Commentaire ${id} sur ${draft.type} ${draft.ref}`);
            const mentions = draft.text.match(/@\w+/g) ?? []; draft.text = ""; c.toast(mentions.length ? `Commentaire publié · ${mentions.join(", ")} serait notifié (simulé)` : "Commentaire publié"); c.rerender();
        } })));
    items.slice(0, 40).forEach(r => feed.body.appendChild(h("div", "mc-comment", h("div", "mc-avatar-sm", c.ix.empName(r.author_employee_id).slice(0, 1)), h("div", "mc-grow", h("div", null, h("b", null, c.ix.empName(r.author_employee_id)), h("span", "mc-small mc-muted", ` · ${fmt.date(r.comment_date)} · ${r.comment_type} sur ${r.linked_item_type} ${r.linked_item_reference}`)), h("div", null, ...String(r.comment_text).split(/(@\w+)/).map(p2 => p2.startsWith("@") ? h("span", "mc-mention-tag", p2) : p2))))));
    if (!items.length) { feed.body.appendChild(empty("Aucun commentaire sur cet élément pour l'instant.", "MessageSquare")); }
    g.appendChild(feed.el);
}

// ======================================================================== Activity Audit Log (17)
export function audit(c: Ctx, el: HTMLElement): void {
    const f = c.m<Record<string, string>>("audF", () => ({ actor: "", module: "", action: "", result: "" }));
    title(el, "Journal d'audit des activités", "activity_log est un historique d'EXEMPLE, pas une piste d'audit inaltérable. Vos propres actions sont listées séparément ci-dessous.");
    const rows = c.d.activity_log.filter(r => (!f.actor || r.employee_id === f.actor) && (!f.module || r.module_name === f.module) && (!f.action || r.action_type === f.action) && (!f.result || r.result === f.result));
    const fb = h("div", "mc-filters");
    fb.appendChild(select(c.d.employees.map(e => ({ value: e.employee_id, label: e.employee_name })), f.actor, v => { f.actor = v; c.rerender(); }, "Acteur", "Tous"));
    ([["module", "Module", "module_name"], ["action", "Action", "action_type"], ["result", "Résultat", "result"]] as Array<[string, string, string]>).forEach(([k, l, col]) => fb.appendChild(select(opts(uniq(c.d.activity_log, col)), f[k], v => { f[k] = v; c.rerender(); }, l, "Tous")));
    el.appendChild(fb);
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const ch = card("Activité par mois", { icon: "ChartBar" }); const chEl = h("div", "mc-chart mc-h180"); ch.body.appendChild(chEl); g.appendChild(ch.el);
    const bm = groupBy(rows, r => month(r.activity_date)); const ms = Array.from(bm.keys()).sort();
    c.ch.stacked(chEl, ms.map(monthLabel), uniq(c.d.activity_log, "result").map((res, i) => ({ name: res, data: ms.map(m => (bm.get(m) ?? []).filter(r => r.result === res).length), color: [c.t.good, c.t.bad, c.t.warn, c.t.info][i % 4] })), v => fmt.int(v));
    const mine = card("Vos actions", { icon: "User", sub: c.persisted ? "enregistrées sur votre compte" : "session uniquement" });
    c.store.extras.log.slice(0, 12).forEach(l => mine.body.appendChild(h("div", "mc-tl-item", h("span", "mc-tl-date", l.time), h("span", null, `${l.module} · ${l.action} · ${l.detail}`))));
    if (!c.store.extras.log.length) { mine.body.appendChild(h("div", "mc-muted", "Aucune action pour l'instant. Créez une tâche, déplacez une carte ou changez un statut : elle apparaîtra ici.")); }
    g.appendChild(mine.el);
    const ts = c.m<TableState>("audTable", () => newTableState("activity_date", true, 14));
    el.appendChild(dataTable<Row>([
        { key: "activity_date", label: "Date", get: r => r.activity_date, render: r => fmt.date(r.activity_date) }, { key: "actor", label: "Acteur", get: r => c.ix.empName(r.employee_id) },
        { key: "action_type", label: "Action", get: r => r.action_type }, { key: "module_name", label: "Module", get: r => r.module_name },
        { key: "result", label: "Résultat", get: r => r.result, render: r => chip(r.result, r.result === "Succès" ? "good" : r.result === "Échec" ? "bad" : "warn") }, { key: "event_details", label: "Détails", get: r => r.event_details }
    ], rows, ts, () => c.rerender(), { id: "aud", chooser: true, onRow: r => { c.s.m.audOpen = r.activity_id; c.rerender(); } }));
    const op = c.s.m.audOpen ? c.d.activity_log.find(r => r.activity_id === c.s.m.audOpen) : undefined;
    if (op) { drawer(c.overlay, `Activité ${op.activity_id}`, h("dl", "mc-kv", ...Object.keys(op).flatMap(k => [h("dt", null, k.replace(/_/g, " ")), h("dd", null, k === "employee_id" ? `${op[k]} · ${c.ix.empName(op[k])}` : String(op[k]))])), () => { c.s.m.audOpen = ""; c.rerender(); }, { icon: "ScrollText" }); }
}
