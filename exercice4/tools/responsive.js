// Responsive web layout: no more scaling of a 1280 px canvas. Adds the mobile menu (☰ + drawer sidebar), closes it
// after navigation, re-renders on width changes, opens the calendar on Agenda on phones. Exact replacements, idempotent.
"use strict";
const fs = require("fs"), path = require("path");
const src = path.resolve(__dirname, "..", "frontend", "src");
function patch(rel, pairs) {
    const p = path.join(src, rel); let s = fs.readFileSync(p, "utf8"); let n = 0;
    for (const [a, b] of pairs) { if (s.includes(b)) { continue; } if (!s.includes(a)) { throw new Error(`${rel}: not found: ${a.slice(0, 70)}`); } s = s.replace(a, b); n++; }
    fs.writeFileSync(p, s); console.log(`${rel}: ${n}`);
}
patch("Dashboard.tsx", [
    [`        const fit = (): void => {
            const w = el.clientWidth, h = el.clientHeight;
            const scale = Math.min(1, w / MIN_W, h / MIN_H);
            stage.style.width = \`\${Math.max(w / scale, MIN_W)}px\`; stage.style.height = \`\${Math.max(h / scale, MIN_H)}px\`;
            stage.style.transform = scale < 1 ? \`scale(\${scale})\` : "";
        };
        fit();
        const ro = new ResizeObserver(() => { fit(); });`,
     `        // Responsive: the dashboard fills the window at every size (CSS breakpoints in visual.less), no scaling.
        // A width change re-renders (debounced) so charts and layouts adapt.
        let lastW = 0, resizeTimer = 0;
        const fit = (): void => {
            stage.style.width = "100%"; stage.style.height = "100%"; stage.style.transform = "";
            const w = el.clientWidth;
            if (lastW && Math.abs(w - lastW) > 40) { window.clearTimeout(resizeTimer); resizeTimer = window.setTimeout(() => app.render(), 200); }
            lastW = w;
        };
        fit();
        const ro = new ResizeObserver(() => { fit(); });`],
    ["const MIN_W = 1280, MIN_H = 720;\n", ""]
]);
patch("mc/app.ts", [
    ['${prefs.sidebar === "collapsed" ? " mc-side-collapsed" : ""}`;', '${prefs.sidebar === "collapsed" ? " mc-side-collapsed" : ""}${this.s.m.navOpen ? " mc-nav-open" : ""}`;'],
    ['h("div", "mc-body", this.sidebar(ctx), h("div", "mc-stage", this.crumbs(ctx, route), outlet)), overlay);',
     'h("div", "mc-body", this.sidebar(ctx), h("div", { class: "mc-nav-veil", onclick: () => { this.s.m.navOpen = false; this.render(); } }), h("div", "mc-stage", this.crumbs(ctx, route), outlet)), overlay);'],
    ['        return h("header", "mc-header",\n            h("div", "mc-brand",',
     '        const menu = iconBtn("Menu", "Menu des modules", () => { this.s.m.navOpen = !this.s.m.navOpen; this.render(); }, "mc-menu-btn");\n        menu.setAttribute("aria-expanded", this.s.m.navOpen ? "true" : "false");\n        return h("header", "mc-header", menu,\n            h("div", "mc-brand",'],
    ['                b.onclick = (): void => this.go(it.id);', '                b.onclick = (): void => { const wasOpen = !!this.s.m.navOpen; this.s.m.navOpen = false; if (it.id === this.s.route) { if (wasOpen) { this.render(); } } else { this.go(it.id); } };']
]);
patch("mc/core/ui.ts", [
    ["Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap, LogOut\n} from \"lucide\";", "Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap, LogOut, Menu\n} from \"lucide\";"],
    ["    Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap, LogOut\n};", "    Trophy, Truck, Type, User, Users, Wallet, Wand, Warehouse, Waypoints, X, Zap, LogOut, Menu\n};"]
]);
patch("mc/modules/ops.ts", [
    ['c.m<string>("calView", () => "month")', 'c.m<string>("calView", () => (window.innerWidth <= 640 ? "agenda" : "month"))']
]);
