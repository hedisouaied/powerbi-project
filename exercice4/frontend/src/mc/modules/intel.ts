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
const sevTone = (x: string): string => (x === "Critical" ? "bad" : x === "High" ? "warn" : x === "Medium" ? "info" : "muted");
function title(el: HTMLElement, t: string, sub: string, ...extra: Node[]): void { el.appendChild(h("div", "mc-page-title", h("h1", null, t), h("span", "mc-muted", sub), h("div", "mc-row-gap mc-push", ...extra))); }

// ======================================================================== AI Assistant (6) — rule-based, adapter-ready
export interface Answer { text: string; cites: string[] }
/** Contract for a future secured integration. The visual must never hold API keys: a real adapter would call the
 *  customer's own backend proxy (declared in capabilities "WebAccess"), which holds the key server-side. */
export interface AssistantAdapter { readonly name: string; ask(question: string, ctx: { period: string; dept: string; selection: string | null }): Answer }
export class RuleBasedAssistant implements AssistantAdapter {
    public readonly name = "Demo Assistant — rule-based";
    constructor(private readonly c: Ctx) { }
    public ask(q: string): Answer {
        const c = this.c, l = q.toLowerCase(), k = kpis(c.ix, c.ec), p = prevKpis(c);
        if (/change|month|compar|happen|performance/.test(l)) {
            const ch = whatChanged(k, p);
            return { text: `${c.ec.p.label} vs the previous period: ${ch.map(x => x.text).join("; ")}. Net revenue ${fmt.compact(k.netRevenue)}, gross margin ${fmt.pct(k.gm)}.`, cites: [`sales_orders (${k.orders} orders in period)`, "sales_order_items (cost)", "Measures: Net Revenue, Gross Margin %"] };
        }
        if (/risk|department.*(open|highest)|exposure/.test(l)) {
            const byDept = Array.from(groupBy(c.d.risk_register.filter(r => OPEN_RISK.has(r.mitigation_status)), r => r.department_id).entries()).map(([d, rs]) => ({ d, n: rs.length, e: sum(rs, r => r.estimated_exposure_tnd) })).sort((a, b) => b.e - a.e);
            return { text: `Highest open risk exposure: ${byDept.slice(0, 3).map(x => `${c.ix.deptName(x.d)} (${x.n} risks, ${fmt.compact(x.e)})`).join(", ")}. Open = status Open or Mitigating.`, cites: ["risk_register (mitigation_status, estimated_exposure_tnd)"] };
        }
        if (/margin/.test(l)) {
            const cur = k.gm ?? 0, prev = p.gm ?? 0;
            const cats = groupBy(c.d.sales_order_items.filter(li => { const o = c.ix.order.get(li.order_id); return o && isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to; }), li => c.ix.prod.get(li.product_id)?.category ?? "—");
            const worst = Array.from(cats.entries()).map(([cat, ls]) => ({ cat, m: 1 - sum(ls, x => x.line_cost_tnd) / Math.max(1, sum(ls, x => x.net_line_amount_tnd)) })).sort((a, b) => a.m - b.m)[0];
            return { text: `Gross margin is ${fmt.pct(cur)} vs ${fmt.pct(prev)} in the previous period (${cur >= prev ? "up" : "down"} ${(Math.abs(cur - prev) * 100).toFixed(1)} pts). Lowest-margin category in the period: ${worst?.cat} (${fmt.pct(worst?.m)}). Discount given: ${fmt.compact(k.discount)}. This is a decomposition, not proof of cause.`, cites: ["sales_order_items (net_line_amount, line_cost, discount_rate)", "products (category)"] };
        }
        if (/customer.*risk|churn|at risk|at-risk/.test(l)) {
            const top = c.d.customers.filter(x => x.customer_status === "At Risk").sort((a, b) => b.annual_contract_value_tnd - a.annual_contract_value_tnd).slice(0, 5);
            return { text: `${k.atRiskCustomers} customers have status At Risk. Largest contracts: ${top.map(x => `${x.customer_name} (${fmt.compact(x.annual_contract_value_tnd)}, ${x.region})`).join(", ")}.`, cites: ["customers (customer_status, annual_contract_value_tnd)"] };
        }
        if (/investigat|next|anomal|suspic|unusual/.test(l)) {
            const an = anomalies(c.ix).slice(0, 3);
            return { text: `Start with: ${an.map(a => `${a.rule} on ${a.record} (${a.evidence})`).join("; ")}. These are unusual patterns that require review, not conclusions.`, cites: an.map(a => `${a.table} ${a.record}`) };
        }
        if (/collect|payment|overdue|cash/.test(l)) {
            return { text: `Collection rate ${fmt.pct(k.collectionRate)}: ${fmt.compact(k.paid)} received, ${fmt.compact(k.outstanding)} outstanding, ${fmt.compact(k.overdue)} overdue across ${k.overdueCount} payments.`, cites: ["payments (payment_status, amount_tnd)"] };
        }
        if (/revenue|sales/.test(l)) {
            return { text: `Net revenue in ${c.ec.p.label}: ${fmt.compact(k.netRevenue)} on ${k.revenueOrders} revenue orders (AOV ${fmt.compact(k.aov)}). Previous period: ${fmt.compact(p.netRevenue)}.`, cites: ["sales_orders (Completed + Processing)"] };
        }
        return { text: "I can only answer questions the data supports. Try: what changed this month, which departments have the highest open risk, explain the margin decline, which customers are at risk, what should I investigate next, how are collections.", cites: [] };
    }
}
export function assistant(c: Ctx, el: HTMLElement): void {
    const bot = new RuleBasedAssistant(c);
    const pending = c.s.m.ask as string | undefined;
    if (pending) { c.s.m.ask = undefined; c.s.assistant.push({ who: "user", text: pending }); const a = bot.ask(pending); c.s.assistant.push({ who: "bot", text: a.text, cites: a.cites }); }
    title(el, "AI Business Assistant", "Answers come from deterministic rules over the measures — no external AI model is called.", chip(bot.name, "info"));
    const g = h("div", "mc-grid mc-g-assist"); el.appendChild(g);
    const conv = card("Conversation", { icon: "Bot", sub: `Context: ${c.ec.p.label}${c.ec.dept ? " · " + c.ix.deptName(c.ec.dept) : ""}${c.s.selection ? ` · selected ${c.s.selection.type} ${c.s.selection.id}` : ""}` });
    const log = h("div", "mc-chat");
    if (!c.s.assistant.length) { log.appendChild(empty("Ask a question or pick a suggestion.", "Sparkles")); }
    c.s.assistant.forEach(m => log.appendChild(h("div", `mc-chat-bubble mc-chat-${m.who}`, m.text, m.cites?.length ? h("div", "mc-cite", icon("Quote", 11), "Sources: " + m.cites.join(" · ")) : null)));
    conv.body.appendChild(log);
    const ask = (q: string): void => { if (!q.trim()) { return; } c.s.assistant.push({ who: "user", text: q }); const a = bot.ask(q); c.s.assistant.push({ who: "bot", text: a.text, cites: a.cites }); c.rerender(); };
    const inp = h("input", { class: "mc-input", placeholder: "Ask about revenue, margin, risk, customers, collections…", "data-focus": "assistant", "aria-label": "Question" }) as HTMLInputElement;
    inp.onkeydown = (e: KeyboardEvent): void => { if (e.key === "Enter") { ask(inp.value); } };
    conv.body.appendChild(h("div", "mc-chat-input", inp, iconBtn("Send", "Send", () => ask(inp.value)), iconBtn("Trash", "Clear conversation", () => { c.s.assistant = []; c.rerender(); })));
    g.appendChild(conv.el);
    const side = card("Suggested questions", { icon: "Lightbulb" });
    ["What changed this month?", "Which departments have the highest open risk?", "Explain the margin decline", "Which customers are at risk?", "What should I investigate next?", "How are collections?"].forEach(q => { const b = h("button", { class: "mc-suggest", type: "button" }, q); b.onclick = (): void => ask(q); side.body.appendChild(b); });
    side.body.appendChild(h("div", "mc-ins-section", h("div", "mc-ins-title", "Integration-ready (disabled)"), h("div", "mc-small mc-muted", "A real model would plug in through the AssistantAdapter interface, calling YOUR backend proxy (which keeps the API key server-side) on the Laravel side. Keys are never sent to the browser. Configure placeholders in Settings › Integrations.")));
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
export const TYPE_COLOR: Record<string, string> = { Customer: "accent", Product: "teal", Supplier: "warn", Employee: "info", Department: "good", Project: "violet", Order: "soft", Incident: "bad" };
export function drawGraph(c: Ctx, host: HTMLElement, nodes: GNode[], edges: GEdge[], opts: { focus?: string; pathIds?: string[]; onNode?: (id: string) => void; w?: number; h?: number; animate?: boolean }): void {
    const w = opts.w ?? 760, hg = opts.h ?? 420;
    const pos = layout(nodes, edges, w, hg);
    const svg = s("svg", { viewBox: `0 0 ${w} ${hg}`, class: "mc-graph", role: "img", "aria-label": "Relationship graph" });
    const neigh = new Set<string>(); if (opts.focus) { edges.forEach(e => { if (e.s === opts.focus) { neigh.add(e.t); } if (e.t === opts.focus) { neigh.add(e.s); } }); }
    const onPath = new Set(opts.pathIds ?? []);
    const pathEdge = (e: GEdge): boolean => { const p = opts.pathIds ?? []; for (let i = 0; i < p.length - 1; i++) { if ((p[i] === e.s && p[i + 1] === e.t) || (p[i] === e.t && p[i + 1] === e.s)) { return true; } } return false; };
    edges.forEach(e => { const a = pos.get(e.s), b = pos.get(e.t); if (!a || !b) { return; } const hot = pathEdge(e) || (opts.focus && (e.s === opts.focus || e.t === opts.focus)); svg.appendChild(s("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, class: `mc-edge${hot ? " mc-edge-hot" : ""}${e.basis.includes("Synthetic") ? " mc-edge-weak" : ""}${opts.animate !== false && hot ? " mc-edge-flow" : ""}`, "stroke-width": String(0.6 + e.strength * 2.4) }, s("title", {}, document.createTextNode(`${e.type} · strength ${e.strength} · ${e.basis}`) as any))); });
    nodes.forEach(nd => {
        const p = pos.get(nd.id)!; const dim = opts.focus && nd.id !== opts.focus && !neigh.has(nd.id) && !onPath.has(nd.id);
        const g = s("g", { class: `mc-node mc-fill-${TYPE_COLOR[nd.type] ?? "muted"}${nd.id === opts.focus ? " mc-node-focus" : ""}${dim ? " mc-node-dim" : ""}${onPath.has(nd.id) ? " mc-node-path" : ""}`, transform: `translate(${p.x.toFixed(1)},${p.y.toFixed(1)})`, tabindex: "0", role: "button", "aria-label": `${nd.type} ${nd.label}` });
        g.appendChild(s("circle", { r: String(4 + Math.min(10, nd.degree * 1.3)) }));
        if (nd.degree > 4 || nd.id === opts.focus || neigh.has(nd.id) || onPath.has(nd.id)) { const t = s("text", { x: "10", y: "4" }); t.textContent = nd.label; g.appendChild(t); }
        g.addEventListener("click", () => opts.onNode?.(nd.id)); g.addEventListener("keydown", (e: Event) => { if ((e as KeyboardEvent).key === "Enter") { opts.onNode?.(nd.id); } });
        svg.appendChild(g);
    });
    host.appendChild(svg);
    host.appendChild(h("div", "mc-legend", ...Object.keys(TYPE_COLOR).map(t => h("span", null, h("i", `mc-dot-legend mc-bg-${TYPE_COLOR[t]}`), t)), h("span", null, "— solid: verified by source key · dashed: synthetic analytical link")));
}

// ======================================================================== Network Graph (20)
export function network(c: Ctx, el: HTMLElement): void {
    const all = graph(c.ix);
    const f = c.m<Record<string, any>>("netF", () => ({ types: Object.keys(TYPE_COLOR), rel: "", minStrength: 0, focus: "", from: "", to: "" }));
    title(el, "Interactive Network Graph", "entity_relationships.csv as a graph · filter types and relationship strength, focus a node to see its neighbours, find paths.");
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
    fb.appendChild(select(Array.from(new Set(all.edges.map(e => e.type))).sort().map(v => ({ value: v, label: v })), f.rel, v => { f.rel = v; c.rerender(); }, "Relationship", "All"));
    fb.appendChild(select([0, 0.3, 0.5, 0.7, 0.9].map(v => ({ value: String(v), label: `≥ ${v}` })), String(f.minStrength), v => { f.minStrength = Number(v); c.rerender(); }, "Strength"));
    if (f.focus) { fb.appendChild(btn("Clear focus", { small: true, icon: "X", onClick: () => { f.focus = ""; c.rerender(); } })); }
    el.appendChild(fb);
    const g = h("div", "mc-grid mc-g-graph"); el.appendChild(g);
    const gc = card(`Graph · ${nodes.length} nodes · ${shownEdges.length} edges${!f.focus && all.nodes.length > 140 ? " (top 140 by degree)" : ""}`, { icon: "Network" });
    drawGraph(c, gc.body, nodes, shownEdges, { focus: f.focus, pathIds: pth, onNode: id => { f.focus = f.focus === id ? "" : id; c.rerender(); }, animate: !c.reduced });
    g.appendChild(gc.el);
    const side = h("div", "mc-col");
    const pf = card("Path explorer", { icon: "Route", sub: "Shortest path (any direction)" });
    const nodeOpts = all.nodes.slice().sort((a, b) => a.label.localeCompare(b.label)).map(n => ({ value: n.id, label: `${n.type} · ${n.label}` }));
    pf.body.appendChild(select(nodeOpts, f.from, v => { f.from = v; c.rerender(); }, "From", "—")); pf.body.appendChild(select(nodeOpts, f.to, v => { f.to = v; c.rerender(); }, "To", "—"));
    if (f.from && f.to) { pf.body.appendChild(pth.length ? h("div", "mc-path", ...pth.map((id, i) => h("span", null, i ? " → " : "", chip(all.nodes.find(n => n.id === id)?.label ?? id, TYPE_COLOR[id.split(":")[0]] ?? "muted")))) : h("div", "mc-muted", "No path between these nodes with the current filters.")); }
    side.appendChild(pf.el);
    const ev = card(f.focus ? "Evidence for the focused node" : "Keyboard-accessible node list", { icon: "ListChecks" });
    if (f.focus) {
        const es = all.edges.filter(e => e.s === f.focus || e.t === f.focus);
        es.forEach(e => { const other = e.s === f.focus ? e.t : e.s; const r = h("div", "mc-ins-row mc-click", h("span", null, `${e.type} → ${all.nodes.find(n => n.id === other)?.label}`), h("span", "mc-small mc-muted", `${e.strength} · ${e.basis}`)); r.onclick = (): void => { f.focus = other; c.rerender(); }; ev.body.appendChild(r); });
        ev.body.appendChild(h("div", "mc-small mc-muted", "Links are analytical relationships; they do not prove wrongdoing."));
    } else { nodes.slice().sort((a, b) => b.degree - a.degree).slice(0, 30).forEach(n => { const r = h("button", { class: "mc-ins-row mc-click", type: "button" }, h("span", null, `${n.type} · ${n.label}`), chip(`${n.degree} links`, "muted")); r.onclick = (): void => { f.focus = n.id; c.rerender(); }; ev.body.appendChild(r); }); }
    side.appendChild(ev.el); g.appendChild(side);
}

// ======================================================================== Business Detective (27)
export function detective(c: Ctx, el: HTMLElement): void {
    const caseId = c.m<string>("caseId", () => "DEMO");
    const notes = c.m<Record<string, string[]>>("caseNotes", () => ({}));
    const evState = c.m<Record<string, string>>("evState", () => ({}));
    title(el, "Business Detective", "Investigation cases, evidence board, relationship paths and timeline. Neutral language: patterns “require review”.", chip("Synthetic demo data", "info"));
    const list = card("Cases", { icon: "FolderSearch" });
    const demo = h("button", { class: `mc-ins-row mc-click${caseId === "DEMO" ? " mc-on" : ""}`, type: "button" }, h("span", null, h("b", null, "DEMO · Order O00004 amount anomaly")), chip("Scenario", "info")); demo.onclick = (): void => { c.s.m.caseId = "DEMO"; c.rerender(); }; list.body.appendChild(demo);
    const ts = c.m<TableState>("caseTable", () => newTableState("severity", false, 8));
    list.body.appendChild(dataTable<Row>([{ key: "case_id", label: "Case", get: r => r.case_id }, { key: "case_type", label: "Type", get: r => r.case_type }, { key: "severity", label: "Sev.", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) }, { key: "case_status", label: "Status", get: r => r.case_status, render: r => chip(c.s.m[`cs_${r.case_id}`] ?? r.case_status, tone(c.s.m[`cs_${r.case_id}`] ?? r.case_status)) }], c.d.investigation_cases, ts, () => c.rerender(), { onRow: r => { c.s.m.caseId = r.case_id; c.rerender(); }, active: r => r.case_id === caseId, id: "cases" }));
    const main = h("div", "mc-col");
    el.appendChild(h("div", "mc-grid mc-g-detective", list.el, main));
    if (caseId === "DEMO") {
        const o = c.ix.order.get("O00004"); if (!o) { main.appendChild(empty("Order O00004 is not in the data.")); return; }
        const cust = o.customer_id, pay = c.ix.payByOrder.get("O00004");
        const ords = c.d.sales_orders.filter(x => x.customer_id === cust);
        const inter = c.d.customer_interactions.filter(x => x.customer_id === cust);
        const head = card("DEMO case · Order O00004 — amount anomaly", { icon: "ScanSearch", sub: "Built from the data on the fly. Synthetic dataset." });
        head.body.appendChild(h("div", null, `Order O00004 for ${c.ix.custName(cust)} records a gross amount of ${fmt.money2(o.gross_amount_tnd)} while net + tax = ${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)}. The payment recorded is ${pay ? `${fmt.money2(pay.amount_tnd)} (${pay.payment_status})` : "missing"}. This is an unusual pattern that requires review. A keying or integration error is one possible explanation; the data alone does not establish the cause or any intent.`));
        main.appendChild(head.el);
        const board = card("Evidence board", { icon: "LayoutGrid", sub: "Drag cards between columns (session)" });
        const evid = [
            { id: "e1", t: "Order record", d: `gross ${fmt.money2(o.gross_amount_tnd)} ≠ net ${fmt.money2(o.net_amount_tnd)} + tax ${fmt.money2(o.tax_amount_tnd)}`, src: "sales_orders O00004" },
            { id: "e2", t: "Line items", d: `${(c.ix.linesByOrder.get("O00004") ?? []).length} lines summing to ${fmt.money2(sum(c.ix.linesByOrder.get("O00004") ?? [], l => l.net_line_amount_tnd))} — consistent with net`, src: "sales_order_items" },
            { id: "e3", t: "Payment", d: pay ? `${pay.payment_status} ${fmt.money2(pay.amount_tnd)} on ${fmt.date(pay.payment_date)} — ${Math.abs(pay.amount_tnd - o.gross_amount_tnd) < Math.abs(pay.amount_tnd - o.net_amount_tnd - o.tax_amount_tnd) ? `closer to the recorded gross (${fmt.money2(o.gross_amount_tnd)}) than to net + tax (${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)})` : `closer to net + tax (${fmt.money2(o.net_amount_tnd + o.tax_amount_tnd)}) than to the recorded gross (${fmt.money2(o.gross_amount_tnd)})`}` : "no payment", src: `payments ${pay?.payment_id ?? ""}` },
            { id: "e4", t: "Customer history", d: `${ords.length} orders, median gross ${fmt.money2(ords.map(x => x.gross_amount_tnd).sort((a, b) => a - b)[Math.floor(ords.length / 2)] ?? 0)}`, src: "sales_orders (customer)" },
            { id: "e5", t: "Interactions", d: `${inter.length} interactions, ${inter.filter(i => i.interaction_status === "Escalated").length} escalated`, src: "customer_interactions" }
        ];
        const cols = ["Unreviewed", "Reviewed", "Flagged"]; const bd = h("div", "mc-kanban mc-kanban-3");
        cols.forEach(col => { const lane = h("div", "mc-lane", h("div", "mc-lane-head", col)); lane.ondragover = (e: DragEvent): void => { e.preventDefault(); lane.classList.add("mc-drop"); }; lane.ondragleave = (): void => lane.classList.remove("mc-drop"); lane.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain") ?? ""; evState[id] = col; c.store.audit("Detective", "Evidence moved", `${id} → ${col}`); c.rerender(); };
            evid.filter(x => (evState[x.id] ?? "Unreviewed") === col).forEach(x => { const k = h("div", { class: "mc-kcard", draggable: "true", tabindex: 0 }, h("b", null, x.t), h("div", "mc-small", x.d), h("div", "mc-small mc-muted", x.src)); k.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", x.id); }; lane.appendChild(k); }); bd.appendChild(lane); });
        board.body.appendChild(bd); main.appendChild(board.el);
        const tl = card("Investigation timeline", { icon: "Clock" });
        const items = [...ords.map(x => ({ d: x.order_date, t: `Order ${x.order_id} · ${x.order_status} · ${fmt.compact(x.gross_amount_tnd)}`, hot: x.order_id === "O00004" })), ...ords.map(x => c.ix.payByOrder.get(x.order_id)).filter(Boolean).map(p => ({ d: (p as Row).payment_date, t: `Payment ${(p as Row).payment_id} · ${(p as Row).payment_status}`, hot: (p as Row).order_id === "O00004" })), ...inter.map(i => ({ d: i.interaction_date, t: `${i.channel} ${i.interaction_type} · ${i.interaction_status}`, hot: false }))].sort((a, b) => a.d.localeCompare(b.d));
        tl.body.appendChild(h("div", "mc-timeline", ...items.slice(-14).map(x => h("div", `mc-tl-item${x.hot ? " mc-tone-bad" : ""}`, h("span", "mc-tl-date", fmt.date(x.d)), h("span", null, x.t))))); main.appendChild(tl.el);
        const gr = card("Relationship path", { icon: "Network", sub: "Graph neighbourhood of the customer" });
        const all = graph(c.ix); const focus = `Customer:${cust}`;
        const es = all.edges.filter(e => e.s === focus || e.t === focus); const ids = new Set([focus, ...es.flatMap(e => [e.s, e.t])]);
        if (es.length) { drawGraph(c, gr.body, all.nodes.filter(n => ids.has(n.id)), es, { focus, w: 620, h: 260, onNode: id => { c.s.m.netF = { types: Object.keys(TYPE_COLOR), rel: "", minStrength: 0, focus: id, from: "", to: "" }; c.go("network"); } }); } else { gr.body.appendChild(h("div", "mc-muted", "This customer has no edge in entity_relationships.csv; the investigation relies on transactional records above.")); }
        main.appendChild(gr.el);
    } else {
        const cs = c.d.investigation_cases.find(x => x.case_id === caseId); if (!cs) { main.appendChild(empty("Pick a case.")); return; }
        const st = c.s.m[`cs_${caseId}`] ?? cs.case_status;
        const head = card(`${cs.case_id} · ${cs.case_title}`, { icon: "ScanSearch", actions: [select(["New", "Investigating", "Awaiting Review", "Closed"].map(v => ({ value: v, label: v })), st, v => { c.s.m[`cs_${caseId}`] = v; c.store.audit("Detective", "Case status", `${caseId} → ${v}`); c.toast(`${caseId} → ${v} (session)`); c.rerender(); }, "Status")] });
        head.body.appendChild(h("dl", "mc-kv", ...([["Type", cs.case_type], ["Severity", cs.severity], ["Owner", c.ix.empName(cs.case_owner_employee_id)], ["Department", c.ix.deptName(cs.department_id)], ["Opened", fmt.date(cs.opened_date)], ["Review", cs.review_status], ["Summary", cs.case_summary]] as Array<[string, string]>).flatMap(([k, v]) => [h("dt", null, k), h("dd", null, v)])));
        main.appendChild(head.el);
        const ev = c.d.investigation_evidence.filter(e => e.case_id === caseId);
        const board = card(`Evidence (${ev.length})`, { icon: "LayoutGrid", sub: "Drag to re-classify (session). Source references are synthetic and may not resolve to a row." });
        const cols = ["Unreviewed", "Reviewed", "Flagged"]; const bd = h("div", "mc-kanban mc-kanban-3");
        cols.forEach(col => { const lane = h("div", "mc-lane", h("div", "mc-lane-head", col)); lane.ondragover = (e: DragEvent): void => { e.preventDefault(); }; lane.ondrop = (e: DragEvent): void => { e.preventDefault(); const id = e.dataTransfer?.getData("text/plain") ?? ""; evState[id] = col; c.rerender(); };
            ev.filter(x => (evState[x.evidence_id] ?? x.evidence_status) === col).forEach(x => { const k = h("div", { class: "mc-kcard", draggable: "true", tabindex: 0 }, h("div", "mc-row-gap", h("b", null, x.evidence_type), chip(x.relevance_level, x.relevance_level === "High" ? "warn" : "muted")), h("div", "mc-small", x.evidence_summary), h("div", "mc-small mc-muted", `${x.source_table} · ${x.source_record_reference} · ${fmt.date(x.evidence_date)}`)); k.ondragstart = (e: DragEvent): void => { e.dataTransfer?.setData("text/plain", x.evidence_id); }; lane.appendChild(k); }); bd.appendChild(lane); });
        board.body.appendChild(bd); main.appendChild(board.el);
        const tl = card("Timeline", { icon: "Clock" });
        const items = [{ d: cs.opened_date, t: "Case opened" }, ...ev.map(e => ({ d: e.evidence_date, t: `${e.evidence_type} added (${e.relevance_level})` })), ...c.d.incidents.filter(i => i.department_id === cs.department_id && day(i.incident_date) >= addMonths(cs.opened_date, -2).slice(0, 10) && day(i.incident_date) <= addMonths(cs.opened_date, 2).slice(0, 10)).slice(0, 5).map(i => ({ d: i.incident_date, t: `Dept incident ${i.incident_id} · ${i.incident_type}` }))].sort((a, b) => a.d.localeCompare(b.d));
        tl.body.appendChild(h("div", "mc-timeline", ...items.map(x => h("div", "mc-tl-item", h("span", "mc-tl-date", fmt.date(x.d)), h("span", null, x.t))))); main.appendChild(tl.el);
    }
    const nn = card("Case notes (session)", { icon: "NotebookPen" }); const list2 = notes[caseId] ?? (notes[caseId] = []);
    list2.forEach(n => nn.body.appendChild(h("div", "mc-note", n)));
    const ni = input("", () => undefined, "Add a neutral, factual note…", "text", "case-note");
    nn.body.appendChild(h("div", "mc-chat-input", ni, iconBtn("Send", "Add note", () => { if (ni.value.trim()) { list2.push(ni.value.trim()); c.store.audit("Detective", "Note", caseId); c.rerender(); } })));
    main.appendChild(nn.el);
}

// ======================================================================== Risk Radar + Smart Anomaly Detection (10)
export function risk(c: Ctx, el: HTMLElement): void {
    const tab = c.m<string>("riskTab", () => "radar");
    title(el, "Risk Radar · Anomaly Detection", "Transparent scores with evidence. Select a category to filter the register.");
    el.appendChild(tabs([{ id: "radar", label: "Risk radar", icon: "Radar" }, { id: "anomalies", label: "Smart anomaly detection", icon: "ScanSearch", count: anomalies(c.ix).length }, { id: "alerts", label: "Alerts", icon: "Bell" }], tab, v => { c.s.m.riskTab = v; c.rerender(); }));
    if (tab === "radar") {
        const cats = riskByCategory(c.ix, c.ec.dept); const sel = c.m<string>("riskCat", () => "");
        const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
        const rc = card("Open risk score by category", { icon: "Radar", sub: "score = 100 × severity weight × confidence × exposure factor (0.3 + 0.7 × log-scaled exposure) · averaged over open risks" }); const chEl = h("div", "mc-chart mc-h300"); rc.body.appendChild(chEl); g.appendChild(rc.el);
        c.ch.radar(chEl, cats.map(x => ({ name: x.cat, max: 100 })), [{ name: "Average open score", values: cats.map(x => x.score) }]);
        const bc = card("Exposure by category (click to filter)", { icon: "ChartBar" }); const bEl = h("div", "mc-chart mc-h300"); bc.body.appendChild(bEl); g.appendChild(bc.el);
        c.ch.bars(bEl, cats.map(x => ({ name: x.cat, value: x.exposure })), { horizontal: true, fmt: v => fmt.compact(v), selected: sel, onClick: p => { c.s.m.riskCat = c.s.m.riskCat === p.name ? "" : p.name; c.rerender(); } });
        const rs = c.d.risk_register.filter(r => (!sel || r.risk_category === sel) && (!c.ec.dept || r.department_id === c.ec.dept));
        const max = Math.max(1, ...c.d.risk_register.map(r => r.estimated_exposure_tnd));
        const ts = c.m<TableState>("riskTable", () => newTableState("score", true, 10));
        el.appendChild(h("div", "mc-row-gap", sel ? chip(`Category: ${sel}`, "info") : null, sel ? btn("Clear", { small: true, icon: "X", onClick: () => { c.s.m.riskCat = ""; c.rerender(); } }) : null));
        el.appendChild(dataTable<Row>([
            { key: "risk_id", label: "Risk", get: r => r.risk_id }, { key: "risk_category", label: "Category", get: r => r.risk_category }, { key: "severity", label: "Severity", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) },
            { key: "confidence_score", label: "Confidence", get: r => r.confidence_score, num: true, render: r => fmt.pct(r.confidence_score, 0) },
            { key: "estimated_exposure_tnd", label: "Exposure", get: r => r.estimated_exposure_tnd, num: true, render: r => fmt.compact(r.estimated_exposure_tnd) },
            { key: "score", label: "Score", get: r => riskScore(r, max).score, num: true, render: r => h("span", { class: "mc-score", title: riskScore(r, max).parts }, String(riskScore(r, max).score)) },
            { key: "owner", label: "Owner", get: r => c.ix.empName(r.risk_owner_employee_id) }, { key: "mitigation_status", label: "Mitigation", get: r => r.mitigation_status, render: r => chip(r.mitigation_status, tone(r.mitigation_status)) }
        ], rs, ts, () => c.rerender(), { id: "risk", onRow: r => c.select("risk", r.risk_id) }));
    } else if (tab === "anomalies") {
        const an = anomalies(c.ix); const acks = new Set(c.store.extras.acks);
        el.appendChild(h("div", "mc-hint", icon("Info", 14), "Rules: gross ≠ net + tax; promised date before order date; z-score > 3 on order gross and per expense category; Paid payment ≠ order gross by > 25%; same customer + day + amount; month-over-month revenue change > 40%. Flags require review — they are not conclusions."));
        const ts = c.m<TableState>("anTable", () => newTableState("", false, 12));
        el.appendChild(dataTable<any>([
            { key: "severity", label: "Severity", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) }, { key: "rule", label: "Rule", get: r => r.rule }, { key: "record", label: "Record", get: r => `${r.table} ${r.record}` },
            { key: "evidence", label: "Evidence", get: r => r.evidence }, { key: "explanation", label: "Why it matters", get: r => r.explanation },
            { key: "ack", label: "Review", get: r => (acks.has(r.id) ? "Acknowledged" : ""), render: r => btn(acks.has(r.id) ? "Acknowledged" : "Acknowledge", { small: true, kind: acks.has(r.id) ? "ghost" : "soft", icon: acks.has(r.id) ? "Check" : "Eye", onClick: () => { c.store.toggle("acks", r.id, "Anomaly Detection"); c.rerender(); } }) }
        ], an, ts, () => c.rerender(), { id: "an", onRow: r => { if (r.table === "sales_orders" && /^O\d+/.test(r.record)) { c.select("order", r.record); } } }));
    } else {
        const ts = c.m<TableState>("alTable", () => newTableState("alert_date", true, 14));
        el.appendChild(dataTable<Row>([{ key: "alert_id", label: "Alert", get: r => r.alert_id }, { key: "alert_date", label: "Date", get: r => r.alert_date, render: r => fmt.date(r.alert_date) }, { key: "alert_type", label: "Type", get: r => r.alert_type }, { key: "severity", label: "Severity", get: r => r.severity, render: r => chip(r.severity, sevTone(r.severity)) }, { key: "alert_status", label: "Status", get: r => r.alert_status, render: r => chip(r.alert_status, tone(r.alert_status)) }, { key: "affected_area", label: "Area", get: r => r.affected_area }, { key: "confidence_score", label: "Confidence", get: r => r.confidence_score, num: true, render: r => fmt.pct(r.confidence_score, 0) }], c.d.alerts, ts, () => c.rerender(), { id: "al", chooser: true, onRow: r => c.select("alert", r.alert_id) }));
    }
}

// ======================================================================== Root Cause Analyzer (9)
export function rootcause(c: Ctx, el: HTMLElement): void {
    const dec = decomposeRevenue(c.ix, c.ec, c.prev);
    const dim = c.m<string>("rcDim", () => "Department");
    const member = c.m<string>("rcMember", () => "");
    title(el, "Root Cause Analyzer", `Net revenue change: ${c.ec.p.label} vs previous period · contributions are arithmetic, not causal proof.`);
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const wf = card(`Bridge · total change ${fmt.compact(dec.total)}`, { icon: "ChartBar", sub: "Volume effect = Δorders × previous AOV · price/mix effect = current orders × ΔAOV" }); const wEl = h("div", "mc-chart mc-h260"); wf.body.appendChild(wEl); g.appendChild(wf.el);
    const prevRev = kpis(c.ix, c.prev).netRevenue;
    c.ch.waterfall(wEl, [{ name: "Previous", value: prevRev, total: true }, { name: "Volume", value: dec.priceVolume.volume }, { name: "Price / mix", value: dec.priceVolume.price }, { name: "Current", value: prevRev + dec.total, total: true }], v => fmt.compact(v));
    const dims = ["Department", "Channel", "Region", "Segment", "Product category"];
    const dr = card("Driver ranking", { icon: "GitBranch", actions: [select(dims.map(d => ({ value: d, label: d })), dim, v => { c.s.m.rcDim = v; c.s.m.rcMember = ""; c.rerender(); })] });
    const ds = dec.drivers.filter(d => d.dim === dim);
    const dEl = h("div", "mc-chart mc-h260"); dr.body.appendChild(dEl); g.appendChild(dr.el);
    c.ch.bars(dEl, ds.map(d => ({ name: d.member, value: d.delta, color: d.delta >= 0 ? c.t.good : c.t.bad })), { horizontal: true, fmt: v => fmt.compact(v), selected: member, onClick: p => { c.s.m.rcMember = p.name; c.rerender(); } });
    const top = dec.drivers.slice(0, 8);
    const tb = card("Top contributors across all dimensions", { icon: "ListChecks" });
    top.forEach(d => tb.body.appendChild(h("div", "mc-ins-row", h("span", null, `${d.dim}: ${d.member}`), h("span", "mc-small mc-muted", `${fmt.compact(d.prev)} → ${fmt.compact(d.cur)}`), h("b", d.delta >= 0 ? "mc-tone-good" : "mc-tone-bad", `${d.delta >= 0 ? "+" : ""}${fmt.compact(d.delta)}`))));
    el.appendChild(tb.el);
    if (member) {
        const key = (o: Row): string => dim === "Department" ? c.ix.deptName(c.ix.empDept(o.sales_owner_id)) : dim === "Channel" ? o.sales_channel : dim === "Region" ? (c.ix.cust.get(o.customer_id)?.region ?? "") : dim === "Segment" ? (c.ix.cust.get(o.customer_id)?.customer_segment ?? "") : "";
        const recs = c.d.sales_orders.filter(o => isRevenue(o) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to && (dim === "Product category" ? (c.ix.linesByOrder.get(o.order_id) ?? []).some(l => c.ix.prod.get(l.product_id)?.category === member) : key(o) === member));
        const ts = c.m<TableState>("rcTable", () => newTableState("net_amount_tnd", true, 10));
        const rc = card(`Drill path: Net revenue › ${dim} › ${member} › orders`, { icon: "Route", actions: [btn("Clear", { small: true, icon: "X", onClick: () => { c.s.m.rcMember = ""; c.rerender(); } })] });
        rc.body.appendChild(dataTable<Row>([{ key: "order_id", label: "Order", get: r => r.order_id }, { key: "order_date", label: "Date", get: r => r.order_date, render: r => fmt.date(r.order_date) }, { key: "cust", label: "Customer", get: r => c.ix.custName(r.customer_id) }, { key: "net_amount_tnd", label: "Net", get: r => r.net_amount_tnd, num: true, render: r => fmt.money2(r.net_amount_tnd) }], recs, ts, () => c.rerender(), { id: "rc", onRow: r => c.select("order", r.order_id) }));
        el.appendChild(rc.el);
    }
}

// ======================================================================== Forecast + KPI dependency graph
export { forecast2 as forecast };
function forecast2(c: Ctx, el: HTMLElement): void {
    const metric = c.m<string>("fcMetric", () => "revenue");
    const months = monthRange(month(c.ix.first), month(addMonths(c.ix.ref, -1)));
    const rm = revenueByMonth(c.ix, c.ec.dept);
    const series = (k: string): Array<{ m: string; v: number }> => months.map(m => ({ m, v: k === "revenue" ? rm.get(m)?.net ?? 0 : k === "orders" ? rm.get(m)?.orders ?? 0 : k === "expenses" ? sum(c.d.expenses.filter(e => month(e.expense_date) === m && e.approval_status !== "Rejected" && (!c.ec.dept || e.department_id === c.ec.dept)), e => e.amount_tnd) : c.d.customer_interactions.filter(i => month(i.interaction_date) === m).length }));
    const res = runForecast(series(metric), 3); const best = res.filter(r => r.mape !== null).sort((a, b) => (a.mape as number) - (b.mape as number))[0] ?? res[0];
    title(el, "Predictive Analytics · KPI Dependency Graph", `Complete months only (${monthLabel(months[0])} – ${monthLabel(months[months.length - 1])}); the partial current month is excluded.`, chip("Statistical baseline — not AI", "warn"));
    el.appendChild(tabs([["revenue", "Revenue"], ["orders", "Orders"], ["expenses", "Expenses"], ["interactions", "Customer interactions"]].map(([id, l]) => ({ id, label: l })), metric, v => { c.s.m.fcMetric = v; c.rerender(); }));
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const fc = card(`Actual vs forecast · best backtest: ${best.method}`, { icon: "Telescope", sub: best.note }); const fEl = h("div", "mc-chart mc-h280"); fc.body.appendChild(fEl); g.appendChild(fc.el);
    const cats = [...best.history.map(x => monthLabel(x.m)), ...best.future.map(x => monthLabel(x.m))];
    const nH = best.history.length;
    c.ch.line(fEl, cats, [
        { name: "Actual", data: [...best.history.map(x => x.v), ...best.future.map(() => null)] },
        { name: `Fitted (${best.method})`, data: [...best.fitted.map(x => x.v), ...best.future.map(() => null)], dashed: true, area: false },
        { name: "Forecast", data: [...Array(nH - 1).fill(null), best.history[nH - 1]?.v ?? null, ...best.future.map(x => x.v)], dashed: true, area: false, band: [[...Array(nH).fill(null), ...best.future.map(x => x.lo)] as number[], [...Array(nH).fill(null), ...best.future.map(x => x.hi)] as number[]] }
    ], undefined, v => (metric === "orders" || metric === "interactions" ? String(Math.round(v)) : c.ch.short(v)));
    const mt = card("Methodology & backtest", { icon: "FlaskConical" });
    res.forEach(r => mt.body.appendChild(h("div", `mc-ins-row${r === best ? " mc-on" : ""}`, h("span", null, h("b", null, r.method), h("div", "mc-small mc-muted", r.note.split(" Band")[0])), h("span", null, `MAPE ${r.mape === null ? "n/a" : fmt.pct(r.mape)}`))));
    mt.body.appendChild(h("div", "mc-small mc-muted", "MAPE = mean |actual − fitted| ÷ actual over months where the method had enough history. Bands = ±1.96 × RMSE of backtest residuals; they assume stable errors and are indicative only. Limitations: 22 months of synthetic data, no external drivers, no seasonality test."));
    mt.body.appendChild(h("div", "mc-stat-grid", ...best.future.map(f => h("div", "mc-stat", h("span", null, monthLabel(f.m)), h("b", null, metric === "orders" || metric === "interactions" ? fmt.int(f.v) : fmt.compact(f.v)), h("span", "mc-small mc-muted", `${metric === "orders" || metric === "interactions" ? fmt.int(f.lo) : fmt.compact(f.lo)} – ${metric === "orders" || metric === "interactions" ? fmt.int(f.hi) : fmt.compact(f.hi)}`)))));
    g.appendChild(mt.el);
    // KPI dependency graph
    const sel = c.m<string>("depSel", () => "margin");
    const cur = kpis(c.ix, c.ec), prev = kpis(c.ix, c.prev);
    const val: Record<string, [number | null, number | null, (v: number) => string]> = {
        orders: [cur.revenueOrders, prev.revenueOrders, fmt.int], revenue: [cur.netRevenue, prev.netRevenue, v => fmt.compact(v)], cost: [cur.cost, prev.cost, v => fmt.compact(v)], margin: [cur.gm, prev.gm, v => fmt.pct(v)],
        collections: [cur.collectionRate, prev.collectionRate, v => fmt.pct(v)], expenses: [cur.expenses, prev.expenses, v => fmt.compact(v)], opprofit: [cur.operatingProfit, prev.operatingProfit, v => fmt.compact(v)], discount: [cur.discount, prev.discount, v => fmt.compact(v)],
        incidents: [cur.openIncidents, prev.openIncidents, fmt.int], delivery: [cur.projectCompletion, prev.projectCompletion, v => fmt.pct(v)], churn: [c.d.customers.filter(x => x.customer_status === "Churned").length / Math.max(1, c.d.customers.length), null, v => fmt.pct(v)],
        pricing: [cur.units ? (cur.netRevenue + cur.discount) / cur.units : null, prev.units ? (prev.netRevenue + prev.discount) / prev.units : null, v => fmt.money2(v)], mix: [null, null, () => "by category"], inventory: [null, null, () => "see Digital Twin"]
    };
    const up = new Set<string>(), down = new Set<string>();
    const walkUp = (id: string): void => { (KPI_DEPS.find(k => k.id === id)?.inputs ?? []).forEach(i => { if (!up.has(i)) { up.add(i); walkUp(i); } }); };
    const walkDown = (id: string): void => { KPI_DEPS.filter(k => k.inputs.includes(id)).forEach(k => { if (!down.has(k.id)) { down.add(k.id); walkDown(k.id); } }); };
    walkUp(sel); walkDown(sel);
    const dep = card("KPI dependency graph", { icon: "Waypoints", sub: "Mathematical dependencies (arrows = “is an input of”), not causal claims · click a KPI" });
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
    dep.body.appendChild(h("div", "mc-why", h("b", null, `Why did ${why.label} change? `), `Formula: ${why.formula}. `, ...why.inputs.map(i => { const v = val[i]; return v && v[0] !== null && v[1] !== null ? h("span", null, `${KPI_DEPS.find(k => k.id === i)?.label}: ${v[2](v[1] as number)} → ${v[2](v[0] as number)}. `) : h("span", null, `${KPI_DEPS.find(k => k.id === i)?.label}: no period value. `); }), h("span", "mc-muted", "Upstream drivers in teal, downstream impacts in gold.")));
    el.appendChild(dep.el);
}

// ======================================================================== Target Profiles
export function profiles(c: Ctx, el: HTMLElement): void {
    const tab = c.m<string>("profTab", () => "customers");
    title(el, "Target Profiles", "Customer 360, suppliers, products and departments · click a row to open the profile inspector.");
    el.appendChild(tabs([{ id: "customers", label: "Customers", icon: "Users", count: c.d.customers.length }, { id: "suppliers", label: "Suppliers", icon: "Truck", count: c.d.suppliers.length }, { id: "products", label: "Products", icon: "Package", count: c.d.products.length }, { id: "departments", label: "Departments", icon: "Building", count: c.d.departments.length }], tab, v => { c.s.m.profTab = v; c.rerender(); }));
    const revBy = new Map<string, number>(); c.d.sales_orders.filter(isRevenue).forEach(o => revBy.set(o.customer_id, (revBy.get(o.customer_id) ?? 0) + o.net_amount_tnd));
    const ts = c.m<TableState>(`prof-${tab}`, () => newTableState("", false, 14));
    if (tab === "customers") { el.appendChild(dataTable<Row>([{ key: "customer_name", label: "Customer", get: r => r.customer_name }, { key: "customer_segment", label: "Segment", get: r => r.customer_segment }, { key: "industry", label: "Industry", get: r => r.industry }, { key: "region", label: "Region", get: r => r.region }, { key: "customer_status", label: "Status", get: r => r.customer_status, render: r => chip(r.customer_status, tone(r.customer_status)) }, { key: "acv", label: "Contract value", get: r => r.annual_contract_value_tnd, num: true, render: r => fmt.compact(r.annual_contract_value_tnd) }, { key: "rev", label: "Revenue", get: r => revBy.get(r.customer_id) ?? 0, num: true, render: r => fmt.compact(revBy.get(r.customer_id) ?? 0) }], c.d.customers, ts, () => c.rerender(), { onRow: r => c.select("customer", r.customer_id), chooser: true, id: "pc" })); }
    if (tab === "suppliers") { el.appendChild(dataTable<Row>([{ key: "supplier_name", label: "Supplier", get: r => r.supplier_name }, { key: "supplier_category", label: "Category", get: r => r.supplier_category }, { key: "country", label: "Country", get: r => r.country }, { key: "risk_level", label: "Risk", get: r => r.risk_level, render: r => chip(r.risk_level, r.risk_level === "High" ? "bad" : r.risk_level === "Medium" ? "warn" : "good") }, { key: "quality_rating", label: "Quality", get: r => r.quality_rating, num: true }, { key: "supplier_status", label: "Status", get: r => r.supplier_status, render: r => chip(r.supplier_status, tone(r.supplier_status)) }], c.d.suppliers, ts, () => c.rerender(), { onRow: r => c.select("supplier", r.supplier_id), id: "ps" })); }
    if (tab === "products") { const pr = new Map<string, { r: number; c: number }>(); c.d.sales_order_items.forEach(l => { if (isRevenue(c.ix.order.get(l.order_id) ?? {})) { const v = pr.get(l.product_id) ?? { r: 0, c: 0 }; v.r += l.net_line_amount_tnd; v.c += l.line_cost_tnd; pr.set(l.product_id, v); } });
        el.appendChild(dataTable<Row>([{ key: "product_name", label: "Product", get: r => r.product_name }, { key: "category", label: "Category", get: r => r.category }, { key: "product_tier", label: "Tier", get: r => r.product_tier }, { key: "product_status", label: "Status", get: r => r.product_status, render: r => chip(r.product_status, tone(r.product_status)) }, { key: "rev", label: "Revenue", get: r => pr.get(r.product_id)?.r ?? 0, num: true, render: r => fmt.compact(pr.get(r.product_id)?.r ?? 0) }, { key: "margin", label: "Margin", get: r => { const v = pr.get(r.product_id); return v && v.r ? (v.r - v.c) / v.r : 0; }, num: true, render: r => { const v = pr.get(r.product_id); return fmt.pct(v && v.r ? (v.r - v.c) / v.r : null); } }], c.d.products, ts, () => c.rerender(), { onRow: r => c.select("product", r.product_id), id: "pp" })); }
    if (tab === "departments") { el.appendChild(dataTable<Row>([{ key: "department_name", label: "Department", get: r => r.department_name }, { key: "division", label: "Division", get: r => r.division }, { key: "primary_location", label: "Location", get: r => r.primary_location }, { key: "emp", label: "Employees", get: r => c.d.employees.filter(e => e.department_id === r.department_id).length, num: true }, { key: "risks", label: "Open risks", get: r => c.d.risk_register.filter(x => x.department_id === r.department_id && OPEN_RISK.has(x.mitigation_status)).length, num: true }], c.d.departments, ts, () => c.rerender(), { onRow: r => c.select("department", r.department_id), id: "pd" })); }
}
