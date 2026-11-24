"use strict";

/** World modules: Business Digital Twin (11) with a 2D operations map, and the 3D Interactive Environment (19) built with
 *  CSS 3D transforms (no WebGL library: small bundle, works in the Power BI sandbox; 2D map is the fallback).
 *  Geographical Intelligence (21): schematic tile map of the 7 Tunisian regions present in the data — no fabricated coordinates. */
import type { Ctx } from "../app";
import { Row } from "../core/data";
import { day, isRevenue, kpis, OPEN_INCIDENT, sum } from "../core/engine";
import { bar, btn, card, chip, fmt, h, icon, iconBtn, s, select, tabs } from "../core/ui";

function title(el: HTMLElement, t: string, sub: string, ...extra: Node[]): void { el.appendChild(h("div", "mc-page-title", h("h1", null, t), h("span", "mc-muted", sub), h("div", "mc-row-gap mc-push", ...extra))); }

// ------------------------------------------------------------------ 3D campus (CSS 3D)
interface Block { id: string; kind: "Department" | "Warehouse"; label: string; x: number; y: number; w: number; d: number; hgt: number; tone: string; metric: string; onClick: () => void }
function blocks(c: Ctx): Block[] {
    const out: Block[] = [];
    const deps = c.d.departments;
    const maxEmp = Math.max(1, ...deps.map(d => c.d.employees.filter(e => e.department_id === d.department_id).length));
    deps.forEach((d, i) => {
        const emp = c.d.employees.filter(e => e.department_id === d.department_id).length;
        const crit = c.d.incidents.filter(x => x.department_id === d.department_id && OPEN_INCIDENT.has(x.incident_status) && x.severity === "Critical").length;
        out.push({ id: d.department_id, kind: "Department", label: d.department_name, x: (i % 4) * 92 - 138, y: Math.floor(i / 4) * 96 - 96, w: 64, d: 64, hgt: 40 + 120 * (emp / maxEmp), tone: crit > 3 ? "bad" : crit > 0 ? "warn" : "accent", metric: `${emp} people · ${crit} critical incidents`, onClick: () => c.select("department", d.department_id) });
    });
    const wh = Array.from(new Set(c.d.inventory_snapshots.map(i => i.warehouse))).sort();
    wh.forEach((w, i) => {
        const latest = new Map<string, Row>(); c.d.inventory_snapshots.filter(x => x.warehouse === w).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).forEach(x => latest.set(x.product_id, x));
        const low = Array.from(latest.values()).filter(x => x.quantity_on_hand < x.reorder_point).length;
        out.push({ id: w, kind: "Warehouse", label: w, x: i * 128 - 128, y: 120, w: 100, d: 50, hgt: 34, tone: low > 5 ? "warn" : "teal", metric: `${latest.size} products · ${low} below reorder point`, onClick: () => { c.s.m.twinSel = `wh:${w}`; c.rerender(); } });
    });
    return out;
}
export function campus(c: Ctx, host: HTMLElement, opts: { mini?: boolean } = {}): void {
    const view = c.m<{ rx: number; rz: number; zoom: number; px: number; py: number }>("campusView", () => ({ rx: 58, rz: -38, zoom: 1, px: 0, py: 0 }));
    const scene = h("div", { class: `mc-scene${opts.mini ? " mc-scene-mini" : ""}`, role: "group", "aria-label": "3D campus: departments and warehouses" });
    const world = h("div", "mc-world"); world.style.transform = `translate(${view.px}px, ${view.py}px) scale(${opts.mini ? 0.62 : view.zoom}) rotateX(${view.rx}deg) rotateZ(${view.rz}deg)`;
    world.appendChild(h("div", "mc-ground"));
    world.appendChild(h("div", "mc-ground-ring"));
    blocks(c).forEach(b => {
        const el = h("button", { class: `mc-block mc-block-${b.tone}${b.kind === "Warehouse" ? " mc-block-wh" : ""}`, type: "button", style: { width: `${b.w}px`, height: `${b.d}px`, transform: `translate3d(${b.x}px, ${b.y}px, 0)` }, "aria-label": `${b.kind} ${b.label}: ${b.metric}`, title: `${b.label} · ${b.metric}` });
        const z = b.hgt;
        el.appendChild(h("div", { class: "mc-face mc-top", style: { transform: `translateZ(${z}px)` } }, h("span", null, b.label)));
        el.appendChild(h("div", { class: "mc-face mc-front", style: { height: `${z}px`, transform: `rotateX(-90deg) translateZ(0px)`, transformOrigin: "top", top: `${b.d}px` } }));
        el.appendChild(h("div", { class: "mc-face mc-wall", style: { width: `${z}px`, transform: "rotateY(90deg)", transformOrigin: "left", left: `${b.w}px` } }));
        el.onclick = (e): void => { e.stopPropagation(); b.onClick(); };
        world.appendChild(el);
    });
    scene.appendChild(world);
    if (!opts.mini) {
        let drag: { x: number; y: number; rz: number; rx: number } | null = null;
        scene.onmousedown = (e: MouseEvent): void => { drag = { x: e.clientX, y: e.clientY, rz: view.rz, rx: view.rx }; };
        scene.onmousemove = (e: MouseEvent): void => { if (!drag) { return; } view.rz = drag.rz + (e.clientX - drag.x) * 0.4; view.rx = Math.max(20, Math.min(80, drag.rx - (e.clientY - drag.y) * 0.3)); world.style.transform = `translate(${view.px}px, ${view.py}px) scale(${view.zoom}) rotateX(${view.rx}deg) rotateZ(${view.rz}deg)`; };
        scene.onmouseup = scene.onmouseleave = (): void => { drag = null; };
        scene.onwheel = (e: WheelEvent): void => { e.preventDefault(); view.zoom = Math.max(0.5, Math.min(2.2, view.zoom - e.deltaY * 0.001)); world.style.transform = `translate(${view.px}px, ${view.py}px) scale(${view.zoom}) rotateX(${view.rx}deg) rotateZ(${view.rz}deg)`; };
    }
    host.appendChild(scene);
}

// ------------------------------------------------------------------ Digital Twin (11) + 3D environment (19)
export function twin(c: Ctx, el: HTMLElement): void {
    const mode = c.m<string>("twinMode", () => "2d");
    const view = c.m<{ rx: number; rz: number; zoom: number; px: number; py: number }>("campusView", () => ({ rx: 58, rz: -38, zoom: 1, px: 0, py: 0 }));
    title(el, "Business Digital Twin", "Departments, warehouses, projects, suppliers and customer regions with flows sized by real metrics. Historical synthetic data — not live telemetry.",
        tabs([{ id: "2d", label: "2D operations map", icon: "Network" }, { id: "3d", label: "3D environment", icon: "Cuboid" }], mode, v => { c.s.m.twinMode = v; c.rerender(); }));
    const g = h("div", "mc-grid mc-g-graph"); el.appendChild(g);
    if (mode === "3d") {
        const cd = card("3D campus", { icon: "Rotate3d", sub: "Drag to rotate · wheel to zoom · click a building · height = headcount, colour = critical incidents, warehouses = low stock", actions: [
            iconBtn("RotateCcw", "Rotate left", () => { view.rz -= 20; c.rerender(); }), iconBtn("RefreshCw", "Rotate right", () => { view.rz += 20; c.rerender(); }),
            iconBtn("Plus", "Zoom in", () => { view.zoom = Math.min(2.2, view.zoom + 0.15); c.rerender(); }), iconBtn("Minus", "Zoom out", () => { view.zoom = Math.max(0.5, view.zoom - 0.15); c.rerender(); }),
            iconBtn("ArrowLeft", "Pan left", () => { view.px -= 40; c.rerender(); }), iconBtn("ArrowRight", "Pan right", () => { view.px += 40; c.rerender(); }),
            btn("Reset view", { small: true, onClick: () => { c.s.m.campusView = { rx: 58, rz: -38, zoom: 1, px: 0, py: 0 }; c.rerender(); } })] });
        campus(c, cd.body);
        cd.body.appendChild(h("div", "mc-small mc-muted", "Keyboard: Tab to a building, Enter to inspect. If 3D transforms are unavailable, use the 2D operations map tab (same data, same interactions)."));
        g.appendChild(cd.el);
    } else {
        const cd = card("Operations map", { icon: "Network", sub: "Line thickness = flow volume (revenue, inventory or tasks) · animated when it carries the most volume", actions: [iconBtn("Plus", "Zoom in", () => { c.s.m.twinZoom = Math.min(2, (c.s.m.twinZoom ?? 1) + 0.2); c.rerender(); }), iconBtn("Minus", "Zoom out", () => { c.s.m.twinZoom = Math.max(0.6, (c.s.m.twinZoom ?? 1) - 0.2); c.rerender(); }), btn("Reset", { small: true, onClick: () => { c.s.m.twinZoom = 1; c.s.m.twinPan = 0; c.rerender(); } })] });
        const W = 900, H = 440, z = c.s.m.twinZoom ?? 1, pan = c.s.m.twinPan ?? 0;
        const svg = s("svg", { viewBox: `${(W - W / z) / 2 - pan} ${(H - H / z) / 2} ${W / z} ${H / z}`, class: "mc-twin2d", role: "img", "aria-label": "Operations map" });
        const col = (xs: string[], x: number): Map<string, { x: number; y: number }> => { const m = new Map<string, { x: number; y: number }>(); xs.forEach((id, i) => m.set(id, { x, y: 40 + (i + 0.5) * ((H - 60) / Math.max(1, xs.length)) })); return m; };
        const suppliers = c.d.suppliers.slice().sort((a, b) => a.risk_level.localeCompare(b.risk_level)).slice(0, 12);
        const whs = Array.from(new Set(c.d.inventory_snapshots.map(i => i.warehouse))).sort();
        const deps = c.d.departments.map(d => d.department_id);
        const regions = Array.from(new Set(c.d.customers.map(x => x.region))).sort();
        const projects = c.d.projects.slice(0, 10);
        const P = { s: col(suppliers.map(x => x.supplier_id), 70), w: col(whs, 250), d: col(deps, 450), p: col(projects.map(x => x.project_id), 640), r: col(regions, 820) };
        const flows: Array<{ a: { x: number; y: number }; b: { x: number; y: number }; v: number; label: string }> = [];
        suppliers.forEach(sp => whs.forEach(w => { const v = c.d.inventory_snapshots.filter(i => i.supplier_id === sp.supplier_id && i.warehouse === w).reduce((a, i) => a + i.quantity_on_hand, 0); if (v) { flows.push({ a: P.s.get(sp.supplier_id)!, b: P.w.get(w)!, v, label: `${sp.supplier_name} → ${w}: ${v} units on hand (snapshots)` }); } }));
        whs.forEach((w, i) => { const d = deps[i % deps.length]; const ops = c.d.departments.find(x => x.department_name === "Operations" || x.department_name === "Supply Chain")?.department_id ?? d; flows.push({ a: P.w.get(w)!, b: P.d.get(ops)!, v: 1, label: `${w} serves ${c.ix.deptName(ops)}` }); });
        projects.forEach(pj => { const v = c.d.tasks.filter(t => t.project_id === pj.project_id && t.task_status !== "Done").length; flows.push({ a: P.d.get(pj.department_id)!, b: P.p.get(pj.project_id)!, v: Math.max(1, v), label: `${c.ix.deptName(pj.department_id)} → ${pj.project_name}: ${v} open tasks` }); });
        regions.forEach(r => deps.forEach(d => { const v = sum(c.d.sales_orders.filter(o => isRevenue(o) && c.ix.cust.get(o.customer_id)?.region === r && c.ix.empDept(o.sales_owner_id) === d), o => o.net_amount_tnd); if (v) { flows.push({ a: P.d.get(d)!, b: P.r.get(r)!, v: v / 1e5, label: `${c.ix.deptName(d)} → ${r}: ${fmt.compact(v)} revenue` }); } }));
        const maxV = Math.max(...flows.map(f => f.v));
        flows.forEach(f => { if (!f.a || !f.b) { return; } const w = 0.6 + 5 * (f.v / maxV); svg.appendChild(s("path", { d: `M${f.a.x},${f.a.y} C${(f.a.x + f.b.x) / 2},${f.a.y} ${(f.a.x + f.b.x) / 2},${f.b.y} ${f.b.x},${f.b.y}`, class: `mc-flow${f.v / maxV > 0.4 && !c.reduced ? " mc-edge-flow" : ""}`, "stroke-width": w.toFixed(2) }, s("title", {}, document.createTextNode(f.label) as any))); });
        const node = (pos: { x: number; y: number } | undefined, label: string, kind: string, toneC: string, onClick: () => void, sub = ""): void => { if (!pos) { return; } const gg = s("g", { class: `mc-twin-node mc-fill-${toneC}`, transform: `translate(${pos.x},${pos.y})`, tabindex: "0", role: "button", "aria-label": `${kind} ${label} ${sub}` }); gg.appendChild(s("rect", { x: "-62", y: "-13", width: "124", height: "26", rx: "7" })); const t = s("text", { x: "0", y: "4", "text-anchor": "middle" }); t.textContent = label.length > 18 ? label.slice(0, 17) + "…" : label; gg.appendChild(t); const tt = s("title", {}); tt.textContent = `${kind}: ${label} ${sub}`; gg.appendChild(tt); gg.addEventListener("click", onClick); gg.addEventListener("keydown", (e: Event) => { if ((e as KeyboardEvent).key === "Enter") { onClick(); } }); svg.appendChild(gg); };
        ["Suppliers", "Warehouses", "Departments", "Projects", "Customer regions"].forEach((l, i) => { const t = s("text", { x: String([70, 250, 450, 640, 820][i]), y: "20", "text-anchor": "middle", class: "mc-twin-col" }); t.textContent = l; svg.appendChild(t); });
        suppliers.forEach(sp => node(P.s.get(sp.supplier_id), sp.supplier_name, "Supplier", sp.risk_level === "High" ? "bad" : sp.risk_level === "Medium" ? "warn" : "good", () => c.select("supplier", sp.supplier_id), `risk ${sp.risk_level}`));
        whs.forEach(w => node(P.w.get(w), w, "Warehouse", "teal", () => { c.s.m.twinSel = `wh:${w}`; c.rerender(); }));
        c.d.departments.forEach(d => { const crit = c.d.incidents.filter(x => x.department_id === d.department_id && OPEN_INCIDENT.has(x.incident_status) && x.severity === "Critical").length; node(P.d.get(d.department_id), d.department_name, "Department", crit > 3 ? "bad" : crit ? "warn" : "accent", () => c.select("department", d.department_id), `${crit} critical incidents`); });
        projects.forEach(pj => node(P.p.get(pj.project_id), pj.project_name, "Project", pj.project_status === "At Risk" ? "bad" : pj.project_status === "Completed" ? "good" : "info", () => c.select("project", pj.project_id), pj.project_status));
        regions.forEach(r => node(P.r.get(r), r, "Region", "violet", () => { c.s.m.geoSel = r; c.go("geo"); }));
        cd.body.appendChild(svg);
        cd.body.appendChild(h("div", "mc-row-gap", btn("Pan left", { small: true, icon: "ArrowLeft", onClick: () => { c.s.m.twinPan = (c.s.m.twinPan ?? 0) + 60; c.rerender(); } }), btn("Pan right", { small: true, icon: "ArrowRight", onClick: () => { c.s.m.twinPan = (c.s.m.twinPan ?? 0) - 60; c.rerender(); } }), h("span", "mc-small mc-muted", "Top 12 suppliers and 10 projects shown for readability.")));
        g.appendChild(cd.el);
    }
    // inspector column
    const side = card("Selected node", { icon: "Crosshair" });
    const sel = c.s.m.twinSel as string | undefined;
    if (sel?.startsWith("wh:")) {
        const w = sel.slice(3); const latest = new Map<string, Row>(); c.d.inventory_snapshots.filter(x => x.warehouse === w).sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date)).forEach(x => latest.set(x.product_id, x));
        const rows = Array.from(latest.values()); const low = rows.filter(x => x.quantity_on_hand < x.reorder_point);
        side.body.append(h("b", null, w), h("div", "mc-small mc-muted", `${rows.length} products at latest snapshot · ${low.length} below reorder point · ${rows.reduce((a, x) => a + x.quantity_on_hand, 0)} units`));
        low.slice(0, 10).forEach(x => { const r = h("div", "mc-ins-row mc-click", h("span", null, c.ix.prodName(x.product_id)), h("span", "mc-tone-warn mc-small", `${x.quantity_on_hand} < ${x.reorder_point}`)); r.onclick = (): void => c.select("product", x.product_id); side.body.appendChild(r); });
    } else {
        side.body.appendChild(h("div", "mc-muted", "Click a department, warehouse, supplier, project or region. Departments, suppliers and projects open the full inspector."));
        const k = kpis(c.ix, c.ec);
        side.body.appendChild(h("div", "mc-stat-grid", h("div", "mc-stat", h("span", null, "Revenue"), h("b", null, fmt.compact(k.netRevenue))), h("div", "mc-stat", h("span", null, "Open incidents"), h("b", null, String(k.openIncidents))), h("div", "mc-stat", h("span", null, "Overdue tasks"), h("b", null, String(k.overdueTasks)))));
    }
    g.appendChild(side.el);
}

// ------------------------------------------------------------------ Geographical Intelligence (21)
const TILES: Record<string, { col: number; row: number }> = { Bizerte: { col: 1, row: 0 }, Tunis: { col: 2, row: 1 }, Nabeul: { col: 3, row: 1 }, Sousse: { col: 3, row: 2 }, Monastir: { col: 3, row: 3 }, Sfax: { col: 2, row: 4 }, Gabes: { col: 1, row: 5 } };
export function geo(c: Ctx, el: HTMLElement): void {
    const metric = c.m<string>("geoMetric", () => "revenue");
    const sel = c.m<string>("geoSel", () => "");
    const seg = c.m<string>("geoSeg", () => "");
    title(el, "Geographical Intelligence", "Schematic tile map of the customer regions in the data (relative north-to-south positions, not to scale; no coordinates are fabricated). Warehouses and employee locations are shown as text.");
    const regions = Array.from(new Set(c.d.customers.map(x => x.region))).sort();
    const stats = new Map<string, { rev: number; cust: number; atRisk: number; churned: number; orders: number; acv: number }>();
    regions.forEach(r => { const cs = c.d.customers.filter(x => x.region === r && (!seg || x.customer_segment === seg)); const ids = new Set(cs.map(x => x.customer_id)); const os = c.d.sales_orders.filter(o => isRevenue(o) && ids.has(o.customer_id) && day(o.order_date) >= c.ec.p.from && day(o.order_date) <= c.ec.p.to); stats.set(r, { rev: sum(os, o => o.net_amount_tnd), cust: cs.length, atRisk: cs.filter(x => x.customer_status === "At Risk").length, churned: cs.filter(x => x.customer_status === "Churned").length, orders: os.length, acv: sum(cs, x => x.annual_contract_value_tnd) }); });
    const val = (r: string): number => { const x = stats.get(r)!; return metric === "revenue" ? x.rev : metric === "customers" ? x.cust : metric === "atrisk" ? (x.cust ? x.atRisk / x.cust : 0) : x.acv; };
    const fmtV = (v: number): string => metric === "atrisk" ? fmt.pct(v) : metric === "customers" ? fmt.int(v) : fmt.compact(v);
    const max = Math.max(...regions.map(val), 1);
    el.appendChild(h("div", "mc-filters", tabs([["revenue", "Revenue"], ["customers", "Customers"], ["atrisk", "At-risk share"], ["acv", "Contract value"]].map(([id, l]) => ({ id, label: l })), metric, v => { c.s.m.geoMetric = v; c.rerender(); }),
        select(Array.from(new Set(c.d.customers.map(x => x.customer_segment))).sort().map(v => ({ value: v, label: v })), seg, v => { c.s.m.geoSeg = v; c.rerender(); }, "Segment (territory filter)", "All"), sel ? btn("Clear region", { small: true, icon: "X", onClick: () => { c.s.m.geoSel = ""; c.rerender(); } }) : null));
    const g = h("div", "mc-grid mc-g-2"); el.appendChild(g);
    const map = card("Tunisia — customer regions", { icon: "Map", sub: "Tile intensity = selected metric · click a region to filter" });
    const grid = h("div", "mc-tilemap");
    regions.forEach(r => { const t = TILES[r] ?? { col: 0, row: 6 }; const v = val(r); const b = h("button", { class: `mc-tile${sel === r ? " mc-on" : ""}`, type: "button", style: { gridColumn: String(t.col + 1), gridRow: String(t.row + 1) }, "aria-label": `${r}: ${fmtV(v)}` }, h("b", null, r), h("span", null, fmtV(v))); b.style.setProperty("--mc-int", String(0.15 + 0.85 * (v / max))); b.onclick = (): void => { c.s.m.geoSel = sel === r ? "" : r; c.rerender(); }; grid.appendChild(b); });
    map.body.appendChild(grid);
    const wh = Array.from(new Set(c.d.inventory_snapshots.map(i => i.warehouse))).sort(); const loc = Array.from(new Set(c.d.employees.map(e => e.location))).sort();
    map.body.appendChild(h("div", "mc-small mc-muted", `Warehouses: ${wh.join(", ")} · Offices (employee locations): ${loc.map(l => `${l} (${c.d.employees.filter(e => e.location === l).length})`).join(", ")}`));
    g.appendChild(map.el);
    const cmp = card("Region comparison", { icon: "Columns2" });
    const tbl = h("table", "mc-table", h("thead", null, h("tr", null, ...["Region", "Revenue", "Orders", "Customers", "At risk", "Churned", "Contract value"].map(x => h("th", null, x)))));
    const tb = h("tbody"); tbl.appendChild(tb);
    regions.slice().sort((a, b) => val(b) - val(a)).forEach(r => { const x = stats.get(r)!; const tr = h("tr", { class: `mc-click${sel === r ? " mc-row-on" : ""}` }, h("td", null, h("b", null, r)), h("td", "mc-num", fmt.compact(x.rev)), h("td", "mc-num", String(x.orders)), h("td", "mc-num", String(x.cust)), h("td", "mc-num", `${x.atRisk} (${fmt.pct(x.cust ? x.atRisk / x.cust : 0, 0)})`), h("td", "mc-num", String(x.churned)), h("td", "mc-num", fmt.compact(x.acv))); tr.onclick = (): void => { c.s.m.geoSel = r; c.rerender(); }; tb.appendChild(tr); });
    cmp.body.appendChild(h("div", "mc-table-scroll", tbl));
    const bEl = h("div", "mc-chart mc-h200"); cmp.body.appendChild(bEl);
    c.ch.bars(bEl, regions.map(r => ({ name: r, value: val(r) })), { fmt: fmtV, selected: sel, onClick: p => { c.s.m.geoSel = p.name; c.rerender(); } });
    g.appendChild(cmp.el);
    if (sel) {
        const cs = c.d.customers.filter(x => x.region === sel && (!seg || x.customer_segment === seg));
        const det = card(`${sel} · customers`, { icon: "Users" });
        cs.sort((a, b) => b.annual_contract_value_tnd - a.annual_contract_value_tnd).slice(0, 15).forEach(x => { const r = h("div", "mc-ins-row mc-click", h("span", null, x.customer_name), chip(x.customer_status, x.customer_status === "Active" ? "good" : x.customer_status === "At Risk" ? "warn" : "bad"), h("span", "mc-small mc-muted", `${x.customer_segment} · ${fmt.compact(x.annual_contract_value_tnd)}`)); r.onclick = (): void => c.select("customer", x.customer_id); det.body.appendChild(r); });
        det.body.appendChild(bar(cs.length / Math.max(1, c.d.customers.length)));
        el.appendChild(det.el);
    }
    el.appendChild(h("div", "mc-hint", icon("Info", 14), "A real map would need a map visual or geo library and permission to load map tiles; this schematic avoids external calls and invented coordinates."));
}
