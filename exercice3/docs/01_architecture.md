# Architecture

## Overview

```
 Mission_Control_Enterprise/*.csv  (31 tables + dim_date, synthetic, TND)
        │  Power Query (powerquery/*.pq: fnCleanText, typed columns)
        ▼
 MissionControl.SemanticModel (TMDL)
   32 tables · 61 relationships (12 inactive) · 62 catalogue measures · 'Revenue Shock' what-if
   31 "Feed <table>" measures  ──►  compact JSON {c, r}
        │  one data role per table (capabilities.json)
        ▼
 MissionControl.Report  ─ ONE page (1600×900) ─ ONE custom visual: "Mission Control"
   visual.ts      Power BI entry point: reads feeds and saved objects, persistProperties, downloadService, scaling
   app.ts         shell: header (Ctrl+K search, theme switch, bell, profile), status ribbon,
                  sidebar (33 modules), breadcrumbs, outlet, overlays (palette, inspector, drawers, toasts)
   core/          data.ts (decode, workspace patches, indexes) · engine.ts (pure business logic)
                  state.ts (prefs / workspace / session) · theme.ts (tokens) · ui.ts (components) · charts.ts (ECharts)
   modules/       command · ops · intel · sim · world · datamods · inspector · registry
```

Power BI gives a custom visual no API to change report pages. So every "page" is a module rendered by the one visual, and the sidebar switches between them inside the visual. The project rule that each page holds one TypeScript visual and no native slicers or charts is met: the page carries no other visual.

## Modules and features

| Group | Module | Features |
|---|---|---|
| Command | Command Center | 3. Dashboard builder: KPI cards, 3D campus hero, health, assistant, sales, regions, risk radar, calendar, missions, tasks, quick actions, crisis, matrix, ticker |
| Command | War Room | 28 |
| Command | Financial Terminal | 22 |
| Command | Storytelling | 23 |
| Command | Executive Brief | — |
| Operations | Mission Queue | Case board |
| Operations | Missions | 26 |
| Operations | Tasks | 13 |
| Operations | Projects | 14 |
| Operations | Approvals | 15 |
| Operations | Calendar | 16 |
| Operations | Decisions | 12 |
| Operations | Notifications | 2 |
| Operations | Collaboration | 18 |
| Operations | Audit | 17 |
| Intelligence | Assistant | 6 |
| Intelligence | Detective | 27 |
| Intelligence | Network | 20 |
| Intelligence | Risk Radar | 10. Anomalies |
| Intelligence | Root Cause | 9 |
| Intelligence | Forecast | KPI dependency graph |
| Intelligence | Profiles | — |
| Simulation | What-If and Scenario Lab | 7 |
| Simulation | Crisis | 25 |
| Simulation | Sandbox | 29 |
| Simulation | Time Machine | 8 |
| Simulation | Comparison Studio | 24 |
| World | Digital Twin, 2D and 3D | 11 and 19 |
| World | Geo | 21 |
| Data | Explorer | 5 |
| Data | Data Doctor | — |
| Data | Sources and lineage | — |
| System | Settings and Help | 1 (palette is global), 4 |

Every module is a plain function, `render(ctx, el)`. The context gives each module:
- the dataset with edits applied, plus lookup indexes;
- the period and department filters, with the previous period;
- theme tokens, a chart helper and the store;
- `go`, `select` (opens the global inspector), `rerender`, `toast`;
- a session-memory helper `m(key, init)`.

## State and persistence

| Kind | Examples | Where it lives |
|---|---|---|
| Preferences | Theme, accent, density, font, motion, sidebar, landing page, KPI cards, widget layout, watchlist, saved scenarios | Visual object `prefs.json`, via `persistProperties`. Kept when the report is saved. |
| Workspace edits | Tasks, events, approvals, decisions, comments, case status and notes, notification state, acknowledgements, reviewed checks, audit entries | **Off by default:** memory only, labelled "Demo session — not saved". **On** ("Keep my edits in this report"): visual object `workspace.json`. |
| Session | Route, filters, selections, drawers, search text, sliders, sandbox edits, time machine position | Memory only |
| Source data | CSV files and semantic model | Never modified by the visual |

Edits are patches on top of the model rows: `{added, changed, removed}` per table. `applyWorkspace` merges them before each render, so every module sees the same edited data. The visual uses no `localStorage`, no network and no `eval`.

## Engine

`core/engine.ts` is pure TypeScript with no DOM and no Power BI API, so it runs in Node for tests. It holds:
- periods and time intelligence;
- KPIs;
- department health (score of 100 minus transparent penalties);
- What changed;
- mission-queue priority: 40 × severity + 30 × impact + 20 × age + 10 × confidence;
- risk score;
- anomaly rules;
- Data Doctor checks with the score formula;
- forecasts: moving average, linear and seasonal naive, with backtest MAPE and ±1.96 × RMSE bands;
- revenue decomposition (root cause);
- scenario simulation with a profit bridge;
- crisis templates with recovery levers;
- calendar recurrence expansion and conflict detection;
- time-machine snapshots;
- the relationship graph and shortest path.

## Design system and motion

**Tokens.** `theme.ts` defines tokens for dark and light, plus four accents: gold (default), teal, blue and violet. They are written as `--mc-*` CSS variables. Density and font scale are tokens too.

**Look.** Black glass panels with a gold accent line and glow, after the reference image. The light theme uses warm paper and the same structure.

**Motion.** 160–420 ms, with a spring-like cubic-bezier. Only transform and opacity are animated. Motion covers:
- page enter with stagger;
- drawer slide, modal and palette scale-in, toast in and out;
- KPI count-up;
- gauge and ring draw, bar and Gantt grow;
- sparkline draw;
- Kanban card pop;
- flowing edges, only on the heaviest flows;
- a pulse, only on critical incidents.

Nothing loops except the ticker, the slow campus ring, and flows or pulses that carry meaning. Count-ups run once per navigation, not on every re-render.

**Reduced motion.** Settings › Motion › Reduced, and the operating system's `prefers-reduced-motion`, both switch every animation off.

## Accessibility

- Real `button`, `select` and `input` elements.
- `aria-label` on icon buttons, charts and 3D objects.
- `role="dialog"` on drawers, modals and the palette.
- `aria-current` on the active navigation item.
- Visible `:focus-visible` ring.
- Keyboard support:
  - Ctrl+K palette with arrow keys, Enter and Esc;
  - Enter on rows, nodes and cards;
  - arrow keys move Kanban cards and story slides;
  - a node list for the graph, and the 2D map as the 3D fallback.

## Performance

- Feeds are decoded once per data change (cached by feed length).
- Lookup indexes are built once per render.
- Charts are created after the DOM is attached and disposed on every re-render.
- Tables paginate.
- The graph shows the top 140 nodes by degree.
- The Kanban shows up to 40 cards per lane; your own new and edited tasks always come first.
- ECharts is tree-shaken, and lucide icons are imported one by one.
- The package is about 345 KB.

## Tests

| Tool | What it does |
|---|---|
| `tools/test-engine.ps1` | Engine vs. DAX on the live model: 28 + 18 KPIs, plus 17 unit tests |
| `tools/preview.ps1` | Renders the packaged visual in headless Chrome with a fake host. Saves screenshots per module and theme. |
| `tools/ui-test.js` | 19 interaction checks run in the preview: task create and validation, persistence and reopen, palette, theme, reviewed marks, CSV export, what-if, every module under a department filter, no storage |
