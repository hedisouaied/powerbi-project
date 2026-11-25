"use strict";

/** Intelligence modules: AI Assistant (6), Business Detective (27), Network Graph (20), Risk Radar + anomalies (10),
 *  Root Cause (9), Forecast + KPI dependency graph, Target Profiles. Neutral language: "requires review", never "proves". */
import type { Ctx } from "../app";
import { prevKpis } from "../app";
import { Row } from "../core/data";
import { addMonths, anomalies, day, decomposeRevenue, forecast as runForecast, graph, groupBy, isRevenue, KPI_DEPS, kpis, month, monthLabel, monthRange, OPEN_RISK, path, revenueByMonth, riskByCategory, riskScore, sum, whatChanged, GEdge, GNode } from "../core/engine";
import { STATUS_TONE } from "../core/theme";
import { btn, card, chip, dataTable, empty, fmt, h, icon, iconBtn, input, newTableState, s, select, tabs, TableState } from "../core/ui";

const tone = (x: string): string => STATUS_TONE[x] ?? "muted";
const sevTone = (x: string): string => (x === "Critique" ? "bad" : x === "Élevée" ? "warn" : x === "Moyenne" ? "info" : "muted");
function title(el: HTMLElement, t: string, sub: string, ...extra: Node[]): void { el.appendChild(h("div", "mc-page-title", h("h1", null, t), h("span", "mc-muted", sub), h("div", "mc-row-gap mc-push", ...extra))); }

// ======================================================================== AI Assistant (6) — rule-based, adapter-ready
export interface Answer { text: string; cites: string[] }
/** Contract for a future secured integration. The visual must never hold API keys: a real adapter would call the
 *  customer's own backend proxy (declared in capabilities "WebAccess"), which holds the key server-side. */
export interface AssistantAdapter { readonly name: string; ask(question: string, ctx: { period: string; dept: string; selection: string | null }): Answer }
export class RuleBasedAssistant implements AssistantAdapter {
    public readonly name = "Assistant de démonstration — à base de règles";
    constructor(private readonly c: Ctx) { }
    public ask(q: string): Answer {
        const c = this.c, l = q.toLowerCase(), k = kpis(c.ix, c.ec), p = prevKpis(c);
        if (/change|month|compar|happen|performance|chang|mois|évolu|variation|passé/.test(l)) {
            const ch = whatChanged(k, p);
            return { text: `${c.ec.p.label} par rapport à la période précédente : ${ch.map(x => x.text).join(" ; ")}. CA net ${fmt.compact(k.netRevenue)}, marge brute ${fmt.pct(k.gm)}.`, cites: [`sales_orders (${k.orders} commandes sur la période)`, "sales_order_items (coût)", "Mesures : CA net, marge brute %"] };
        }
        if (/risk|department.*(open|highest)|exposure|risque|départements?.*(ouvert|plus)|exposition/.test(l) && !/customer|client|churn|attrition/.test(l)) {
            const byDept = Array.from(groupBy(c.d.risk_register.filter(r => OPEN_RISK.has(r.mitigation_status)), r => r.department_id).entries()).map(([d, rs]) => ({ d, n: rs.length, e: sum(rs, r => r.estimated_exposure_tnd) })).sort((a, b) => b.e - a.e);
            return { text: `Plus forte exposition aux risques ouverts : ${byDept.slice(0, 3).map(x => `${c.ix.deptName(x.d)} (${x.n} risques, ${fmt.compact(x.e)})`).join(", ")}. Ouvert = statut Ouvert ou En atténuation.`, cites: ["risk_register (mitigation_status, estimated_exposure_tnd)"] };
        }
        if (/margin|marge/.test(l)) {
            const cur = k.gm ?? 0, prev = p.gm ?? 0;
            const cats = groupBy(c.d.sales_order_items.filter(li => { const o = c.ix.order.get(li.order_id); return o && isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to; }), li => c.ix.prod.get(li.product_id)?.category ?? "—");
            const worst = Array.from(cats.entries()).map(([cat, ls]) => ({ cat, m: 1 - sum(ls, x => x.line_cost_tnd) / Math.max(1, sum(ls, x => x.net_line_amount_tnd)) })).sort((a, b) => a.m - b.m)[0];
            return { text: `La marge brute est de ${fmt.pct(cur)} contre ${fmt.pct(prev)} sur la période précédente (${cur >= prev ? "en hausse" : "en baisse"} de ${(Math.abs(cur - prev) * 100).toFixed(1).replace(".", ",")} pts). Catégorie à plus faible marge : ${worst?.cat} (${fmt.pct(worst?.m)}). Remises accordées : ${fmt.compact(k.discount)}. C'est une décomposition, pas une preuve de cause.`, cites: ["sales_order_items (net_line_amount, line_cost, discount_rate)", "products (category)"] };
        }
        if (/customer.*risk|churn|at risk|at-risk|clients?.*risque|attrition|à risque/.test(l)) {
            const top = c.d.customers.filter(x => x.customer_status === "À risque").sort((a, b) => b.annual_contract_value_tnd - a.annual_contract_value_tnd).slice(0, 5);
            return { text: `${k.atRiskCustomers} clients ont le statut À risque. Plus gros contrats : ${top.map(x => `${x.customer_name} (${fmt.compact(x.annual_contract_value_tnd)}, ${x.region})`).join(", ")}.`, cites: ["customers (customer_status, annual_contract_value_tnd)"] };
        }
        if (/investigat|next|anomal|suspic|unusual|examiner|enquêt|priorit|inhabituel/.test(l)) {
            const an = anomalies(c.ix).slice(0, 3);
            return { text: `Commencez par : ${an.map(a => `${a.rule} sur ${a.record} (${a.evidence})`).join(" ; ")}. Ce sont des situations inhabituelles à vérifier, pas des conclusions.`, cites: an.map(a => `${a.table} ${a.record}`) };
        }
        if (/collect|payment|overdue|cash|encaiss|paiement|retard|trésorerie/.test(l)) {
            return { text: `Taux d'encaissement ${fmt.pct(k.collectionRate)} : ${fmt.compact(k.paid)} encaissés, ${fmt.compact(k.outstanding)} restant dus, ${fmt.compact(k.overdue)} en retard sur ${k.overdueCount} paiements.`, cites: ["payments (payment_status, amount_tnd)"] };
        }
        if (/revenue|sales|chiffre d'affaires|\bca\b|ventes/.test(l)) {
            return { text: `CA net sur ${c.ec.p.label} : ${fmt.compact(k.netRevenue)} sur ${k.revenueOrders} commandes (panier moyen ${fmt.compact(k.aov)}). Période précédente : ${fmt.compact(p.netRevenue)}.`, cites: ["sales_orders (Terminé + En traitement)"] };
        }
        return { text: "Je ne peux répondre qu'aux questions que les données permettent. Essayez : qu'est-ce qui a changé ce mois-ci, quels départements ont le plus de risques ouverts, explique la baisse de marge, quels clients sont à risque, que dois-je examiner en priorité, où en sont les encaissements.", cites: [] };
    }
}
export function assistant(c: Ctx, el: HTMLElement): void {
    const bot = new RuleBasedAssistant(c);
    const pending = c.s.m.ask as string | undefined;
    if (pending) { c.s.m.ask = undefined; c.s.assistant.push({ who: "user", text: pending }); const a = bot.ask(pending); c.s.assistant.push({ who: "bot", text: a.text, cites: a.cites }); }
    title(el, "Assistant IA métier", "Les réponses viennent de règles déterministes sur les indicateurs — aucun modèle d'IA externe n'est appelé.", chip(bot.name, "info"));
    const g = h("div", "mc-grid mc-g-assist"); el.appendChild(g);
    const conv = card("Conversation", { icon: "Bot", sub: `Contexte : ${c.ec.p.label}${c.ec.dept ? " · " + c.ix.deptName(c.ec.dept) : ""}${c.s.selection ? ` · sélection ${c.s.selection.type} ${c.s.selection.id}` : ""}` });
    const log = h("div", "mc-chat");
    if (!c.s.assistant.length) { log.appendChild(empty("Posez une question ou choisissez une suggestion.", "Sparkles")); }
    c.s.assistant.forEach(m => log.appendChild(h("div", `mc-chat-bubble mc-chat-${m.who}`, m.text, m.cites?.length ? h("div", "mc-cite", icon("Quote", 11), "Sources : " + m.cites.join(" · ")) : null)));
    conv.body.appendChild(log);
    const ask = (q: string): void => { if (!q.trim()) { return; } c.s.assistant.push({ who: "user", text: q }); const a = bot.ask(q); c.s.assistant.push({ who: "bot", text: a.text, cites: a.cites }); c.rerender(); };
    const inp = h("input", { class: "mc-input", placeholder: "Questions sur le CA, la marge, les risques, les clients, les encaissements…", "data-focus": "assistant", "aria-label": "Question" }) as HTMLInputElement;
    inp.onkeydown = (e: KeyboardEvent): void => { if (e.key === "Enter") { ask(inp.value); } };
    conv.body.appendChild(h("div", "mc-chat-input", inp, iconBtn("Send", "Send", () => ask(inp.value)), iconBtn("Trash", "Effacer la conversation", () => { c.s.assistant = []; c.rerender(); })));
    g.appendChild(conv.el);
    const side = card("Questions suggérées", { icon: "Lightbulb" });
    ["Qu'est-ce qui a changé ce mois-ci ?", "Quels départements ont le plus de risques ouverts ?", "Explique la baisse de marge", "Quels clients sont à risque ?", "Que dois-je examiner en priorité ?", "Où en sont les encaissements ?"].forEach(q => { const b = h("button", { class: "mc-suggest", type: "button" }, q); b.onclick = (): void => ask(q); side.body.appendChild(b); });
    side.body.appendChild(h("div", "mc-ins-section", h("div", "mc-ins-title", "Prêt pour l'intégration (désactivé)"), h("div", "mc-small mc-muted", "Un vrai modèle se brancherait via l'interface AssistantAdapter, en appelant VOTRE proxy côté Laravel (qui garde la clé API sur le serveur). Les clés ne sont jamais envoyées au navigateur. Voir Paramètres › Intégrations.")));
    g.appendChild(side.el);
    window.setTimeout(() => { log.scrollTop = log.scrollHeight; }, 0);
}

// ======================================================================== graph rendering (shared by Detective and Network)
function layout(nodes: GNode[], edges: GEdge[], w: number, hgt: number, iterations = 160): Map<string, { x: number; y: number }> {
    const pos = new Map<string, { x: number; y: number }>(); const n = nodes.length;
    nodes.forEach((nd, i) => { const a = (i / Math.max(1, n)) * Math.PI * 2; pos.set(nd.id, { x: w / 2 + Math.cos(a) * w * 0.35 + ((i * 37) % 11), y: hgt / 2 + Math.sin(a) * hgt * 0.35 + ((i * 53) % 13) }); });
    const k = Math.sqrt((w * hgt) / Math.max(1, n));
    for (let it = 0; it < iterations; it++) {
        const disp = new Map<string, { x: number; y: number }>(); nodes.forEach(nd => disp.set(nd.id, { x: 0, y: 0 }));
        for (let i = 0; i < n; i++) { for (let j = i + 1; j < n; j++) { const a = pos.get(nodes[i].id)!, b = pos.get(nodes[j].id)!; let dx = a.x - b.x, dy = a.y - b.y; const d = Math.max(0.01, Math.hypot(dx, dy)); const f = (k * k) / d; dx /= d; dy /= d; disp.get(nodes[i].id)!.x += dx * f; disp.get(nodes[i].id)!.y += dy * f; disp.get(nodes[j].id)!.x -= dx * f; disp.get(nodes[j].id)!.y -= dy * f; } }
        edges.forEach(e => { const a = pos.get(e.s), b = pos.get(e.t); if (!a || !b) { return; } let dx = a.x - b.x, dy = a.y - b.y; const d = Math.max(0.01, Math.hypot(dx, dy)); const f = (d * d) / k; dx /= d; dy /= d; disp.get(e.s)!.x -= dx * f; disp.get(e.s)!.y -= dy * f; disp.get(e.t)!.x += dx * f; disp.get(e.t)!.y += dy * f; });
        nodes.forEach(nd => { const p = pos.get(nd.id)!, dd = disp.get(nd.id)!; dd.x -= (p.x - w / 2) * k * 0.04; dd.y -= (p.y - hgt / 2) * k * 0.06; }); // gravity keeps disconnected parts off the borders
        const temp = (w / 10) * (1 - it / iterations);
        nodes.forEach(nd => { const p = pos.get(nd.id)!, dd = disp.get(nd.id)!; const l = Math.max(0.01, Math.hypot(dd.x, dd.y)); p.x += (dd.x / l) * Math.min(l, temp); p.y += (dd.y / l) * Math.min(l, temp); });
    }
    // fit the free layout into the view box (no clamping, so nothing piles up on the borders)
    const xs = Array.from(pos.values()).map(p => p.x), ys = Array.from(pos.values()).map(p => p.y);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    pos.forEach(p => { p.x = 30 + ((p.x - x0) / Math.max(1, x1 - x0)) * (w - 140); p.y = 22 + ((p.y - y0) / Math.max(1, y1 - y0)) * (hgt - 44); });
    return pos;
}
export const TYPE_COLOR: Record<string, string> = { "Client": "accent", "Produit": "teal", "Fournisseur": "warn", "Employé": "info", "Département": "good", "Projet": "violet", "Commande": "soft", Incident: "bad" };
export function drawGraph(c: Ctx, host: HTMLElement, nodes: GNode[], edges: GEdge[], opts: { focus?: string; pathIds?: string[]; onNode?: (id: string) => void; w?: number; h?: number; animate?: boolean }): void {
    const w = opts.w ?? 760, hg = opts.h ?? 420;
    const pos = layout(nodes, edges, w, hg);
    const svg = s("svg", { viewBox: `0 0 ${w} ${hg}`, class: "mc-graph", role: "img", "aria-label": "Graphe des relations" });
    const neigh = new Set<string>(); if (opts.focus) { edges.forEach(e => { if (e.s === opts.focus) { neigh.add(e.t); } if (e.t === opts.focus) { neigh.add(e.s); } }); }
    const onPath = new Set(opts.pathIds ?? []);
    const pathEdge = (e: GEdge): boolean => { const p = opts.pathIds ?? []; for (let i = 0; i < p.length - 1; i++) { if ((p[i] === e.s && p[i + 1] === e.t) || (p[i] === e.t && p[i + 1] === e.s)) { return true; } } return false; };
    edges.forEach(e => { const a = pos.get(e.s), b = pos.get(e.t); if (!a || !b) { return; } const hot = pathEdge(e) || (opts.focus && (e.s === opts.focus || e.t === opts.focus)); svg.appendChild(s("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `mc-edge${hot ? " mc-edge-hot" : ""}${e.basis.includes("synthétique") ? " mc-edge-weak" : ""}${opts.animate !== false && hot ? " mc-edge-flow" : ""}`, "stroke-width": String(0.6 + e.strength * 2.4) }, s("title", {}, document.createTextNode(`${e.type} · force ${e.strength} · ${e.basis}`) as any))); });
    nodes.forEach(nd => {
        const p = pos.get(nd.id)!; const dim = opts.focus && nd.id !== opts.focus && !neigh.has(nd.id) && !onPath.has(nd.id);
        const g = s("g", { class: `mc-node mc-fill-${TYPE_COLOR[nd.type] ?? "muted"}${nd.id === opts.focus ? " mc-node-focus" : ""}${dim ? " mc-node-dim" : ""}${onPath.has(nd.id) ? " mc-node-path" : ""}`, transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`, tabindex: "0", role: "button", "aria-label": `${nd.type} ${nd.label}` });
        g.appendChild(s("circle", { r: String(4 + Math.min(10, nd.degree * 1.3)) }));
        if (nd.degree > 4 || nd.id === opts.focus || neigh.has(nd.id) || onPath.has(nd.id)) { const t = s("text", { x: "10", y: "4" }); t.textContent = nd.label; g.appendChild(t); }
        g.addEventListener("click", () => opts.onNode?.(nd.id)); g.addEventListener("keydown", (e: Event) => { if ((e as KeyboardEvent).key === "Enter") { opts.onNode?.(nd.id); } });
        svg.appendChild(g);
    });
    host.appendChild(svg);
    host.appendChild(h("div", "mc-legend", ...Object.keys(TYPE_COLOR).map(t => h("span", null, h("i", `mc-dot-legend mc-bg-${TYPE_COLOR[t]}`), t)), h("span", null, "— plein : vérifié par clé source · pointillé : lien analytique synthétique")));
}

// ======================================================================== Network Graph (20)
export function network(c: Ctx, el: HTMLElement): void {
    const all = graph(c.ix);
    const f = c.m<Record<string, any>>("netF", () => ({ types: Object.keys(TYPE_COLOR), rel: "", minStrength: 0, focus: "", from: "", to: "" }));
    title(el, "Graphe de réseau interactif", "entity_relationships sous forme de graphe · filtrez les types et la force des relations, centrez un nœud pour voir ses voisins, trouvez des chemins.");
    const edges = all.edges.filter(e => e.strength >= f.minStrength && (!f.rel || e.type === f.rel) && f.types.includes(e.s.split(":")[0]) && f.types.includes(e.t.split(":")[0]));
    const used = new Set(edges.flatMap(e => [e.s, e.t]));
    let nodes = all.nodes.filter(n => used.has(n.id));
    let shownEdges = edges;
    if (f.focus) { const keep = new Set([f.focus]); edges.forEach(e => { if (e.s === f.focus) { keep.add(e.t); } if (e.t === f.focus) { keep.add(e.s); } }); edges.forEach(e => { if (keep.has(e.s) && keep.has(e.t)) { /* ok */ } }); shownEdges = edges.filter(e => keep.has(e.s) || keep.has(e.t)); const keep2 = new Set(shownEdges.flatMap(e => [e.s, e.t])); nodes = nodes.filter(n => keep2.has(n.id)); }
    else if (nodes.length > 140) { const top = new Set(nodes.slice().sort((a, b) => b.degree - a.degree).slice(0, 140).map(n => n.id)); nodes = nodes.filter(n => top.has(n.id)); shownEdges = edges.filter(e => top.has(e.s) && top.has(e.t)); }
    const pth = f.from && f.to ? path(edges, f.from, f.to) : [];
    if (pth.length) { const keep = new Set([...nodes.map(n => n.id), ...pth]); nodes = all.nodes.filter(n => keep.has(n.id)); shownEdges = edges.filter(e => keep.has(e.s) && keep.has(e.t)); }
    const fb = h("div", "mc-filters");
    Object.keys(TYPE_COLOR).forEach(t => { const cb = h("input", { type: "checkbox" }) as HTMLInputElement; cb.checked = f.types.includes(t); cb.onchange = (): void => { f.types = cb.checked ? f.types.concat(t) : f.types.filter((x: string) => x !== t); c.rerender(); }; fb.appendChild(h("label", "mc-check", cb, h("i", `mc-dot-legend mc-bg-${TYPE_COLOR[t]}`), t)); });
    fb.appendChild(select(Array.from(new Set(all.edges.map(e => e.type))).sort().map(v => ({ value: v, label: v })), f.rel, v => { f.rel = v; c.rerender(); }, "Relation", "Tous"));
    fb.appendChild(select([0, 0.3, 0.5, 0.7, 0.9].map(v => ({ value: String(v), label: `≥ ${v}` })), String(f.minStrength), v => { f.minStrength = Number(v); c.rerender(); }, "Force"));
    if (f.focus) { fb.appendChild(btn("Retirer le focus", { small: true, icon: "X", onClick: () => { f.focus = ""; c.rerender(); } })); }
    el.appendChild(fb);
    const g = h("div", "mc-grid mc-g-graph"); el.appendChild(g);
    const gc = card(`Graphe · ${nodes.length} nœuds · ${shownEdges.length} liens${!f.focus && all.nodes.length > 140 ? " (140 premiers par degré)" : ""}`, { icon: "Network" });
    drawGraph(c, gc.body, nodes, shownEdges, { focus: f.focus, pathIds: pth, onNode: id => { f.focus = f.focus === id ? "" : id; c.rerender(); }, animate: !c.reduced });
    g.appendChild(gc.el);
    const side = h("div", "mc-col");
    const pf = card("Explorateur de chemins", { icon: "Route", sub: "Plus court chemin (toutes directions)" });
    const nodeOpts = all.nodes.slice().sort((a, b) => a.label.localeCompare(b.label)).map(n => ({ value: n.id, label: `${n.type} · ${n.label}` }));
    pf.body.appendChild(select(nodeOpts, f.from, v => { f.from = v; c.rerender(); }, "De", "—")); pf.body.appendChild(select(nodeOpts, f.to, v => { f.to = v; c.rerender(); }, "À", "—"));
    if (f.from && f.to) { pf.body.appendChild(pth.length ? h("div", "mc-path", ...pth.map((id, i) => h("span", null, i ? " → " : "", chip(all.nodes.find(n => n.id === id)?.label ?? id, TYPE_COLOR[id.split(":")[0]] ?? "muted")))) : h("div", "mc-muted", "Aucun chemin entre ces nœuds avec les filtres actuels.")); }
    side.appendChild(pf.el);
    const ev = card(f.focus ? "Éléments pour le nœud sélectionné" : "Liste des nœuds accessible au clavier", { icon: "ListChecks" });
    if (f.focus) {
        const es = all.edges.filter(e => e.s === f.focus || e.t === f.focus);
        es.forEach(e => { const other = e.s === f.focus ? e.t : e.s; const r = h("div", "mc-ins-row mc-click", h("span", null, `${e.type} → ${all.nodes.find(n => n.id === other)?.label}`), h("span", "mc-small mc-muted", `${e.strength} · ${e.basis}`)); r.onclick = (): void => { f.focus = other; c.rerender(); }; ev.body.appendChild(r); });
        ev.body.appendChild(h("div", "mc-small mc-muted", "Les liens sont des relations analytiques ; ils ne prouvent aucune faute."));
    } else { nodes.slice().sort((a, b) => b.degree - a.degree).slice(0, 30).forEach(n => { const r = h("button", { class: "mc-ins-row mc-click", type: "button" }, h("span", null, `${n.type} · ${n.label}`), chip(`${n.degree} liens`, "muted")); r.onclick = (): void => { f.focus = n.id; c.rerender(); }; ev.body.appendChild(r); }); }
    side.appendChild(ev.el); g.appendChild(side);
}

// ======================================================================== Business Detective (27)
export function detective(c: Ctx, el: HTMLElement): void {
    const caseId = c.m<string>("caseId", () => "DEMO");
    const notes = c.m<Record<string, string[]>>("caseNotes", () => ({}));
    const evState = c.m<Record<string, string>>("evState", () => ({}));
    title(el, "Détective métier", "Dossiers d'enquête, tableau des preuves, chemins de relations et chronologie. Langage neutre : les situations sont « à vérifier ».", chip("Données de démonstration synthétiques", "info"));
    const list = card("Dossiers", { icon: "FolderSearch" });
    const demo = h("button", { class: `mc-ins-row mc-click${caseId === "DEMO" ? " mc-on" : ""}`, type: "button" }, h("span", null, h("b", null, "DÉMO · anomalie de montant de la commande O00004")), chip("Scénario", "info")); demo.onclick = (): void => { c.s.m.caseId = "DEMO"; c.rerender(); }; list.body.appendChild(demo);
    const ts = c.m<TableState>("caseTable", () => newTableState("severity", false, 8));
    list.body.appendChild(dataTable<Row>([{ key: "case_id", label: "Dossier", get: r => r.case_id }, { key: "case_type", label: "Type", get: r => r.case_type }, { key: "severity", label: "Grav.", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) }, { key: "case_status", label: "Statut", get: r => r.case_status, render: r => chip(c.s.m[`cs_${r.case_id}`] ?? r.case_status, tone(c.s.m[`cs_${r.case_id}`] ?? r.case_status)) }], c.d.investigation_cases, ts, () => c.rerender(), { onRow: r => { c.s.m.caseId = r.case_id; c.rerender(); }, active: r => r.case_id === caseId, id: "cases" }));
    const main = h("div", "mc-col");
    el.appendChild(h("div", "mc-grid mc-g-detective", list.el, main));
    if (caseId === "DEMO") {
        const o = c.ix.order.get("O00004"); if (!o) { main.appendChild(empty("La commande O00004 n'est pas dans les données.")); return; }
        const cust = o.customer_id, pay = c.ix.payByOrder.get("O00004");
        const ords = c.d.sales_orders.filter(x => x.customer_id === cust);
        const inter = c.d.customer_interactions.filter(x => x.customer_id === cust);
        const head = card("Dossier DÉMO · commande O00004 — anomalie de montant", { icon: "ScanSearch", sub: "Construit à partir des données à la volée. Jeu de données synthétique." });
        head.body.appendChild(h("div", null, `La commande O00004 de ${c.ix.custName(cust)} indique un montant brut de ${fmt.money2(o.gross_amount_tnd)} alors que net + taxe = ${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)}. Le paiement enregistré est de ${pay ? `${fmt.money2(pay.amount_tnd)} (${pay.payment_status})` : "absent"}. C'est une situation inhabituelle à vérifier. Une erreur de saisie ou d'intégration est une explication possible ; les données seules n'établissent ni la cause ni une intention.`));
        main.appendChild(head.el);
        const board = card("Tableau des preuves", { icon: "LayoutGrid", sub: "Glissez les cartes entre les colonnes (session)" });
        const evid = [
            { id: "e1", t: "Fiche commande", d: `brut ${fmt.money2(o.gross_amount_tnd)} ≠ net ${fmt.money2(o.net_amount_tnd)} + taxe ${fmt.money2(o.tax_amount_tnd)}`, src: "sales_orders O00004" },
            { id: "e2", t: "Lignes de commande", d: `${(c.ix.linesByOrder.get("O00004") ?? []).length} lignes totalisant ${fmt.money2(sum(c.ix.linesByOrder.get("O00004") ?? [], l => l.net_line_amount_tnd))} — cohérent avec le net`, src: "sales_order_items" },
            { id: "e3", t: "Paiement", d: pay ? `${pay.payment_status} ${fmt.money2(pay.amount_tnd)} le ${fmt.date(pay.payment_date)} — ${Math.abs(pay.amount_tnd - o.gross_amount_tnd) < Math.abs(pay.amount_tnd - o.net_amount_tnd - o.tax_amount_tnd) ? `plus proche du brut enregistré (${fmt.money2(o.gross_amount_tnd)}) que de net + taxe (${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)})` : `plus proche de net + taxe (${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)}) que du brut enregistré (${fmt.money2(o.gross_amount_tnd)})`}` : "aucun paiement", src: `payments ${pay?.payment_id ?? ""}` },
            { id: "e4", t: "Historique du client", d: `${ords.length} commandes, brut médian ${fmt.money2(ords.map(x => x.gross_amount_tnd).sort((a, b) => a - b)[Math.floor(ords.length / 2)] ?? 0)}`, src: "sales_orders (client)" },
            { id: "e5", t: "Interactions", d: `${inter.length} interactions, ${inter.filter(i => i.interaction_status === "Escaladé").length} escalated`, src: "customer_interactions" }
        ];
        const cols = ["Non examiné", "Examiné", "Signalé"]; const bd = h("div", "mc-kanban mc-kanban-3");
        cols.forEach(col => { const lane = h("div", "mc-lane", h("div", "mc-lane-head", col)); lane.ondragover = (e: DragEvent): void => { e.preventDefault(); lane.classList.add("mc-drop"); }; lane.ondragleave = (): void => lane.classList.remove("mc-drop"); lane.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain") ?? ""; evState[id] = col; c.store.audit("Détective", "Preuve déplacée", `${id} → ${col}`); c.rerender(); };
            evid.filter(x => (evState[x.id] ?? "Non examiné") === col).forEach(x => { const k = h("div", { class: "mc-kcard", draggable: "true", tabindex: 0 }, h("b", null, x.t), h("div", "mc-small", x.d), h("div", "mc-small mc-muted", x.src)); k.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", x.id); }; lane.appendChild(k); }); bd.appendChild(lane); });
        board.body.appendChild(bd); main.appendChild(board.el);
        const tl = card("Chronologie de l'enquête", { icon: "Clock" });
        const items = [...ords.map(x => ({ d: x.order_date, t: `Commande ${x.order_id} · ${x.order_status} · ${fmt.compact(x.gross_amount_tnd)}`, hot: x.order_id === "O00004" })), ...ords.map(x => c.ix.payByOrder.get(x.order_id)).filter(Boolean).map(p => ({ d: (p as Row).payment_date, t: `Paiement ${(p as Row).payment_id} · ${(p as Row).payment_status}`, hot: (p as Row).order_id === "O00004" })), ...inter.map(i => ({ d: i.interaction_date, t: `${i.channel} ${i.interaction_type} · ${i.interaction_status}`, hot: false }))].sort((a, b) => a.d.localeCompare(b.d));
        tl.body.appendChild(h("div", "mc-timeline", ...items.slice(-14).map(x => h("div", `mc-tl-item${x.hot ? " mc-tone-bad" : ""}`, h("span", "mc-tl-date", fmt.date(x.d)), h("span", null, x.t))))); main.appendChild(tl.el);
        const gr = card("Chemin de relations", { icon: "Network", sub: "Voisinage du client dans le graphe" });
        const all = graph(c.ix); const focus = `Customer:${cust}`;
        const es = all.edges.filter(e => e.s === focus || e.t === focus); const ids = new Set([focus, ...es.flatMap(e => [e.s, e.t])]);
        if (es.length) { drawGraph(c, gr.body, all.nodes.filter(n => ids.has(n.id)), es, { focus, w: 620, h: 260, onNode: id => { c.s.m.netF = { types: Object.keys(TYPE_COLOR), rel: "", minStrength: 0, focus: id, from: "", to: "" }; c.go("network"); } }); } else { gr.body.appendChild(h("div", "mc-muted", "Ce client n'a aucun lien dans entity_relationships ; l'enquête s'appuie sur les enregistrements de transactions ci-dessus.")); }
        main.appendChild(gr.el);
    } else {
        const cs = c.d.investigation_cases.find(x => x.case_id === caseId); if (!cs) { main.appendChild(empty("Choisissez un dossier.")); return; }
        const st = c.s.m[`cs_${caseId}`] ?? cs.case_status;
        const head = card(`${cs.case_id} · ${cs.case_title}`, { icon: "ScanSearch", actions: [select(["Nouveau", "En investigation", "En attente de revue", "Clôturé"].map(v => ({ value: v, label: v })), st, v => { c.s.m[`cs_${caseId}`] = v; c.store.audit("Détective", "Statut du dossier", `${caseId} → ${v}`); c.toast(`${caseId} → ${v} (session)`); c.rerender(); }, "Statut")] });
        head.body.appendChild(h("dl", "mc-kv", ...([["Type", cs.case_type], ["Gravité", cs.severity], ["Responsable", c.ix.empName(cs.case_owner_employee_id)], ["Département", c.ix.deptName(cs.department_id)], ["Ouvert le", fmt.date(cs.opened_date)], ["Revue", cs.review_status], ["Synthèse", cs.case_summary]] as Array<[string, string]>).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
        main.appendChild(head.el);
        const ev = c.d.investigation_evidence.filter(e => e.case_id === caseId);
        const board = card(`Preuves (${ev.length})`, { icon: "LayoutGrid", sub: "Glissez pour reclasser (session). Les références sources sont synthétiques et peuvent ne correspondre à aucune ligne." });
        const cols = ["Non examiné", "Examiné", "Signalé"]; const bd = h("div", "mc-kanban mc-kanban-3");
        cols.forEach(col => { const lane = h("div", "mc-lane", h("div", "mc-lane-head", col)); lane.ondragover = (e: DragEvent): void => { e.preventDefault(); }; lane.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain") ?? ""; evState[id] = col; c.rerender(); };
            ev.filter(x => (evState[x.evidence_id] ?? x.evidence_status) === col).forEach(x => { const k = h("div", { class: "mc-kcard", draggable: "true", tabindex: 0 }, h("div", "mc-row-gap", h("b", null, x.evidence_type), chip(x.relevance_level, x.relevance_level === "Élevée" ? "warn" : "muted")), h("div", "mc-small", x.evidence_summary), h("div", "mc-small mc-muted", `${x.source_table} · ${x.source_record_reference} · ${fmt.date(x.evidence_date)}`)); k.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", x.evidence_id); }; lane.appendChild(k); }); bd.appendChild(lane); });
        board.body.appendChild(bd); main.appendChild(board.el);
        const tl = card("Chronologie", { icon: "Clock" });
        const items = [{ d: cs.opened_date, t: "Dossier ouvert" }, ...ev.map(e => ({ d: e.evidence_date, t: `${e.evidence_type} ajouté (${e.relevance_level})` })), ...c.d.incidents.filter(i => i.department_id === cs.department_id && day(i.incident_date) >= addMonths(cs.opened_date, -2).slice(0, 10) && day(i.incident_date) <= addMonths(cs.opened_date, 2).slice(0, 10)).slice(0, 5).map(i => ({ d: i.incident_date, t: `Incident du département ${i.incident_id} · ${i.incident_type}` }))].sort((a, b) => a.d.localeCompare(b.d));
        tl.body.appendChild(h("div", "mc-timeline", ...items.map(x => h("div", "mc-tl-item", h("span", "mc-tl-date", fmt.date(x.d)), h("span", null, x.t))))); main.appendChild(tl.el);
    }
    const nn = card("Notes du dossier (session)", { icon: "NotebookPen" }); const list2 = notes[caseId] ?? (notes[caseId] = []);
    list2.forEach(n => nn.body.appendChild(h("div", "mc-note", n)));
    const ni = input("", () => undefined, "Ajoutez une note neutre et factuelle…", "text", "case-note");
    nn.body.appendChild(h("div", "mc-chat-input", ni, iconBtn("Send", "Ajouter la note", () => { if (ni.value.trim()) { list2.push(ni.value.trim()); c.store.audit("Détective", "Note", caseId); c.rerender(); } })));
    main.appendChild(nn.el);
}

// ======================================================================== Risk Radar + Smart Anomaly Detection (10)
export function risk(c: Ctx, el: HTMLElement): void {
    const tab = c.m<string>("riskTab", () => "radar");
    title(el, "Radar des risques · détection d'anomalies", "Scores transparents avec preuves. Sélectionnez une catégorie pour filtrer le registre.");
    el.appendChild(tabs([{ id: "radar", label: "Radar des risques", icon: "Radar" }, { id: "anomalies", label: "Détection intelligente d'anomalies", icon: "ScanSearch", count: anomalies(c.ix).length }, { id: "alerts", label: "Alertes", icon: "Bell" }], tab, v => { c.s.m.riskTab = v; c.rerender(); }));
    if (tab === "radar") {
        const cats = riskByCategory(c.ix, c.ec.dept); const sel = c.m<string>("riskCat", () => "");
        const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
        const rc = card("Score des risques ouverts par catégorie", { icon: "Radar", sub: "score = 100 × severity weight × confidence × exposure factor (0.3 + 0.7 × log-scaled exposure) · averaged over open risks" }); const chEl = h("div", "mc-chart mc-h300"); rc.body.appendChild(chEl); g.appendChild(rc.el);
        c.ch.radar(chEl, cats.map(x => ({ name: x.cat, max: 100 })), [{ name: "Score ouvert moyen", values: cats.map(x => x.score) }]);
        const bc = card("Exposition par catégorie (cliquez pour filtrer)", { icon: "ChartBar" }); const bEl = h("div", "mc-chart mc-h300"); bc.body.appendChild(bEl); g.appendChild(bc.el);
        c.ch.bars(bEl, cats.map(x => ({ name: x.cat, value: x.exposure })), { horizontal: true, fmt: v => fmt.compact(v), selected: sel, onClick: p => { c.s.m.riskCat = c.s.m.riskCat === p.name ? "" : p.name; c.rerender(); } });
        const rs = c.d.risk_register.filter(r => (!sel || r.risk_category === sel) && (!c.ec.dept || r.department_id === c.ec.dept));
        const max = Math.max(1, ...c.d.risk_register.map(r => r.estimated_exposure_tnd));
        const ts = c.m<TableState>("riskTable", () => newTableState("score", true, 10));
        el.appendChild(h("div", "mc-row-gap", sel ? chip(`Catégorie : ${sel}`, "info") : null, sel ? btn("Effacer", { small: true, icon: "X", onClick: () => { c.s.m.riskCat = ""; c.rerender(); } }) : null));
        el.appendChild(dataTable<Row>([
            { key: "risk_id", label: "Risque", get: r => r.risk_id }, { key: "risk_category", label: "Catégorie", get: r => r.risk_category }, { key: "severity", label: "Gravité", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) },
            { key: "confidence_score", label: "Confiance", get: r => r.confidence_score, num: true, render: r => fmt.pct(r.confidence_score, 0) },
            { key: "estimated_exposure_tnd", label: "Exposition", get: r => r.estimated_exposure_tnd, num: true, render: r => fmt.compact(r.estimated_exposure_tnd) },
            { key: "score", label: "Score", get: r => riskScore(r, max).score, num: true, render: r => h("span", { class: "mc-score", title: riskScore(r, max).parts }, String(riskScore(r, max).score)) },
            { key: "owner", label: "Responsable", get: r => c.ix.empName(r.risk_owner_employee_id) }, { key: "mitigation_status", label: "Atténuation", get: r => r.mitigation_status, render: r => chip(r.mitigation_status, tone(r.mitigation_status)) }
        ], rs, ts, () => c.rerender(), { id: "risk", onRow: r => c.select("risk", r.risk_id) }));
    } else if (tab === "anomalies") {
        const an = anomalies(c.ix); const acks = new Set(c.store.extras.acks);
        el.appendChild(h("div", "mc-hint", icon("Info", 14), "Règles : brut ≠ net + taxe ; date promise avant la date de commande ; z-score > 3 sur le brut des commandes et par catégorie de dépense ; paiement Payé ≠ brut de la commande de plus de 25 % ; même client + jour + montant ; variation mensuelle du CA > 40 %. Les signalements sont à vérifier — ce ne sont pas des conclusions."));
        const ts = c.m<TableState>("anTable", () => newTableState("", false, 12));
        el.appendChild(dataTable<any>([
            { key: "severity", label: "Gravité", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) }, { key: "rule", label: "Règle", get: r => r.rule }, { key: "record", label: "Record", get: r => `${r.table} ${r.record}` },
            { key: "evidence", label: "Preuves", get: r => r.evidence }, { key: "explanation", label: "Pourquoi c'est important", get: r => r.explanation },
            { key: "ack", label: "Revue", get: r => (acks.has(r.id) ? "Pris en compte" : ""), render: r => btn(acks.has(r.id) ? "Pris en compte" : "Prendre en compte", { small: true, kind: acks.has(r.id) ? "ghost" : "soft", icon: acks.has(r.id) ? "Check" : "Eye", onClick: () => { c.store.toggle("acks", r.id, "Détection d'anomalies"); c.rerender(); } }) }
        ], an, ts, () => c.rerender(), { id: "an", onRow: r => { if (r.table === "sales_orders" && /^O\d+/.test(r.record)) { c.select("order", r.record); } } }));
    } else {
        const ts = c.m<TableState>("alTable", () => newTableState("alert_date", true, 14));
        el.appendChild(dataTable<Row>([{ key: "alert_id", label: "Alerte", get: r => r.alert_id }, { key: "alert_date", label: "Date", get: r => r.alert_date, render: r => fmt.date(r.alert_date) }, { key: "alert_type", label: "Type", get: r => r.alert_type }, { key: "severity", label: "Gravité", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) }, { key: "alert_status", label: "Statut", get: r => r.alert_status, render: r => chip(r.alert_status, tone(r.alert_status)) }, { key: "affected_area", label: "Domaine", get: r => r.affected_area }, { key: "confidence_score", label: "Confiance", get: r => r.confidence_score, num: true, render: r => fmt.pct(r.confidence_score, 0) }], c.d.alerts, ts, () => c.rerender(), { id: "al", chooser: true, onRow: r => c.select("alert", r.alert_id) }));
    }
}

// ======================================================================== Root Cause Analyzer (9)
export function rootcause(c: Ctx, el: HTMLElement): void {
    const dec = decomposeRevenue(c.ix, c.ec, c.prev);
    const dim = c.m<string>("rcDim", () => "Département");
    const member = c.m<string>("rcMember", () => "");
    title(el, "Analyse des causes racines", `Variation du CA net : ${c.ec.p.label} vs période précédente · les contributions sont arithmétiques, pas une preuve de causalité.`);
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const wf = card(`Pont · variation totale ${fmt.compact(dec.total)}`, { icon: "ChartBar", sub: "Effet volume = Δcommandes × panier moyen précédent · effet prix/mix = commandes actuelles × Δpanier moyen" }); const wEl = h("div", "mc-chart mc-h260"); wf.body.appendChild(wEl); g.appendChild(wf.el);
    const prevRev = kpis(c.ix, c.prev).netRevenue;
    c.ch.waterfall(wEl, [{ name: "Précédent", value: prevRev, total: true }, { name: "Volume", value: dec.priceVolume.volume }, { name: "Prix / mix", value: dec.priceVolume.price }, { name: "Actuel", value: prevRev + dec.total, total: true }], v => fmt.compact(v));
    const dims = ["Département", "Canal", "Région", "Segment", "Catégorie de produit"];
    const dr = card("Classement des facteurs", { icon: "GitBranch", actions: [select(dims.map(d => ({ value: d, label: d })), dim, v => { c.s.m.rcDim = v; c.s.m.rcMember = ""; c.rerender(); })] });
    const ds = dec.drivers.filter(d => d.dim === dim);
    const dEl = h("div", "mc-chart mc-h260"); dr.body.appendChild(dEl); g.appendChild(dr.el);
    c.ch.bars(dEl, ds.map(d => ({ name: d.member, value: d.delta, color: d.delta >= 0 ? c.t.good : c.t.bad })), { horizontal: true, fmt: v => fmt.compact(v), selected: member, onClick: p => { c.s.m.rcMember = p.name; c.rerender(); } });
    const top = dec.drivers.slice(0, 8);
    const tb = card("Principaux contributeurs, toutes dimensions", { icon: "ListChecks" });
    top.forEach(d => tb.body.appendChild(h("div", "mc-ins-row", h("span", null, `${d.dim}: ${d.member}`), h("span", "mc-small mc-muted", `${fmt.compact(d.prev)} → ${fmt.compact(d.cur)}`), h("b", d.delta >= 0 ? "mc-tone-good" : "mc-tone-bad", `${d.delta >= 0 ? "+" : ""}${fmt.compact(d.delta)}`))));
    el.appendChild(tb.el);
    if (member) {
        const key = (o: Row): string => dim === "Département" ? c.ix.deptName(c.ix.empDept(o.sales_owner_id)) : dim === "Canal" ? o.sales_channel : dim === "Région" ? (c.ix.cust.get(o.customer_id)?.region ?? "") : dim === "Segment" ? (c.ix.cust.get(o.customer_id)?.customer_segment ?? "") : "";
        const recs = c.d.sales_orders.filter(o => isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to && (dim === "Catégorie de produit" ? (c.ix.linesByOrder.get(o.order_id) ?? []).some(l => c.ix.prod.get(l.product_id)?.category === member) : key(o) === member));
        const ts = c.m<TableState>("rcTable", () => newTableState("net_amount_tnd", true, 10));
        const rc = card(`Chemin d'analyse : CA net › ${dim} › ${member} › commandes`, { icon: "Route", actions: [btn("Effacer", { small: true, icon: "X", onClick: () => { c.s.m.rcMember = ""; c.rerender(); } })] });
        rc.body.appendChild(dataTable<Row>([{ key: "order_id", label: "Commande", get: r => r.order_id }, { key: "order_date", label: "Date", get: r => r.order_date, render: r => fmt.date(r.order_date) }, { key: "cust", label: "Client", get: r => c.ix.custName(r.customer_id) }, { key: "net_amount_tnd", label: "Net", get: r => r.net_amount_tnd, num: true, render: r => fmt.money2(r.net_amount_tnd) }], recs, ts, () => c.rerender(), { id: "rc", onRow: r => c.select("order", r.order_id) }));
        el.appendChild(rc.el);
    }
}

// ======================================================================== Forecast + KPI dependency graph
export { forecast2 as forecast };
function forecast2(c: Ctx, el: HTMLElement): void {
    const metric = c.m<string>("fcMetric", () => "revenue");
    const months = monthRange(month(c.ix.first), month(addMonths(c.ix.ref, -1)));
    const rm = revenueByMonth(c.ix, c.ec.dept);
    const series = (k: string): Array<{ m: string; v: number }> => months.map(m => ({ m, v: k === "revenue" ? rm.get(m)?.net ?? 0 : k === "orders" ? rm.get(m)?.orders ?? 0 : k === "expenses" ? sum(c.d.expenses.filter(e => month(e.expense_date) === m && e.approval_status !== "Rejeté" && (!c.ec.dept || e.department_id === c.ec.dept)), e => e.amount_tnd) : c.d.customer_interactions.filter(i => month(i.interaction_date) === m).length }));
    const res = runForecast(series(metric), 3); const best = res.filter(r => r.mape !== null).sort((a, b) => (a.mape as number) - (b.mape as number))[0] ?? res[0];
    title(el, "Analyse prédictive · graphe des dépendances des KPI", `Mois complets uniquement (${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}) ; le mois en cours, incomplet, est exclu.`, chip("Référence statistique — pas de l'IA", "warn"));
    el.appendChild(tabs([["revenue", "Chiffre d'affaires"], ["orders", "Commandes"], ["expenses", "Dépenses"], ["interactions", "Interactions clients"]].map(([id, l]) => ({ id, label: l })), metric, v => { c.s.m.fcMetric = v; c.rerender(); }));
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const fc = card(`Réel vs prévision · meilleur backtest : ${best.method}`, { icon: "Telescope", sub: best.note }); const fEl = h("div", "mc-chart mc-h280"); fc.body.appendChild(fEl); g.appendChild(fc.el);
    const cats = [...best.history.map(x => monthLabel(x.m)), ...best.future.map(x => monthLabel(x.m))];
    const nH = best.history.length;
    c.ch.line(fEl, cats, [
        { name: "Réel", data: [...best.history.map(x => x.v), ...best.future.map(() => null)] },
        { name: `Ajusté (${best.method})`, data: [...best.fitted.map(x => x.v), ...best.future.map(() => null)], dashed: true, area: false },
        { name: "Prévision", data: [...Array(nH - 1).fill(null), best.history[nH - 1]?.v ?? null, ...best.future.map(x => x.v)], dashed: true, area: false, band: [[...Array(nH).fill(null), ...best.future.map(x => x.lo)] as number[], [...Array(nH).fill(null), ...best.future.map(x => x.hi)] as number[]] }
    ], undefined, v => (metric === "orders" || metric === "interactions" ? String(Math.round(v)) : c.ch.short(v)));
    const mt = card("Méthodologie et backtest", { icon: "FlaskConical" });
    res.forEach(r => mt.body.appendChild(h("div", `mc-ins-row${r === best ? " mc-on" : ""}`, h("span", null, h("b", null, r.method), h("div", "mc-small mc-muted", r.note.split(" Bande")[0])), h("span", null, `MAPE ${r.mape === null ? "n.d." : fmt.pct(r.mape)}`))));
    mt.body.appendChild(h("div", "mc-small mc-muted", "MAPE = moyenne |réel − ajusté| ÷ réel sur les mois où la méthode disposait d'assez d'historique. Bandes = ±1,96 × RMSE des résidus du backtest ; elles supposent des erreurs stables et restent indicatives. Limites : 22 mois de données synthétiques, aucun facteur externe, pas de test de saisonnalité."));
    mt.body.appendChild(h("div", "mc-stat-grid", ...best.future.map(f => h("div", "mc-stat", h("span", null, monthLabel(f.m)), h("b", null, metric === "orders" || metric === "interactions" ? fmt.int(f.v) : fmt.compact(f.v)), h("span", "mc-small mc-muted", `${metric === "orders" || metric === "interactions" ? fmt.int(f.lo) : fmt.compact(f.lo)} – ${metric === "orders" || metric === "interactions" ? fmt.int(f.hi) : fmt.compact(f.hi)}`)))));
    g.appendChild(mt.el);
    // KPI dependency graph
    const sel = c.m<string>("depSel", () => "margin");
    const cur = kpis(c.ix, c.ec), prev = kpis(c.ix, c.prev);
    const val: Record<string, [number | null, number | null, (v: number) => string]> = {
        orders: [cur.revenueOrders, prev.revenueOrders, fmt.int], revenue: [cur.netRevenue, prev.netRevenue, v => fmt.compact(v)], cost: [cur.cost, prev.cost, v => fmt.compact(v)], margin: [cur.gm, prev.gm, v => fmt.pct(v)],
        collections: [cur.collectionRate, prev.collectionRate, v => fmt.pct(v)], expenses: [cur.expenses, prev.expenses, v => fmt.compact(v)], opprofit: [cur.operatingProfit, prev.operatingProfit, v => fmt.compact(v)], discount: [cur.discount, prev.discount, v => fmt.compact(v)],
        incidents: [cur.openIncidents, prev.openIncidents, fmt.int], delivery: [cur.projectCompletion, prev.projectCompletion, v => fmt.pct(v)], churn: [c.d.customers.filter(x => x.customer_status === "Perdu").length / Math.max(1, c.d.customers.length), null, v => fmt.pct(v)],
        pricing: [cur.units ? (cur.netRevenue + cur.discount) / cur.units : null, prev.units ? (prev.netRevenue + prev.discount) / prev.units : null, v => fmt.money2(v)], mix: [null, null, () => "par catégorie"], inventory: [null, null, () => "voir le jumeau numérique"]
    };
    const up = new Set<string>(), down = new Set<string>();
    const walkUp = (id: string): void => { (KPI_DEPS.find(k => k.id === id)?.inputs ?? []).forEach(i => { if (!up.has(i)) { up.add(i); walkUp(i); } }); };
    const walkDown = (id: string): void => { KPI_DEPS.filter(k => k.inputs.includes(id)).forEach(k => { if (!down.has(k.id)) { down.add(k.id); walkDown(k.id); } }); };
    walkUp(sel); walkDown(sel);
    const dep = card("Graphe des dépendances des KPI", { icon: "Waypoints", sub: "Dépendances mathématiques (flèche = « sert au calcul de »), pas des liens de causalité · cliquez sur un KPI" });
    const layers = [["orders", "pricing", "mix", "incidents", "inventory", "expenses"], ["discount", "churn", "delivery", "cost"], ["revenue"], ["margin", "collections"], ["opprofit"]];
    const W = 900, H = 300, P: Record<string, { x: number; y: number }> = {};
    layers.forEach((l, i) => l.forEach((id, j) => { P[id] = { x: 70 + i * ((W - 140) / (layers.length - 1)), y: 30 + (j + 0.5) * ((H - 40) / l.length) }; }));
    const svg = s("svg", { viewBox: `0 0 ${W} ${H}`, class: "mc-depgraph" });
    KPI_DEPS.forEach(k => k.inputs.forEach(i => { const a = P[i], b = P[k.id]; if (!a || !b) { return; } const hot = (up.has(i) || i === sel) && (up.has(k.id) || k.id === sel) || (down.has(k.id) || k.id === sel) && (i === sel || down.has(i)); svg.appendChild(s("path", { d: `M${a.x + 55},${a.y} C${(a.x + b.x) / 2},${a.y} ${(a.x + b.x) / 2},${b.y} ${b.x - 55},${b.y}`, class: `mc-dep-edge${hot ? " mc-edge-hot mc-edge-flow" : ""}` })); }));
    KPI_DEPS.forEach(k => { const p = P[k.id]; if (!p) { return; } const v = val[k.id]; const g2 = s("g", { class: `mc-dep-node${k.id === sel ? " mc-on" : up.has(k.id) ? " mc-up" : down.has(k.id) ? " mc-down" : ""}`, transform: `translate(${p.x - 55},${p.y - 18})`, tabindex: "0", role: "button" });
        g2.appendChild(s("rect", { width: "110", height: "36", rx: "8" })); const t1 = s("text", { x: "55", y: "15", "text-anchor": "middle" }); t1.textContent = k.label; g2.appendChild(t1); const t2 = s("text", { x: "55", y: "29", "text-anchor": "middle", class: "mc-dep-val" }); t2.textContent = v && v[0] !== null ? v[2](v[0] as number) : "—"; g2.appendChild(t2);
        g2.addEventListener("click", () => { c.s.m.depSel = k.id; c.rerender(); }); svg.appendChild(g2); });
    dep.body.appendChild(svg);
    const why = KPI_DEPS.find(k => k.id === sel)!;
    dep.body.appendChild(h("div", "mc-why", h("b", null, `Pourquoi ${why.label} a-t-il varié ? `), `Formule : ${why.formula}. `, ...why.inputs.map(i => { const v = val[i]; return v && v[0] !== null && v[1] !== null ? h("span", null, `${KPI_DEPS.find(k => k.id === i)?.label}: ${v[2](v[1] as number)} → ${v[2](v[0] as number)}. `) : h("span", null, `${KPI_DEPS.find(k => k.id === i)?.label} : aucune valeur sur la période. `); }), h("span", "mc-muted", "Facteurs en amont en turquoise, impacts en aval en or.")));
    el.appendChild(dep.el);
}

// ======================================================================== Target Profiles
export function profiles(c: Ctx, el: HTMLElement): void {
    const tab = c.m<string>("profTab", () => "customers");
    title(el, "Profils cibles", "Client 360, fournisseurs, produits et départements · cliquez sur une ligne pour ouvrir la fiche.");
    el.appendChild(tabs([{ id: "customers", label: "Clients", icon: "Users", count: c.d.customers.length }, { id: "suppliers", label: "Fournisseurs", icon: "Truck", count: c.d.suppliers.length }, { id: "products", label: "Produits", icon: "Package", count: c.d.products.length }, { id: "departments", label: "Départements", icon: "Building", count: c.d.departments.length }], tab, v => { c.s.m.profTab = v; c.rerender(); }));
    const revBy = new Map<string, number>(); c.d.sales_orders.filter(isRevenue).forEach(o => revBy.set(o.customer_id, (revBy.get(o.customer_id) ?? 0) + o.net_amount_tnd));
    const ts = c.m<TableState>(`prof-${tab}`, () => newTableState("", false, 14));
    if (tab === "customers") { el.appendChild(dataTable<Row>([{ key: "customer_name", label: "Client", get: r => r.customer_name }, { key: "customer_segment", label: "Segment", get: r => r.customer_segment }, { key: "industry", label: "Secteur", get: r => r.industry }, { key: "region", label: "Région", get: r => r.region }, { key: "customer_status", label: "Statut", get: r => r.customer_status, render: r => chip(r.customer_status, tone(r.customer_status)) }, { key: "acv", label: "Valeur du contrat", get: r => r.annual_contract_value_tnd, num: true, render: r => fmt.compact(r.annual_contract_value_tnd) }, { key: "rev", label: "Chiffre d'affaires", get: r => revBy.get(r.customer_id) ?? 0, num: true, render: r => fmt.compact(revBy.get(r.customer_id) ?? 0) }], c.d.customers, ts, () => c.rerender(), { onRow: r => c.select("customer", r.customer_id), chooser: true, id: "pc" })); }
    if (tab === "suppliers") { el.appendChild(dataTable<Row>([{ key: "supplier_name", label: "Fournisseur", get: r => r.supplier_name }, { key: "supplier_category", label: "Catégorie", get: r => r.supplier_category }, { key: "country", label: "Pays", get: r => r.country }, { key: "risk_level", label: "Risque", get: r => r.risk_level, render: r => chip(r.risk_level, r.risk_level === "Élevée" ? "bad" : r.risk_level === "Moyenne" ? "warn" : "good") }, { key: "quality_rating", label: "Qualité", get: r => r.quality_rating, num: true }, { key: "supplier_status", label: "Statut", get: r => r.supplier_status, render: r => chip(r.supplier_status, tone(r.supplier_status)) }], c.d.suppliers, ts, () => c.rerender(), { onRow: r => c.select("supplier", r.supplier_id), id: "ps" })); }
    if (tab === "products") { const pr = new Map<string, { r: number; c: number }>(); c.d.sales_order_items.forEach(l => { if (isRevenue(c.ix.order.get(l.order_id) ?? {})) { const v = pr.get(l.product_id) ?? { r: 0, c: 0 }; v.r += l.net_line_amount_tnd; v.c += l.line_cost_tnd; pr.set(l.product_id, v); } });
        el.appendChild(dataTable<Row>([{ key: "product_name", label: "Produit", get: r => r.product_name }, { key: "category", label: "Catégorie", get: r => r.category }, { key: "product_tier", label: "Gamme", get: r => r.product_tier }, { key: "product_status", label: "Statut", get: r => r.product_status, render: r => chip(r.product_status, tone(r.product_status)) }, { key: "rev", label: "Chiffre d'affaires", get: r => pr.get(r.product_id)?.r ?? 0, num: true, render: r => fmt.compact(pr.get(r.product_id)?.r ?? 0) }, { key: "margin", label: "Marge", get: r => { const v = pr.get(r.product_id); return v && v.r ? (v.r - v.c) / v.r : 0; }, num: true, render: r => { const v = pr.get(r.product_id); return fmt.pct(v && v.r ? (v.r - v.c) / v.r : null); } }], c.d.products, ts, () => c.rerender(), { onRow: r => c.select("product", r.product_id), id: "pp" })); }
    if (tab === "departments") { el.appendChild(dataTable<Row>([{ key: "department_name", label: "Département", get: r => r.department_name }, { key: "division", label: "Division", get: r => r.division }, { key: "primary_location", label: "Site", get: r => r.primary_location }, { key: "emp", label: "Employés", get: r => c.d.employees.filter(e => e.department_id === r.department_id).length, num: true }, { key: "risks", label: "Risques ouverts", get: r => c.d.risk_register.filter(x => x.department_id === r.department_id && OPEN_RISK.has(x.mitigation_status)).length, num: true }], c.d.departments, ts, () => c.rerender(), { onRow: r => c.select("department", r.department_id), id: "pd" })); }
}
