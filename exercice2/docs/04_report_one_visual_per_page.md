> **17 Nov 2026 update:** the report is now **one page with one visual**. The 8 sections below are *views* inside that visual, switched from its sidebar. Each view keeps its own filters.

# Phase 4, 6 and 7: Report pages: one TypeScript visual per page

Every page of `BOI360.pbix` is **one** custom visual, **BOI 360 Page** (`boi360Page7C3E9A51D2F84B6E9A0C5D11E8F4B2A7`), the same approach as exercice1. There are no native slicers, cards, charts, tables or buttons on any page: filters, KPIs, charts, tables, tooltips, drill-through and the prototype create/edit/delete forms are all drawn inside that one visual.

## Architecture

```text
data/*.csv ─► Power Query (powerquery/*.pq) ─► model (BOI360.SemanticModel, 12 tables, 22 relationships)
                                                    │
               dax/measures.dax: 80 business measures + 11 "JSON …" feed measures
                                                    │  one text measure per table
                                                    ▼
        BOI 360 Page visual (visuals/boi360Page): one per page, "Page" setting = overview … actions
           ├─ src/metrics.ts: filters + business rules (pure TypeScript, tested against DAX)
           ├─ src/visual.ts: pages 1–7: filter bar, KPIs, ECharts, tables, drill-through drawer
           └─ src/actions.ts: page 8: Action Center, in-memory create/edit/delete prototype
```

**Why JSON feed measures?** A visual receives a single query, and the tables (sales, tasks, leave, expenses…) are not related to each other. Asking for all their columns at once would make Power BI cross-join them. Each `JSON …` measure instead returns its table as one JSON text value (`CONCATENATEX` + `FORMAT(…, "en-US")`), so there's no cross-join. Salary is **not** included (data minimisation).

**Are the numbers the same as the DAX measures?** Yes. `tools/test-metrics.ps1` compiles `metrics.ts`, runs it in Node on the live feeds, and compares 36 KPIs with the DAX measures in 3 scenarios (no filter, department = IT, Mar–Jun 2026). Result on 17 Nov 2026: **108 / 108 match**.

## Pages

| # | Page | Filters (inside the visual) | KPIs | Charts and tables |
|---|---|---|---|---|
| 1 | Executive Overview | Period, Department, **View presets**, **Trend metric** | Revenue, Profit, Approved expenses, Target achievement, Overdue tasks, Projects at risk | Trend (switchable metric), revenue by region, projects by status, expenses by department (→ drill-through), top risks table |
| 2 | Sales Performance | Period, Seller, Product category, Payment status, Region, **What-if** | Revenue, Margin, Transactions, AOV, Collection rate, Cancellation rate | Seller ranking (colour = achievement), target vs actual by month, gross revenue by payment status, revenue by product, seller scorecard |
| 3 | People & HR | Period, Department, City, Employment status, Leave type | Employees, Active, On leave, Leave requests, Approved leave days, Leave approval rate | Headcount by department (→ drill-through) and by job title, leave days by type and by month/status, employee directory (no salary) |
| 4 | Project Portfolio | Owning department, Project manager, Status, Priority | Projects, Budget, Actual cost, Budget used, Over budget, Past deadline | Budget vs actual per project, status donut, budget used per manager, portfolio table with variance and risk |
| 5 | Task Operations | Period (due), Assignee department, Project, Priority, Status | Tasks, Open, Overdue, Blocked, Completion rate, Avg days overdue | Tasks by status, **priority × status matrix**, workload per assignee (top 12), overdue tasks table |
| 6 | Finance & Expenses | Period, Spending department, Category, Approval status | Approved, Pending, Rejected, Approval rate, Project budget variance, Approved without project | Expenses by month and status, approved by department (→ drill-through), by category, project variance table, expense lines |
| 7 | Customer & Product | Period, Segment, Customer city, Product category, Region | Revenue, Profit, Customers with sales, Revenue per customer, Units, Average discount | Top 10 customers, revenue by segment, revenue & profit by product, revenue vs margin scatter, product table |
| 8 | Action Center | none | none | Prototype create/edit/delete (tasks, projects, employees), action queue, session change log. See `05_action_center_crud.md` |

Filter meaning is the same as in the model (Phase 2):
- **Department:** seller (sales, targets), assignee (tasks), requester (leave), spending department (expenses), owning department (projects).
- **Period:** transaction date, target month, due date, leave start or expense date. Projects and the employee directory are not dated.

## How each prompt feature is delivered with one visual per page

| Prompt feature | In this report | Notes |
|---|---|---|
| Slicers | Dropdowns and a period range in each page's filter bar | Saved with the report (`state.filters`), per page |
| Cross-filtering | Click a bar, donut slice, matrix cell, month or table row and the whole page filters; click again to clear | Selected item stays highlighted, others dim |
| Reset filters | **Reset filters** button, top right of every page | Also clears search boxes and what-if values |
| Dynamic titles | Subtitle: data date, period, departments; chart titles change with the what-if and metric switch | |
| Conditional formatting | Achievement colours (pink < 90 %, amber < 100 %, green), budget used (pink > 100 %, amber > 90 %), overdue tasks, variance sign, status colours, KPI tones | Same thresholds as the `CF …` DAX measures |
| Tooltips | Glass tooltips on every chart (value, share, extra context, partial-month warning) | Replaces report-page tooltips |
| Drill-through | Click a department (Overview expenses, People headcount, Finance expenses) to open a **department detail panel**: employees, projects owned, overdue tasks, budget, expenses | "Filter this page to …" button applies it |
| Bookmarks (Executive / Sales / Operations) | **View presets** on the Overview: Executive (all, revenue & profit), Sales (Sales dept, cash collection), Operations (volume trend) | Native bookmarks would need native visuals |
| Field parameters | **Trend metric** switch on the Overview: Revenue & profit / Collected vs receivables / Transactions & units | |
| What-if parameters | **What-if** on Sales: target change (−30 % … +30 %) and commission rate (1 % … 10 %). Recolours the seller ranking and adds simulated target, achievement, gap and commission to the scorecard | A simulation: nothing is saved to the data |
| Page navigation | **Sidebar inside the visual**: click a view and it switches instantly, with an entrance animation. Each view keeps its own filters, and the last view is remembered when the file is saved | The report is one page holding the one visual. Power BI has no API for a visual to change report pages, so the views live inside the visual |
| Export to CSV | **CSV** button on the main tables (rows after filters and search) | Uses Power BI's download service. Power BI allows it only when the user is signed in and the admin setting *Allow downloads from custom visuals* is on; otherwise the visual shows a message saying so |
| Export to PDF | **File › Export › Export to PDF** in Desktop | A visual cannot generate a PDF itself |
| Accessibility | Light text on a dark background (contrast above 4.5 : 1 for text), every value also has a text label, colour is never the only signal (risk and status are written out) | |

## What is native, what is custom

| Element | Type |
|---|---|
| All 8 page contents | **Custom TypeScript visual** (private, saved inside the `.pbix`; no AppSource) |
| Charts inside it | ECharts 6 (bundled into the visual) |
| Icons | Lucide (bundled) |
| Page tabs, File › Export to PDF, Refresh | Native Power BI |
| Deneb | Not used: everything is in the one visual |

## Visual design: Futuristic 3D Command Center (dark + gold)

Redesigned on 17 Nov 2026 (visual 1.0.0.9). Only the look changed: the data, model, measures, filters and interactions are the same. Screenshots of every page are in [`docs/img/`](img/).

| Element | Design |
|---|---|
| Palette | Background `#090B0F` / `#11151C`, cards `#171D26`, elevated panels `#202833`, primary yellow `#FFD43B`, gold `#F5B82E`, highlight `#FFF0A3`, text `#F5F7FA` / `#A4ADBA` / `#687383`, success `#35D39A`, warning `#FFB84D`, danger `#FF5C64` |
| Sidebar | Gold hexagon logo, "BOI 360 · Operations Command Center", the 8 views (click to switch) with the active one marked by a gold bar and glow, model status with a "live" dot |
| Header | Page number, title and context, reporting-period chip, "data as of" chip, alert bell (overdue tasks + projects at risk, pulsing), viewer badge, Reset |
| KPI panels | Layered 3D cards (gradient surface, top light edge, deep shadow, lift on hover). Value with count-up, change vs previous month (green or red), sparkline, or an animated progress ring for ratios. Alert KPIs show a pulsing dot |
| Overview centrepiece | **Business health core**: four concentric animated rings, each a real ratio (target achievement, collection rate, task completion, budget used), around the revenue figure, with a technical tick dial |
| Cards | Graphite glass panels with gold corner brackets, gold icons, soft gold glow on hover |
| Charts | Gold/yellow primary series, platinum secondary series, steel for targets and pending; danger red and success green keep their meaning; dashed dark grid lines; glass tooltips with a gold border |
| Background | Gold radial light, a dot pattern and a perspective grid floor |
| Tables | Gold uppercase headers, gold underline, yellow selected row |

**Motion.** It all runs in the custom visual (TypeScript, CSS and ECharts). Native Power BI visuals do not support these effects.
- **On page load or new data:** KPI count-up (0.9 s), rings and arcs filling, sparklines drawing, cards rising in sequence, sidebar sliding in, charts revealing progressively.
- **Always on:** hover glow and lift, a smooth active-page indicator, pulsing alerts (bell, overdue and over-budget KPIs, prototype banner icon).
- **Not replayed on filter clicks**, so working with filters stays calm.
- **Accessibility:** `prefers-reduced-motion` turns animation off.

**Limitations (honest):**
- **Navigation is inside the visual:** the report is a single page and the sidebar switches between the 8 views. A custom visual cannot change Power BI report pages, so this is how the sidebar can work.
- The viewer badge cannot show a name: Power BI does not give custom visuals the user's identity.
- "Last refresh" is shown as the data's as-of date; the visual cannot see the refresh timestamp.

**Preview without Power BI:** `tools/preview.ps1` renders the packaged visual with data from the CSVs in headless Chrome and saves a screenshot per page. It doesn't touch the screen or Desktop.
## Rebuild

```powershell
# Desktop closed first
powershell -ExecutionPolicy Bypass -File exercice2\tools\build-pbip.ps1     # model (TMDL) from powerquery\ and dax\
powershell -ExecutionPolicy Bypass -File exercice2\tools\build-visual.ps1   # visual -> BOI360.Report\CustomVisuals
powershell -ExecutionPolicy Bypass -File exercice2\tools\build-report.ps1   # 8 pages, one visual each
# open BOI360.pbip, Refresh, then File › Save as › BOI360.pbix
powershell -ExecutionPolicy Bypass -File exercice2\tools\test-metrics.ps1   # visual vs DAX (Desktop open)
```
