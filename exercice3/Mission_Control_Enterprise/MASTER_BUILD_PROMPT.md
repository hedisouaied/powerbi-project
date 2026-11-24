# MASTER BUILD PROMPT — MISSION CONTROL INTELLIGENCE PLATFORM
## Power BI + TypeScript Custom Visuals | Enterprise Edition

You are a senior Power BI architect, TypeScript engineer, data modeler, UX designer, and analytics product developer. Build a polished, application-like enterprise intelligence platform inside Power BI. This is not a conventional report. It should feel like a sophisticated mission-control terminal inspired by the supplied reference screenshot: dense but readable panels, a central command surface, left-side network/relationship visualization, right-side inspector, bottom operational workspaces, dark charcoal surfaces, cyan/teal signals, amber highlights, restrained red warnings, crisp typography, subtle glass effects, and excellent information hierarchy.

The platform name is **MISSION CONTROL — Enterprise Intelligence Terminal**. Do not copy the screenshot's company names, intelligence theme, logos, or exact labels. Translate its visual language into a legitimate business operations command center.

## 1. Non-negotiable project constraints
- Target: Power BI Desktop and Power BI Service-compatible custom visual architecture where feasible.
- Main implementation: TypeScript custom visual(s), HTML/SVG/Canvas as appropriate, CSS, DAX measures, and Power Query for data preparation.
- Use the supplied CSV dataset folder. All data is synthetic; currency is TND.
- Initial scope: **no external backend**. Do not pretend that data changes are written back to CSV, a database, or Power BI's source model.
- Implement working client-side interactions and simulations using in-memory state, disconnected tables, DAX What-If parameters, and Power BI selection/filter APIs as appropriate.
- Persist only through supported Power BI mechanisms such as the visual's persisted properties when available and appropriate. Clearly distinguish session state from persisted state.
- Do not use arbitrary browser APIs, localStorage, network requests, eval, dynamic code execution, or unrestricted external scripts. Respect the Power BI custom visual sandbox, capabilities.json permissions, API version, host APIs, data roles, data-view limits, and certification/security constraints.
- If a feature requires an API, authentication, durable writeback, background job, or external AI model, build a realistic disabled/demo integration panel and document the exact future architecture. Do not fake a real integration.
- Do not put all logic into one enormous visual. Propose a modular architecture with reusable components and separate visuals/modules where practical.
- The dashboard must remain usable when data is empty, filtered to zero rows, or contains null values.

## 2. Visual direction and responsive layout
Create two complete themes:
1. **Dark Mission Control** — near-black/navy background, layered graphite panels, cyan/teal active states, amber focus/high-priority elements, red only for critical alerts.
2. **Light Command Desk** — warm off-white/light grey surfaces, dark text, subtle borders, cyan/blue active states, amber highlights. Ensure contrast and chart readability.

Add a visible theme switcher in the global header. Theme choice must update every component consistently. Use CSS variables/design tokens rather than duplicated styles.

Desktop-first layout, responsive down to tablet width:
- Global header: product mark/name, environment badge, global search/command palette, theme switcher, help, user/profile placeholder.
- Status ribbon: operational health, open alerts, active incidents, revenue pulse, data freshness, selected period.
- Left rail/panel: relationship graph / entity map, quick filters, selected entity summary.
- Center stage: large command interface with prompt/search field and action shortcuts: Investigate, Analyze, Simulate, Monitor, Decide, Explore.
- Right inspector: selected customer/project/department/alert details, evidence, KPI context, recommended next steps.
- Bottom workspace tabs/panels: Mission Queue, Case Board, Risk Radar, New Connections, Terminal/Activity Feed, Task Manager.
- Use a grid system with collapsible panels, sensible minimum sizes, scrollable panel bodies, clear empty states, and no overlap.
- Include micro-interactions: hover states, focus rings, animated state transitions, skeleton loading, subtle count-up KPI animations, animated alert pulses only for critical events, graph node highlighting, and reduced-motion support.
- Avoid excessive neon, constant movement, illegible tiny text, and decorative animations that compete with data.

## 3. Global application shell and navigation
Create a consistent shell with these modules and a persistent navigation model:
1. Command Center
2. Mission Queue
3. Data Sources
4. Case Board
5. Synthesis / Executive Brief
6. Target Profiles (customers, suppliers, products, departments)
7. Investigator
8. AI Task Manager
9. Scenario Lab
10. Digital Twin
11. Risk & Alerts
12. Data Doctor
13. Data Explorer
14. Decision Register
15. Calendar & Scheduling
16. Approval Workflow
17. Mission Control / Missions
18. Business Sandbox
19. Comparison Studio
20. Business Detective
21. Executive War Room
22. Financial Terminal
23. Interactive Storytelling
24. Geographical Intelligence
25. Settings / Help

Navigation must be functional. If implemented as a single custom visual, use internal view routing and preserve selected context. If split into multiple custom visuals, explain how report-page navigation and cross-filtering will work. Include breadcrumbs, active navigation state, and a back-to-previous-view action.

## 4. Feature requirements — implement real demo behavior

### A. Command Center
- Executive KPI cards: revenue, gross margin, order count, average order value, payment collection, open incidents, at-risk customers, project delivery.
- Period comparison: current vs previous period, target vs actual, trend direction.
- Department health matrix with status and drill-through.
- Critical alert ticker and operational status indicators.
- Click a KPI to open its inspector with contributing records and trend.
- Include an executive overview and a "what changed?" summary based on deterministic rules/DAX, not fabricated AI.

### B. Global Command Palette
- Keyboard shortcut Ctrl+K where supported by the visual host.
- Search pages, modules, customers, products, orders, projects, tasks, alerts and actions.
- Keyboard navigation, recent searches, clear action, and no-result state.
- If keyboard capture is restricted, provide a visible search control and explain the limitation.

### C. Mission Queue and Case Board
- Unified queue of alerts, incidents, overdue tasks, at-risk projects, and data-quality issues.
- Filter by severity, owner, department, status, type, and date.
- Case detail drawer with summary, linked records, timeline, notes field, and recommended next step.
- Allow client-side status changes and assignment simulation; label these as session-only.
- Provide priority scoring with transparent rules (severity, estimated impact, age, confidence).

### D. Investigator / Business Detective
- Investigation workspace with entity search and relationship graph.
- Select a customer, supplier, product, employee, project, order, or incident and show connected entities.
- Evidence board with draggable evidence cards if supported; otherwise use sortable evidence list.
- Build an investigation timeline from orders, payments, incidents, interactions, alerts, and activity.
- Show relationship paths and highlight suspicious links.
- Include a demo investigation scenario with a clear synthetic-data label.
- Do not claim that graph relationships prove wrongdoing; use neutral language such as "requires review" or "unusual pattern".

### E. Risk Radar
- Multi-dimensional risk visualization: financial, operational, customer, supplier, project, data quality, security/process.
- Show severity, confidence, exposure estimate, owner, and mitigation status.
- Allow selecting a risk to filter the rest of the report.
- Use transparent scoring and explain the score components.

### F. What-If Simulator and Scenario Lab
- Adjustable controls for revenue change, cost change, discount rate, headcount, churn, supplier cost, and marketing spend.
- Compare Base Case, Demand Surge, Cost Pressure, Customer Churn, Supplier Shock, and Growth Strategy.
- Show projected revenue, cost, gross profit, margin, cash/collection proxy, and risk score.
- Display waterfall or bridge from baseline to scenario.
- Allow saving multiple scenarios in the current session and comparing them side by side.
- Include reset and scenario export/summary.
- State assumptions and distinguish scenario outputs from actual historical data.
- Use DAX What-If parameters or disconnected parameter tables where suitable; do not mutate source CSVs.

### G. Business Crisis Simulator
Provide selectable crisis templates:
- Revenue shock (-10%, -20%, -40%)
- Operating cost surge (+10%, +20%, +30%)
- Customer churn spike (+5%, +12%, +20%)
- Supplier disruption (lead time/cost shock)
- Major system incident (service impact and estimated financial exposure)
For each, calculate first-order consequences, identify the most exposed departments/customers/products, and show recovery levers. Clearly label these as modeled estimates, not predictions or financial advice.

### H. Business Time Machine / Replay
- Date range and playback controls: play, pause, step forward/back, speed, reset.
- Animate daily/weekly/monthly KPI evolution and incident/alert events.
- Compare two selected dates.
- Provide a scrubber and event markers.
- Ensure the playback is deterministic and derived from the date dimension/fact records.

### I. Digital Twin / Operations Map
- Interactive representation of departments, warehouses, projects, suppliers, customers, and process links.
- Use SVG/Canvas or a suitable 3D library only if bundle size, performance, and sandbox compatibility are acceptable.
- Provide 2D fallback if 3D is unavailable.
- Click a node to inspect KPIs and connected entities.
- Animate flow intensity based on grounded metrics.
- Include legend, zoom, pan, reset, and keyboard-accessible node selection.
- Do not imply real-time telemetry; dataset is historical/synthetic.

### J. KPI Dependency Graph
- Show relationships among revenue, orders, pricing, discount, product mix, cost, gross margin, collections, churn, inventory, incidents, and delivery.
- Selecting a KPI highlights upstream drivers and downstream impacts.
- Provide a "why did this change?" path with values and evidence.
- Clearly distinguish mathematical dependencies from causal claims.

### K. Predictive Analytics
- Build baseline forecasts for revenue, orders, expenses, and customer interactions using transparent methods (moving average, linear trend, or seasonal naive).
- Show actual vs forecast, confidence bands only when methodologically justified, and forecast error where backtesting is possible.
- Do not label a simple extrapolation as AI.
- Include a forecast methodology panel and limitations.

### L. AI Business Assistant (integration-ready)
- Provide a chat-like interface with suggested questions, conversation panel, selected context, and response citations to underlying table/row context where feasible.
- In no-backend mode, implement a deterministic local assistant using curated analytical intents and precomputed measures; label it "Demo Assistant — rule-based".
- Create a clean adapter interface for a future secured API integration. Do not expose API keys in the visual or embed secrets.
- Suggested prompts: "What changed this month?", "Which departments have the highest open risk?", "Explain the margin decline", "Which customers are at risk?", "What should I investigate next?"
- Never invent an insight when the data does not support it.

### M. AI Task Manager / Productivity
- Kanban board: Backlog, To Do, In Progress, Blocked, Done.
- Create/edit task form, owner, priority, due date, project and department.
- Search, filter, drag-and-drop status changes, task detail drawer.
- Include task templates generated from alert/incident context.
- Changes are in-memory/session-only in no-backend mode. Show a clear "Demo session — changes are not written to source data" indicator.

### N. Project Management
- Gantt/timeline view, milestones, budget vs actual proxy, owner, status, completion.
- Flag late and at-risk projects using date and status rules.
- Link project tasks and incidents.
- Add filters and project detail inspector.

### O. Decision Impact Tracker
- Decision register with proposed, approved, rejected, implemented, and measuring statuses.
- Capture decision type, owner, expected impact, expected KPI change and actual KPI change.
- Compare expected vs actual outcome.
- Show decision timeline and learning notes.
- Create new decisions in session state only.

### P. Customer and Supplier Intelligence
- Customer 360 profile: segment, industry, region, contract value, order history, payment behavior, interaction history, churn-risk indicators.
- Supplier profile: category, country, risk, quality rating, related inventory, disruption exposure.
- Product profile: category, tier, sales, margin, inventory position, supplier links.
- Include search, profile tabs, relationship graph and action shortcuts.

### Q. Advanced Data Explorer
- Searchable/sortable table with column chooser, filters, pagination/virtualization, row details, multi-select and export where supported.
- Show data lineage/source table and selected row context.
- Avoid loading unbounded datasets into one visual; aggregate and paginate appropriately.
- Provide CSV export only if permitted by the visual host and data export settings.

### R. Data Doctor / Quality Observatory
- Detect missing values, duplicates, invalid dates, referential integrity breaks, outliers, inconsistent status values, and amount mismatches.
- Show quality score with transparent formula and severity.
- Link each issue to source table and affected record where possible.
- Allow marking issues as reviewed/fixed in session state only.
- Include the intentional demo anomalies from the supplied data.

### S. Notification Center, Collaboration and Audit
- Notification inbox with severity, read/unread, category, timestamp, and filters.
- Activity timeline using activity_log.csv.
- Comments/notes on selected cases and KPIs in session state.
- Simulated mentions and assignment controls.
- Explain that true multi-user collaboration and durable audit trails require an external service.

### T. Executive Synthesis and Report Studio
- Executive summary page with KPI narrative, major movements, risks, decisions and recommended actions.
- Report builder with selectable sections, date range, department, and output preview.
- Use Power BI export capabilities or provide print-friendly HTML layout where supported.
- Do not promise PDF generation from a visual if the host does not support it; document Power BI export alternatives.


### U. Calendar & Scheduling — dedicated module
- Build a first-class interactive calendar using `calendar_events.csv`, `tasks.csv`, `projects.csv`, and `incidents.csv`.
- Provide Month, Week, Day, Agenda, and Timeline views.
- Provide previous/next navigation, Today button, date picker, and current-period label.
- Display events with category colors and priority indicators; include a legend and accessible text labels.
- Support event detail drawer with title, type, start/end, owner, department, location/meeting link, status, recurrence, reminder, description, and related project/task.
- Provide create/edit/delete event forms. In no-backend mode, changes are in-memory/session-only and must be clearly labeled; do not claim that source CSV or semantic model was changed.
- Support drag-and-drop rescheduling only if it can be implemented reliably and accessibly within the custom visual; otherwise provide an edit-time dialog.
- Add filters for event type, priority, status, owner, department, location, and date range.
- Add upcoming events, overdue deadlines, today's agenda, and next-7-days panels.
- Overlay task due dates, project milestones, and incident dates with distinct visual markers. Avoid double-counting or implying that a task deadline is a scheduled meeting.
- Detect schedule conflicts for the same employee when time intervals overlap. Show conflict details and allow the user to inspect both events.
- Support recurring-event display from recurrence metadata for the demo; explain that robust recurrence expansion/time-zone handling requires careful implementation.
- Add reminders as in-dashboard visual notifications only in no-backend mode. Real push/email/Teams reminders require an external service.
- Include keyboard-accessible event selection, clear focus states, responsive layout, empty states, and reduced-motion support.
- Treat `start_datetime` and `end_datetime` as local demo timestamps; document the chosen time-zone assumption and do not silently convert time zones.


## 4A. Mandatory 29-functionality coverage matrix — implement ALL 29
This section is the binding scope. Every numbered item must be implemented and individually checked off in the README/acceptance report. Do not omit, merge away, or downgrade an item into a static screenshot. If Power BI prevents a specific behavior, implement the closest honest in-visual demo behavior and document the exact limitation.

1. **Global Command Palette** — Ctrl+K where host permits, searchable navigation/actions/entities, keyboard navigation, recent searches, empty states.
2. **Notification Center** — inbox, read/unread/archive, category/severity filters, actionable links to related modules, unread count, session-only changes.
3. **Customizable Dashboard Builder** — drag/drop and resize cards/panels where feasible, add/remove/reorder widgets, save/reset layout in supported persisted properties or session state.
4. **Personalization Engine** — dark/light theme, accent choice, density, font scale, preferred landing page, visible KPI preferences, reset settings.
5. **Advanced Data Explorer** — multi-table selector, global search, column chooser, sort, filter, pagination/virtualization, row inspector, export only where host permits.
6. **AI Business Assistant** — contextual chat UI, suggested prompts, rule-based offline responses grounded in measures and selected records; label as demo/rule-based. Provide future secure API adapter contract, no embedded secrets.
7. **What-If Simulator** — editable revenue, costs, discount, headcount, churn, supplier cost, marketing parameters; instant recomputation, baseline comparison, scenario save/compare/reset.
8. **Business Time Machine** — date scrubber, play/pause/step/speed, historical KPI replay, event markers, two-date comparison; deterministic from data.
9. **Root Cause Analyzer** — KPI decomposition, driver ranking, contribution waterfall, drill path from top-level metric to dimension/record; distinguish correlation from causation.
10. **Smart Anomaly Detection** — rule/statistical flags for outliers, sudden changes, duplicates, payment mismatches, unusual patterns; severity, evidence, acknowledge/review state.
11. **Business Digital Twin** — interactive operations map of departments, warehouses, projects, suppliers, customers and flows; 2D mandatory, 3D progressive enhancement, click-to-inspect, zoom/pan/reset.
12. **Decision Impact Analyzer** — register decision, owner, hypothesis, expected vs actual impact, KPI outcome, review date, lessons learned, status workflow.
13. **Task Management System** — full Kanban, create/edit/delete session tasks, assign, due date, priority, labels, search/filter, task detail, alert-to-task templates.
14. **Project Management** — project portfolio, Gantt/timeline, milestones, budget, owner, progress, dependencies where data exists, overdue/at-risk flags, linked tasks/incidents.
15. **Approval Workflow** — request submission, pending/approved/rejected/more-info states, approver queue, amount and priority, step timeline, session-only transitions.
16. **Calendar & Event Manager** — Month/Week/Day/Agenda/Timeline, create/edit/delete session events, drag-drop where feasible, recurring display, reminders, conflicts, team/department filters, linked tasks/projects/incidents.
17. **Activity Audit Log** — searchable activity timeline, actor, action, module, timestamp, outcome, filters; clearly distinguish sample log from true immutable audit.
18. **Team Collaboration** — contextual comments, notes, @mention simulation, linked item discussions, shared-workspace UI; session-only in backend-free mode.
19. **3D Interactive Environment** — interactive 3D company/department/warehouse environment as progressive enhancement, 2D fallback, selectable objects, KPI overlays, accessible controls.
20. **Interactive Network Graph** — entity relationship graph, node/edge filters, strength, path exploration, focus neighbors, evidence panel, keyboard-accessible node list.
21. **Geographical Intelligence** — map of Tunisian regions/offices/warehouses/customers using supplied region/location fields, region comparison, territory filters; do not fabricate precise coordinates. If no geo library/map permission, provide region map/list fallback.
22. **Financial Market-Style Interface** — ticker strip, sparkline cards, animated price-terminal-inspired KPI movement, watchlist, metric detail; clearly label as business KPIs, not live market prices.
23. **Interactive Data Storytelling** — guided narrative slides, insight cards, animated transitions, evidence links, user-controlled next/back, export/print alternative if supported.
24. **Comparison Studio** — side-by-side compare departments, products, customers, regions, employees, scenarios and periods; normalized metrics and difference highlights.
25. **Business Crisis Simulator** — selectable revenue/cost/churn/supplier/system crisis templates, severity sliders, exposure estimates, recovery levers, scenario comparison and reset.
26. **Mission Control / Business Missions** — strategic objectives as missions, progress, milestones, priority, owner/department, achievement badges, mission queue and goal tracking.
27. **Business Detective Mode** — investigation cases, evidence board, relationship paths, timeline, neutral risk language, case notes and status updates.
28. **Executive War Room** — consolidated executive room with company health, critical alerts, major risks, mission progress, decisions awaiting approval, incident status and recommended priorities.
29. **Business Sandbox** — isolated experiment workspace with cloned parameter sets/sample data, hypothetical changes, reset/compare, no mutation of source CSVs or semantic model.

For each of the 29 items deliver: (a) a real interactive UI, (b) data inputs/measures, (c) user actions, (d) state/persistence classification, (e) Power BI API/sandbox constraints, and (f) at least one acceptance test. Include a 29-row coverage checklist in README.

## 5. Data model and supplied files
Use all supplied CSV files and the included DATA_DICTIONARY.md. The final package contains 30+ CSV files; inspect the folder and import every relevant file. Build a clean star/snowflake model:
- Dimensions: dim_date, departments, employees, customers, products, suppliers.
- Facts: sales_orders, sales_order_items, payments, expenses, inventory_snapshots, projects, tasks, incidents, alerts, decisions, kpi_targets, customer_interactions, data_quality_issues, activity_log.
- Preserve grain. Do not duplicate order-level revenue by joining orders to multiple order lines.
- Create appropriate date relationships and role-playing date measures.
- Validate keys, nulls, duplicates, data types, currency, and date parsing.
- Provide a relationship diagram and explain active/inactive date relationships.

## 6. Required DAX measures
Create a measure catalogue with definitions and DAX for:
- Net Revenue, Gross Revenue, Tax, Orders, Completed Orders, Cancelled Orders, Returned Orders.
- Units Sold, Average Order Value, Discount Amount, Product Cost, Gross Profit, Gross Margin %.
- Paid Amount, Outstanding Amount, Collection Rate, Overdue Payments.
- Total Expenses, Expense vs Target, Department Spend.
- Inventory On Hand, Low Stock Items, Stock Coverage proxy.
- Open Incidents, Critical Incidents, Estimated Incident Impact.
- Open Alerts, Critical Alerts, At-Risk Customers.
- Project Completion %, At-Risk Projects, Overdue Tasks.
- Revenue vs Target, Margin vs Target, Period-over-Period Growth.
- Scenario Revenue/Cost/Profit/Margin and crisis exposure.
- Data Quality Issue Count and Quality Score.
- Forecast values and forecast error.
Include blank/zero-safe logic and explain assumptions.

## 7. Engineering architecture and deliverables
Before coding, inspect the repository and installed Power BI visual API version. Then deliver:
1. Architecture diagram and module breakdown.
2. Data dictionary validation and Power Query import steps.
3. Star schema relationship plan.
4. DAX measure catalogue.
5. Design system with dark/light tokens.
6. Reusable TypeScript components (header, navigation, panel, card, drawer, modal, command palette, table, chart wrapper, toast, theme manager).
7. Custom visual project structure and capabilities.json permissions.
8. Feature implementation in prioritized phases.
9. Unit tests for calculations, scenario engine, risk scoring, and data transformations.
10. Accessibility: keyboard navigation, focus visibility, semantic labels, contrast, reduced motion.
11. Performance: aggregation, data reduction, virtualization, debounce, memoization, event cleanup, bundle-size control.
12. README with exact setup/build/package/import instructions.
13. Acceptance test checklist and known Power BI limitations.
14. Screenshots of the final dark and light themes if the environment supports rendering.

## 8. Implementation phases
Phase 1 — Foundation:
- Import data, validate schema, create model and DAX.
- Build shell, navigation, responsive panels, theme switcher.
- Build Command Center and Data Explorer.

Phase 2 — Investigation:
- Mission Queue, Case Board, Investigator, Risk Radar, Data Doctor.
- Entity profiles and relationship graph.

Phase 3 — Simulation:
- What-If Simulator, Scenario Lab, Crisis Simulator, Decision Impact.
- Validate calculations with test cases.

Phase 4 — Operations:
- Task Manager, Project Management, Notification Center, Audit Timeline.
- Clearly label session-only state.

Phase 5 — Intelligence:
- Time Machine, Forecasting, KPI Dependency Graph, Digital Twin, rule-based assistant, Executive Synthesis.

Phase 6 — Polish:
- Motion design, responsive layout, accessibility, performance, error/empty states, packaging and documentation.

## 9. Acceptance criteria
The project is not complete until:
- Both themes work across every module.
- Navigation, filters, search, drill interactions and inspectors work.
- Scenario controls change calculated outputs immediately.
- Calendar Month/Week/Day/Agenda views work; event filters, details, session-only event editing, upcoming agenda, and employee conflict detection work.
- Crisis presets generate explainable scenario consequences.
- Time Machine playback changes the selected time window deterministically.
- Risk and anomaly scores show their formula and evidence.
- Task/decision/case edits visibly update session UI and are labeled non-persistent.
- No feature falsely claims real AI, real-time data, external writeback, or persistent collaboration.
- The model has no accidental many-to-many ambiguity or duplicated order revenue.
- Empty, filtered, and error states are handled.
- Build succeeds and the visual can be imported into Power BI.
- README clearly separates working local features from future integrations.

## 10. Working method
Do not generate a superficial mockup and call it complete. Implement in small verified increments. First present the architecture, data model, feature feasibility matrix, and implementation plan. Then build Phase 1 and test it before continuing. When a requested feature is restricted by Power BI, explain the restriction and implement the closest supported alternative. Keep the visual premium, readable, fast, and coherent. Prioritize functional depth over decorative complexity.
