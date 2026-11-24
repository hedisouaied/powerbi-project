"use strict";

/** Simulation modules: What-If + Scenario Lab (7), Crisis Simulator (25), Business Sandbox (29), Time Machine (8),
 *  Comparison Studio (24). All outputs are modeled estimates from the trailing-12-month baseline; source data is never changed. */
import type { Ctx } from "../app";
import { Row } from "../core/data";
import { addDays, baseline, crisis, CrisisResult, daysBetween, div, isRevenue, kpis, month, monthLabel, scenarioInputs, ScenarioInputs, simulate, snapshot, sum, ZERO_INPUTS, period } from "../core/engine";
import { btn, card, chip, empty, fmt, h, icon, input, range, select, tabs } from "../core/ui";

function title(el: HTMLElement, t: string, sub: string, ...extra: Node[]): void { el.appendChild(h("div", "mc-page-title", h("h1", null, t), h("span", "mc-muted", sub), h("div", "mc-row-gap mc-push", ...extra))); }
const pct = (v: number): string => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;

// ======================================================================== What-If Simulator + Scenario Lab (7)
export function whatif(c: Ctx, el: HTMLElement): void {
    const b = baseline(c.ix);
    const inp = c.m<ScenarioInputs>("wi", () => ({ ...ZERO_INPUTS }));
    const res = simulate(b, inp), base = simulate(b, ZERO_INPUTS);
    title(el, "What-If Simulator · Scenario Lab", `Baseline = actual trailing 12 months to ${fmt.date(c.ix.ref)}. First-order model: each input moves one line, no hidden elasticities.`, chip("Modeled estimate — not actual data", "warn"));
    const g = h("div", "mc-grid mc-g-wi"); el.appendChild(g);
    const ctl = card("Assumptions", { icon: "SlidersHorizontal", actions: [btn("Reset", { small: true, icon: "RotateCcw", onClick: () => { c.s.m.wi = { ...ZERO_INPUTS }; c.rerender(); } })] });
    const live = (): void => c.rerender();
    ctl.body.appendChild(h("div", "mc-row-gap mc-wrap", ...c.d.scenarios.map(sc => btn(sc.scenario_name, { small: true, kind: "ghost", title: sc.scenario_description, onClick: () => { c.s.m.wi = scenarioInputs(sc); c.toast(`Preset: ${sc.scenario_name}`, "info"); c.rerender(); } }))));
    const add = (k: keyof ScenarioInputs, label: string, min: number, max: number, step: number, f: (v: number) => string): void => { ctl.body.appendChild(range(inp[k], min, max, step, v => { inp[k] = v; window.clearTimeout(c.s.m.wiT); c.s.m.wiT = window.setTimeout(live, 120); }, label, f)); };
    add("revenuePct", "Revenue change", -0.5, 0.5, 0.01, pct); add("costPct", "Operating cost change (non-payroll, non-marketing)", -0.3, 0.5, 0.01, pct);
    add("discountPts", "Extra discount on revenue", 0, 0.2, 0.005, v => `${(v * 100).toFixed(1)} pts`); add("headcount", "Headcount change (people)", -20, 30, 1, v => `${v > 0 ? "+" : ""}${v}`);
    add("churnPct", "Customer churn (revenue lost)", 0, 0.3, 0.01, pct); add("supplierCostPct", "Supplier / product cost change", -0.2, 0.4, 0.01, pct); add("marketingPct", "Marketing spend change", -0.5, 1, 0.05, pct);
    ctl.body.appendChild(h("div", "mc-small mc-muted", `Payroll per head = trailing payroll expenses ÷ ${b.activeEmployees} active employees = ${fmt.money(b.payrollPerHead)}. Marketing changes cost only (no assumed revenue response).`));
    g.appendChild(ctl.el);
    const out = card("Projected outcome (12 months)", { icon: "Gauge" });
    const row = (l: string, a: number | null, bb: number | null, f: (v: number) => string, upGood = true): HTMLElement => { const d = a !== null && bb !== null ? a - bb : null; return h("div", "mc-out-row", h("span", null, l), h("b", null, a === null ? "—" : f(a)), h("span", `mc-small ${d === null || Math.abs(d) < 1e-9 ? "mc-muted" : (d > 0) === upGood ? "mc-tone-good" : "mc-tone-bad"}`, d === null || Math.abs(d) < 1e-9 ? "baseline" : `${d > 0 ? "+" : ""}${f(d)}`)); };
    out.body.append(row("Revenue", res.revenue, base.revenue, v => fmt.compact(v)), row("Product cost", res.productCost, base.productCost, v => fmt.compact(v), false), row("Operating expenses", res.opex, base.opex, v => fmt.compact(v), false), row("Gross profit", res.grossProfit, base.grossProfit, v => fmt.compact(v)), row("Gross margin", res.margin, base.margin, v => fmt.pct(v)), row("Operating profit", res.operatingProfit, base.operatingProfit, v => fmt.compact(v)), row("Cash / collection proxy", res.cash, base.cash, v => fmt.compact(v)), row("Risk score (0-100)", res.risk, base.risk, v => String(Math.round(v)), false));
    out.body.appendChild(h("div", "mc-small mc-muted", "Risk score = margin erosion (max 40) + churn (max 30) + operating loss / halved profit (30/15). Cash proxy = revenue × trailing collection rate."));
    g.appendChild(out.el);
    const br = card("Bridge from baseline profit to scenario profit", { icon: "ChartBar" }); const brEl = h("div", "mc-chart mc-h260"); br.body.appendChild(brEl); g.appendChild(br.el);
    c.ch.waterfall(brEl, [...res.bridge.map((x, i) => ({ name: x.step, value: x.value, total: i === 0 })), { name: "Scenario profit", value: res.operatingProfit, total: true }], v => fmt.compact(v));
    // Scenario Lab: save & compare (saved in the report prefs)
    const lab = card("Scenario Lab — saved scenarios (kept in this report)", { icon: "FlaskConical" });
    const nm = input(c.s.m.wiName ?? "", v => { c.s.m.wiName = v; }, "Scenario name", "text", "wi-name");
    lab.body.appendChild(h("div", "mc-chat-input", nm, btn("Save current", { small: true, icon: "Save", onClick: () => { const name = (c.s.m.wiName || `Scenario ${c.store.prefs.scenarios.length + 1}`).trim(); c.store.prefs.scenarios = c.store.prefs.scenarios.filter(x => x.name !== name).concat({ name, inputs: { ...inp }, saved: c.ix.ref }); c.store.savePrefs(); c.s.m.wiName = ""; c.toast(`Saved “${name}”`); c.rerender(); } })));
    const all = [{ name: "Baseline", inputs: ZERO_INPUTS }, ...c.d.scenarios.map(sc => ({ name: sc.scenario_name, inputs: scenarioInputs(sc) })), ...c.store.prefs.scenarios];
    const tbl = h("table", "mc-table", h("thead", null, h("tr", null, ...["Scenario", "Revenue", "Gross margin", "Op. profit", "Cash proxy", "Risk", ""].map(x => h("th", null, x)))));
    const tb = h("tbody"); tbl.appendChild(tb);
    all.forEach(sc => { const r = simulate(b, sc.inputs); const saved = c.store.prefs.scenarios.some(x => x.name === sc.name); tb.appendChild(h("tr", null, h("td", null, h("b", null, sc.name), saved ? chip("saved", "info") : null), h("td", "mc-num", fmt.compact(r.revenue)), h("td", "mc-num", fmt.pct(r.margin)), h("td", "mc-num", h("span", r.operatingProfit >= base.operatingProfit ? "mc-tone-good" : "mc-tone-bad", fmt.compact(r.operatingProfit))), h("td", "mc-num", fmt.compact(r.cash)), h("td", "mc-num", String(r.risk)), h("td", null, h("div", "mc-row-gap", btn("Load", { small: true, kind: "ghost", onClick: () => { c.s.m.wi = { ...sc.inputs }; c.rerender(); } }), saved ? btn("", { small: true, icon: "Trash", title: "Delete", onClick: () => { c.store.prefs.scenarios = c.store.prefs.scenarios.filter(x => x.name !== sc.name); c.store.savePrefs(); c.rerender(); } }) : null)))); });
    lab.body.appendChild(h("div", "mc-table-scroll", tbl));
    lab.body.appendChild(h("details", "mc-export", h("summary", null, icon("FileText", 14), "Scenario summary (copy / export)"), h("pre", "mc-pre", [`Scenario summary — baseline trailing 12 months to ${c.ix.ref}`, ...all.map(sc => { const r = simulate(b, sc.inputs); return `${sc.name}: revenue ${Math.round(r.revenue)} TND, margin ${(100 * (r.margin ?? 0)).toFixed(1)}%, operating profit ${Math.round(r.operatingProfit)} TND, risk ${r.risk}`; }), "Modeled estimates, not predictions."].join("\n"))));
    el.appendChild(lab.el);
}

// ======================================================================== Crisis Simulator (25)
export function crisisSim(c: Ctx, el: HTMLElement): void {
    const b = baseline(c.ix);
    const tpl = c.m<string>("crTpl", () => "revenue"); const sev = c.m<Record<string, number>>("crSev", () => ({ revenue: 0.2, cost: 0.2, churn: 0.12, supplier: 0.2, system: 0.5 }));
    const presets: Record<string, number[]> = { revenue: [0.1, 0.2, 0.4], cost: [0.1, 0.2, 0.3], churn: [0.05, 0.12, 0.2], supplier: [0.1, 0.25, 0.5], system: [0.25, 0.5, 1] };
    const r = crisis(c.ix, b, tpl as "revenue" | "cost" | "churn" | "supplier" | "system", sev[tpl]);
    title(el, "Business Crisis Simulator", "Select a crisis template and severity; see first-order consequences, most exposed areas and recovery levers.", chip("Modeled estimate — not a prediction or financial advice", "warn"));
    el.appendChild(tabs([["revenue", "Revenue shock", "TrendingDown"], ["cost", "Cost surge", "Coins"], ["churn", "Churn spike", "Users"], ["supplier", "Supplier disruption", "Truck"], ["system", "System incident", "Server"]].map(([id, l, ic]) => ({ id, label: l, icon: ic })), tpl, v => { c.s.m.crTpl = v; c.rerender(); }));
    const g = h("div", "mc-grid mc-g-wi"); el.appendChild(g);
    const ctl = card("Severity", { icon: "Flame" });
    ctl.body.appendChild(h("div", "mc-row-gap", ...presets[tpl].map(p => btn(tpl === "system" ? ["Minor", "Major", "Severe"][presets[tpl].indexOf(p)] : (tpl === "churn" ? "+" : tpl === "revenue" ? "−" : "+") + Math.round(p * 100) + "%", { small: true, kind: Math.abs(sev[tpl] - p) < 1e-9 ? "primary" : "ghost", onClick: () => { sev[tpl] = p; c.rerender(); } }))));
    ctl.body.appendChild(range(sev[tpl], 0.01, tpl === "system" ? 1 : 0.6, 0.01, v => { sev[tpl] = v; window.clearTimeout(c.s.m.crT); c.s.m.crT = window.setTimeout(() => c.rerender(), 120); }, "Severity", v => tpl === "system" ? `${Math.round(v * 100)}% (factor ${(1 + v * 4).toFixed(1)})` : `${Math.round(v * 100)}%`));
    ctl.body.appendChild(h("div", "mc-small", r.explanation));
    ctl.body.appendChild(btn("Reset", { small: true, icon: "RotateCcw", onClick: () => { c.s.m.crSev = undefined; c.rerender(); } }));
    g.appendChild(ctl.el);
    const out = card("First-order impact", { icon: "TriangleAlert", cls: "mc-card-danger" });
    out.body.appendChild(h("div", "mc-stat-grid", h("div", "mc-stat", h("span", null, "Exposure"), h("b", "mc-tone-bad", fmt.compact(r.exposure))), h("div", "mc-stat", h("span", null, "Profit impact"), h("b", "mc-tone-bad", fmt.compact(r.profitImpact))), h("div", "mc-stat", h("span", null, "Baseline op. profit"), h("b", null, fmt.compact(b.revenue - b.productCost - b.opex))), h("div", "mc-stat", h("span", null, "After crisis"), h("b", null, fmt.compact(b.revenue - b.productCost - b.opex + r.profitImpact)))));
    const recov = r.levers.reduce((s2, l) => s2 + l.offset, 0);
    out.body.appendChild(h("div", "mc-small mc-muted", `All four recovery levers together would offset ${fmt.compact(recov)} (${fmt.pct(div(recov, -r.profitImpact))} of the profit impact).`));
    g.appendChild(out.el);
    const ex = card("Most exposed", { icon: "Crosshair" }); const exEl = h("div", "mc-chart mc-h260"); ex.body.appendChild(exEl); g.appendChild(ex.el);
    if (r.affected.length) { c.ch.bars(exEl, r.affected.slice(0, 10).map(a => ({ name: a.name, value: a.value, color: c.t.bad })), { horizontal: true, fmt: v => fmt.compact(v) }); } else { exEl.appendChild(empty("No exposed entity")); }
    const lv = card("Recovery levers", { icon: "Wand" });
    r.levers.forEach(l => lv.body.appendChild(h("div", "mc-out-row", h("span", null, l.lever, h("div", "mc-small mc-muted", l.note)), h("b", "mc-tone-good", `+${fmt.compact(l.offset)}`))));
    el.appendChild(lv.el);
    const cmp = card("Compare crisis templates at their current severity", { icon: "Columns2" }); const cEl = h("div", "mc-chart mc-h220"); cmp.body.appendChild(cEl); el.appendChild(cmp.el);
    const all = (["revenue", "cost", "churn", "supplier", "system"] as const).map(t => ({ name: t, value: -crisis(c.ix, b, t, sev[t]).profitImpact }));
    c.ch.bars(cEl, all.map(a => ({ name: a.name, value: a.value, color: a.name === tpl ? c.t.bad : c.t.warn })), { fmt: v => fmt.compact(v), onClick: p => { c.s.m.crTpl = p.name; c.rerender(); } });
}

// ======================================================================== Business Sandbox (29)
export function sandbox(c: Ctx, el: HTMLElement): void {
    const sb = c.m<Record<string, { price?: number; cost?: number; status?: string }>>("sandbox", () => ({}));
    const p = period("12m", c.ix.ref, c.ix.first);
    const lines = c.d.sales_order_items.filter(l => { const o = c.ix.order.get(l.order_id); return o && isRevenue(o) && o.order_date >= p.from; });
    const byProd = new Map<string, { qty: number; rev: number; cost: number }>(); lines.forEach(l => { const v = byProd.get(l.product_id) ?? { qty: 0, rev: 0, cost: 0 }; v.qty += l.quantity; v.rev += l.net_line_amount_tnd; v.cost += l.line_cost_tnd; byProd.set(l.product_id, v); });
    title(el, "Business Sandbox", "An isolated copy of the product price list. Change prices, costs or retire products and compare with the real baseline. Source data and the model are untouched.", chip("Sandbox — isolated, session only", "warn"), btn("Reset sandbox", { icon: "RotateCcw", onClick: () => { c.s.m.sandbox = {}; c.rerender(); } }));
    let baseRev = 0, baseCost = 0, simRev = 0, simCost = 0;
    const rows = c.d.products.map(pr => {
        const v = byProd.get(pr.product_id) ?? { qty: 0, rev: 0, cost: 0 }; const x = sb[pr.product_id] ?? {};
        const priceFactor = x.price !== undefined && pr.list_price_tnd ? x.price / pr.list_price_tnd : 1; const costFactor = x.cost !== undefined && pr.unit_cost_tnd ? x.cost / pr.unit_cost_tnd : 1; const retired = (x.status ?? pr.product_status) === "Retired" && pr.product_status !== "Retired";
        const sr = retired ? 0 : v.rev * priceFactor, sc = retired ? 0 : v.cost * costFactor;
        baseRev += v.rev; baseCost += v.cost; simRev += sr; simCost += sc;
        return { pr, v, x, sr, sc };
    });
    el.appendChild(h("div", "mc-grid mc-g-4", ...[["Baseline revenue (12m)", fmt.compact(baseRev)], ["Sandbox revenue", fmt.compact(simRev)], ["Baseline margin", fmt.pct(div(baseRev - baseCost, baseRev))], ["Sandbox margin", fmt.pct(div(simRev - simCost, simRev))]].map(([l, v]) => h("div", "mc-stat-card", h("b", null, v), h("span", null, l)))));
    el.appendChild(h("div", "mc-hint", icon("Info", 14), "Hypothesis model: historical quantities are kept (no price elasticity), revenue scales with your price change, cost with your cost change; retiring a product removes its revenue and cost."));
    const tbl = h("table", "mc-table", h("thead", null, h("tr", null, ...["Product", "Category", "Units (12m)", "List price", "Sandbox price", "Unit cost", "Sandbox cost", "Status", "Revenue Δ", "Margin"].map(x => h("th", null, x)))));
    const tb = h("tbody"); tbl.appendChild(tb);
    rows.sort((a, b) => b.v.rev - a.v.rev).forEach(({ pr, v, x, sr, sc }) => {
        const num = (val: number | undefined, base: number, key: "price" | "cost"): HTMLElement => { const i = h("input", { type: "number", class: "mc-input mc-input-sm", step: "0.01", "aria-label": `${pr.product_name} ${key}`, "data-focus": `sb-${pr.product_id}-${key}` }) as HTMLInputElement; i.value = String(val ?? base); i.onchange = (): void => { const n = Number(i.value); (sb[pr.product_id] ?? (sb[pr.product_id] = {}))[key] = n > 0 ? n : base; c.rerender(); }; return i; };
        const changed = x.price !== undefined || x.cost !== undefined || x.status !== undefined;
        tb.appendChild(h("tr", changed ? "mc-row-on" : "", h("td", null, pr.product_name), h("td", null, pr.category), h("td", "mc-num", fmt.int(v.qty)), h("td", "mc-num", fmt.money2(pr.list_price_tnd)), h("td", null, num(x.price, pr.list_price_tnd, "price")), h("td", "mc-num", fmt.money2(pr.unit_cost_tnd)), h("td", null, num(x.cost, pr.unit_cost_tnd, "cost")),
            h("td", null, select([{ value: "Active", label: "Active" }, { value: "Retired", label: "Retired" }], x.status ?? pr.product_status, val => { (sb[pr.product_id] ?? (sb[pr.product_id] = {})).status = val; c.rerender(); })),
            h("td", "mc-num", h("span", sr - v.rev >= 0 ? "mc-tone-good" : "mc-tone-bad", `${sr - v.rev >= 0 ? "+" : ""}${fmt.compact(sr - v.rev)}`)), h("td", "mc-num", fmt.pct(div(sr - sc, sr)))));
    });
    el.appendChild(h("div", "mc-table-scroll", tbl));
}

// ======================================================================== Time Machine (8)
export function timemachine(c: Ctx, el: HTMLElement): void {
    const first = addDays(c.ix.first, 29), last = c.ix.ref;
    const total = daysBetween(first, last);
    const tm = c.m<{ pos: number; playing: boolean; speed: number; cmp: number; step: number }>("tm", () => ({ pos: total, playing: false, speed: 1, cmp: Math.max(0, total - 365), step: 7 }));
    const date = addDays(first, tm.pos), dateB = addDays(first, tm.cmp);
    const snap = snapshot(c.ix, date, c.ec.dept), snapB = snapshot(c.ix, dateB, c.ec.dept);
    title(el, "Business Time Machine", "Deterministic replay from the fact tables: every frame is the trailing 30 days ending on the scrubber date.");
    const stop = (): void => { tm.playing = false; window.clearInterval(c.s.m.tmTimer); };
    const play = (): void => { tm.playing = true; window.clearInterval(c.s.m.tmTimer); c.s.m.tmTimer = window.setInterval(() => { if (!c.app.s.m.tm || c.s.route !== "timemachine") { window.clearInterval(c.s.m.tmTimer); return; } tm.pos = Math.min(total, tm.pos + tm.step); if (tm.pos >= total) { stop(); } c.rerender(); }, 700 / tm.speed); };
    const ctl = h("div", "mc-tm-controls",
        btn("", { icon: "SkipBack", title: "Step back", onClick: () => { stop(); tm.pos = Math.max(0, tm.pos - tm.step); c.rerender(); } }),
        btn(tm.playing ? "Pause" : "Play", { icon: tm.playing ? "Pause" : "Play", kind: "primary", onClick: () => { if (tm.playing) { stop(); } else { if (tm.pos >= total) { tm.pos = 0; } play(); } c.rerender(); } }),
        btn("", { icon: "SkipForward", title: "Step forward", onClick: () => { stop(); tm.pos = Math.min(total, tm.pos + tm.step); c.rerender(); } }),
        btn("Reset", { icon: "RotateCcw", small: true, onClick: () => { stop(); tm.pos = total; c.rerender(); } }),
        select([{ value: "1", label: "1 day" }, { value: "7", label: "1 week" }, { value: "30", label: "1 month" }], String(tm.step), v => { tm.step = Number(v); c.rerender(); }, "Step"),
        select([{ value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }], String(tm.speed), v => { tm.speed = Number(v); if (tm.playing) { play(); } c.rerender(); }, "Speed"),
        h("b", "mc-tm-date", fmt.date(date)));
    el.appendChild(ctl);
    const scr = h("input", { type: "range", class: "mc-range mc-scrubber", min: 0, max: total, step: 1, "aria-label": "Date scrubber" }) as HTMLInputElement; scr.value = String(tm.pos);
    scr.oninput = (): void => { stop(); tm.pos = Number(scr.value); window.clearTimeout(c.s.m.tmT); c.s.m.tmT = window.setTimeout(() => c.rerender(), 60); };
    const marks = h("div", "mc-tm-marks");
    c.d.incidents.filter(i => i.severity === "Critical").forEach(i => { const x = daysBetween(first, i.incident_date) / total; if (x >= 0 && x <= 1) { marks.appendChild(h("span", { class: "mc-tm-mark mc-bg-bad", style: { left: `${x * 100}%` }, title: `Critical incident ${i.incident_id} · ${fmt.date(i.incident_date)}` })); } });
    c.d.alerts.filter(a => a.severity === "Critical").forEach(a => { const x = daysBetween(first, a.alert_date) / total; if (x >= 0 && x <= 1) { marks.appendChild(h("span", { class: "mc-tm-mark mc-tm-mark-alert mc-bg-warn", style: { left: `${x * 100}%` }, title: `Critical alert ${a.alert_id} · ${fmt.date(a.alert_date)}` })); } });
    el.appendChild(h("div", "mc-tm-track", marks, scr, h("div", "mc-tm-ends", h("span", null, fmt.date(first)), h("span", "mc-small mc-muted", "red = critical incident · amber = critical alert"), h("span", null, fmt.date(last)))));
    const tiles = [["Revenue (30d)", snap.revenue, snapB.revenue, (v: number) => fmt.compact(v), true], ["Revenue orders", snap.orders, snapB.orders, fmt.int, true], ["Collections", snap.collections, snapB.collections, (v: number) => fmt.compact(v), true], ["Expenses", snap.expenses, snapB.expenses, (v: number) => fmt.compact(v), false], ["Incidents logged", snap.incidents, snapB.incidents, fmt.int, false], ["Critical incidents", snap.criticalIncidents, snapB.criticalIncidents, fmt.int, false], ["Alerts", snap.alerts, snapB.alerts, fmt.int, false]] as Array<[string, number, number, (v: number) => string, boolean]>;
    el.appendChild(h("div", "mc-grid mc-g-4", ...tiles.map(([l, a, b2, f, up]) => h("div", "mc-stat-card mc-tm-tile", h("span", null, l), h("b", null, f(a)), h("span", `mc-small ${a === b2 ? "mc-muted" : (a > b2) === up ? "mc-tone-good" : "mc-tone-bad"}`, `vs ${fmt.date(dateB)}: ${f(b2)}`)))));
    const cmp = card("Two-date comparison", { icon: "Columns2", sub: "Pick the comparison date" }); const cs = h("input", { type: "range", class: "mc-range", min: 0, max: total, step: 1, "aria-label": "Comparison date" }) as HTMLInputElement; cs.value = String(tm.cmp); cs.onchange = (): void => { tm.cmp = Number(cs.value); c.rerender(); };
    cmp.body.append(h("div", "mc-row-gap", h("span", null, "Comparison date:"), h("b", null, fmt.date(dateB))), cs); el.appendChild(cmp.el);
    const hist = card("Replay curve (trailing-30-day revenue, weekly frames)", { icon: "ChartLine" }); const hEl = h("div", "mc-chart mc-h220"); hist.body.appendChild(hEl); el.appendChild(hist.el);
    const frames: Array<{ d: string; v: number | null }> = []; for (let i = 0; i <= total; i += 7) { const d = addDays(first, i); frames.push({ d, v: i <= tm.pos ? snapshot(c.ix, d, c.ec.dept).revenue : null }); }
    c.ch.line(hEl, frames.map(f => fmt.date(f.d)), [{ name: "Revenue (30d)", data: frames.map(f => f.v) }], undefined, v => c.ch.short(v));
}

// ======================================================================== Comparison Studio (24)
export function compare(c: Ctx, el: HTMLElement): void {
    const kind = c.m<string>("cmpKind", () => "departments");
    title(el, "Comparison Studio", "Side-by-side comparison with normalised metrics; the larger value is highlighted when “higher is better”, otherwise the smaller one.");
    el.appendChild(tabs([["departments", "Departments"], ["products", "Products"], ["customers", "Customers"], ["regions", "Regions"], ["employees", "Employees"], ["periods", "Periods"], ["scenarios", "Scenarios"]].map(([id, l]) => ({ id, label: l })), kind, v => { c.s.m.cmpKind = v; c.s.m.cmpA = ""; c.s.m.cmpB = ""; c.rerender(); }));
    const p = c.ec.p; const inP = (iso: string): boolean => iso >= p.from && iso <= p.to;
    type M = Array<{ label: string; a: number | null; b: number | null; f: (v: number) => string; better: "high" | "low" }>;
    let options: Array<{ value: string; label: string }> = [], metrics: (a: string, b: string) => M = () => [];
    const revOrders = c.d.sales_orders.filter(o => isRevenue(o) && inP(o.order_date));
    if (kind === "departments") { options = c.d.departments.map(d => ({ value: d.department_id, label: d.department_name })); metrics = (a, b) => { const ka = kpis(c.ix, { p, dept: a }), kb = kpis(c.ix, { p, dept: b }); const emp = (d: string): number => c.d.employees.filter(e => e.department_id === d).length || 1; return [{ label: "Revenue (sales owner)", a: ka.netRevenue, b: kb.netRevenue, f: v => fmt.compact(v), better: "high" }, { label: "Revenue per employee", a: ka.netRevenue / emp(a), b: kb.netRevenue / emp(b), f: v => fmt.compact(v), better: "high" }, { label: "Expenses", a: ka.expenses, b: kb.expenses, f: v => fmt.compact(v), better: "low" }, { label: "Expenses per employee", a: ka.expenses / emp(a), b: kb.expenses / emp(b), f: v => fmt.compact(v), better: "low" }, { label: "Open incidents", a: ka.openIncidents, b: kb.openIncidents, f: fmt.int, better: "low" }, { label: "Overdue tasks", a: ka.overdueTasks, b: kb.overdueTasks, f: fmt.int, better: "low" }, { label: "Project completion", a: ka.projectCompletion, b: kb.projectCompletion, f: v => fmt.pct(v), better: "high" }]; }; }
    if (kind === "products") { options = c.d.products.map(x => ({ value: x.product_id, label: x.product_name })); metrics = (a, b) => { const st = (id: string): { r: number; c: number; q: number } => { const ls = c.d.sales_order_items.filter(l => l.product_id === id && revOrders.some(o => o.order_id === l.order_id)); return { r: sum(ls, l => l.net_line_amount_tnd), c: sum(ls, l => l.line_cost_tnd), q: sum(ls, l => l.quantity) }; }; const x = st(a), y = st(b); return [{ label: "Revenue", a: x.r, b: y.r, f: v => fmt.compact(v), better: "high" }, { label: "Units", a: x.q, b: y.q, f: fmt.int, better: "high" }, { label: "Margin", a: div(x.r - x.c, x.r), b: div(y.r - y.c, y.r), f: v => fmt.pct(v), better: "high" }, { label: "Revenue per unit", a: div(x.r, x.q), b: div(y.r, y.q), f: v => fmt.money2(v), better: "high" }]; }; }
    if (kind === "customers") { options = c.d.customers.map(x => ({ value: x.customer_id, label: `${x.customer_name} (${x.region})` })); metrics = (a, b) => { const st = (id: string): { r: number; n: number; od: number; acv: number } => { const os = revOrders.filter(o => o.customer_id === id); return { r: sum(os, o => o.net_amount_tnd), n: os.length, od: sum(c.d.payments.filter(pm => pm.payment_status === "Overdue" && c.ix.order.get(pm.order_id)?.customer_id === id), pm => pm.amount_tnd), acv: c.ix.cust.get(id)?.annual_contract_value_tnd ?? 0 }; }; const x = st(a), y = st(b); return [{ label: "Revenue", a: x.r, b: y.r, f: v => fmt.compact(v), better: "high" }, { label: "Orders", a: x.n, b: y.n, f: fmt.int, better: "high" }, { label: "Avg order", a: div(x.r, x.n), b: div(y.r, y.n), f: v => fmt.compact(v), better: "high" }, { label: "Overdue amount (all time)", a: x.od, b: y.od, f: v => fmt.compact(v), better: "low" }, { label: "Contract value", a: x.acv, b: y.acv, f: v => fmt.compact(v), better: "high" }]; }; }
    if (kind === "regions") { options = Array.from(new Set(c.d.customers.map(x => x.region))).sort().map(r => ({ value: r, label: r })); metrics = (a, b) => { const st = (r: string): { rev: number; n: number; cu: number; ar: number } => { const cs = c.d.customers.filter(x => x.region === r); const ids = new Set(cs.map(x => x.customer_id)); const os = revOrders.filter(o => ids.has(o.customer_id)); return { rev: sum(os, o => o.net_amount_tnd), n: os.length, cu: cs.length, ar: cs.filter(x => x.customer_status === "At Risk").length }; }; const x = st(a), y = st(b); return [{ label: "Revenue", a: x.rev, b: y.rev, f: v => fmt.compact(v), better: "high" }, { label: "Customers", a: x.cu, b: y.cu, f: fmt.int, better: "high" }, { label: "Revenue per customer", a: div(x.rev, x.cu), b: div(y.rev, y.cu), f: v => fmt.compact(v), better: "high" }, { label: "At-risk share", a: div(x.ar, x.cu), b: div(y.ar, y.cu), f: v => fmt.pct(v), better: "low" }]; }; }
    if (kind === "employees") { options = c.d.employees.map(x => ({ value: x.employee_id, label: `${x.employee_name} · ${x.job_title}` })); metrics = (a, b) => { const st = (id: string): number[] => [sum(revOrders.filter(o => o.sales_owner_id === id), o => o.net_amount_tnd), c.d.tasks.filter(t => t.assignee_employee_id === id && t.task_status !== "Done").length, c.d.tasks.filter(t => t.assignee_employee_id === id && t.task_status === "Done").length, c.d.calendar_events.filter(e => e.owner_employee_id === id).length]; const x = st(a), y = st(b); return [{ label: "Revenue as sales owner", a: x[0], b: y[0], f: v => fmt.compact(v), better: "high" }, { label: "Open tasks", a: x[1], b: y[1], f: fmt.int, better: "low" }, { label: "Completed tasks", a: x[2], b: y[2], f: fmt.int, better: "high" }, { label: "Calendar events", a: x[3], b: y[3], f: fmt.int, better: "low" }]; }; }
    if (kind === "periods") { const months = Array.from(new Set(c.d.sales_orders.map(o => month(o.order_date)))).sort(); options = months.map(m => ({ value: m, label: monthLabel(m) })); metrics = (a, b) => { const k = (m: string): ReturnType<typeof kpis> => kpis(c.ix, { p: { from: m + "-01", to: m + "-31", label: m }, dept: c.ec.dept }); const x = k(a), y = k(b); return [{ label: "Net revenue", a: x.netRevenue, b: y.netRevenue, f: v => fmt.compact(v), better: "high" }, { label: "Orders", a: x.orders, b: y.orders, f: fmt.int, better: "high" }, { label: "Gross margin", a: x.gm, b: y.gm, f: v => fmt.pct(v), better: "high" }, { label: "Collection rate", a: x.collectionRate, b: y.collectionRate, f: v => fmt.pct(v), better: "high" }, { label: "Expenses", a: x.expenses, b: y.expenses, f: v => fmt.compact(v), better: "low" }]; }; }
    if (kind === "scenarios") { const all = [{ name: "Baseline", inputs: ZERO_INPUTS }, ...c.d.scenarios.map(sc => ({ name: sc.scenario_name, inputs: scenarioInputs(sc) })), ...c.store.prefs.scenarios]; options = all.map(x => ({ value: x.name, label: x.name })); const b0 = baseline(c.ix); metrics = (a, b) => { const x = simulate(b0, all.find(s2 => s2.name === a)?.inputs ?? ZERO_INPUTS), y = simulate(b0, all.find(s2 => s2.name === b)?.inputs ?? ZERO_INPUTS); return [{ label: "Revenue", a: x.revenue, b: y.revenue, f: v => fmt.compact(v), better: "high" }, { label: "Gross margin", a: x.margin, b: y.margin, f: v => fmt.pct(v), better: "high" }, { label: "Operating profit", a: x.operatingProfit, b: y.operatingProfit, f: v => fmt.compact(v), better: "high" }, { label: "Cash proxy", a: x.cash, b: y.cash, f: v => fmt.compact(v), better: "high" }, { label: "Risk score", a: x.risk, b: y.risk, f: v => String(Math.round(v)), better: "low" }]; }; }
    const A = c.s.m.cmpA || options[0]?.value || "", B = c.s.m.cmpB || options[1]?.value || "";
    el.appendChild(h("div", "mc-filters", select(options, A, v => { c.s.m.cmpA = v; c.rerender(); }, "A"), select(options, B, v => { c.s.m.cmpB = v; c.rerender(); }, "B"), btn("Swap", { small: true, icon: "Shuffle", onClick: () => { c.s.m.cmpA = B; c.s.m.cmpB = A; c.rerender(); } })));
    if (!A || !B) { el.appendChild(empty("Nothing to compare.")); return; }
    const ms = metrics(A, B); const la = options.find(o => o.value === A)?.label ?? A, lb = options.find(o => o.value === B)?.label ?? B;
    const t = h("table", "mc-table mc-compare", h("thead", null, h("tr", null, h("th", null, "Metric"), h("th", "mc-num", la), h("th", "mc-num", lb), h("th", "mc-num", "Difference"), h("th", null, "A vs B (normalised)"))));
    const tb = h("tbody"); t.appendChild(tb);
    ms.forEach(m => { const aW = m.a !== null && m.b !== null && (m.better === "high" ? m.a > m.b : m.a < m.b), bW = m.a !== null && m.b !== null && m.a !== m.b && !aW; const mx = Math.max(Math.abs(m.a ?? 0), Math.abs(m.b ?? 0)) || 1;
        tb.appendChild(h("tr", null, h("td", null, m.label, h("span", "mc-small mc-muted", m.better === "high" ? " (higher is better)" : " (lower is better)")), h("td", `mc-num${aW ? " mc-win" : ""}`, m.a === null ? "—" : m.f(m.a)), h("td", `mc-num${bW ? " mc-win" : ""}`, m.b === null ? "—" : m.f(m.b)), h("td", "mc-num", m.a !== null && m.b !== null ? `${m.a - m.b >= 0 ? "+" : ""}${m.f(m.a - m.b)}` : "—"),
            h("td", null, h("div", "mc-dual-bar", h("div", { class: "mc-bar-a", style: { width: `${(Math.abs(m.a ?? 0) / mx) * 50}%` } }), h("div", { class: "mc-bar-b", style: { width: `${(Math.abs(m.b ?? 0) / mx) * 50}%` } }))))); });
    el.appendChild(h("div", "mc-table-scroll", t));
    el.appendChild(h("div", "mc-legend", h("span", null, h("i", "mc-dot-legend mc-bg-accent"), `A · ${la}`), h("span", null, h("i", "mc-dot-legend mc-bg-teal"), `B · ${lb}`)));
}
// unused import guard
export const __row: Row | null = null;
