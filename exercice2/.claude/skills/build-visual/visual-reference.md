# BOI 360 Page: how it works and what to avoid

GUID `boi360Page7C3E9A51D2F84B6E9A0C5D11E8F4B2A7`. Source: `exercice2/visuals/boi360Page`, design module `exercice2/visuals/shared/neon.ts`.

## Files

| File | Role |
|---|---|
| `src/visual.ts` | Frame (sidebar, header, filter bar, KPI panels, health core), the 7 analytic views, drill-through drawer, tables, ECharts helpers, CSV export, count-up and toast |
| `src/metrics.ts` | Pure data model and business rules (no DOM, no Power BI API). Compiled and tested in Node by `tools/test-metrics.ps1` |
| `src/actions.ts` | Action Center view: create/edit/delete for tasks, projects and employees, validation, saved changes |
| `src/settings.ts` | Format card "Page": `kind` = the view shown when nothing is saved yet |
| `capabilities.json` | 11 measure roles (`meta`, `departments`, …, `leave`); objects `page.kind`, `state.filters`, `crud.changes`; privilege `ExportContent` (optional) |
| `style/visual.less` | Command-center design (dark `#090B0F`, yellow `#FFD43B`, gold `#F5B82E`) and all animations |

## Data in

Each role gets one **JSON text measure** from `dax/measures.dax` (folder `12 Visual Data`): `JSON Sales`, `JSON Tasks`, etc. One row, no cross-join between unrelated tables.

The `JSON …` measures use `FORMAT(…, "en-US")`, because the PC is French. Salary is never sent to the visual.

`readData()` only re-parses when the feed sizes change (`dataKey`).

## State saved in the report

| Object | Contents |
|---|---|
| `state.filters` | `{"v": "<current view>", "f": {"<view>": {filterKey: value}}}`. Older files have a flat filter object; `update()` still reads it |
| `crud.changes` | Action Center operations `[{action, entity, id, row, time}]`, re-applied on top of the model after open and refresh |

Only `persistProperties` writes them. Desktop then marks the file modified, and the user saves.

## Business rules (same as DAX)

- **Revenue** excludes Cancelled. Collected = Paid. Receivables = Pending + Overdue.
- **Expenses** = Approved.
- **"Today"** = `meta.ref` (last sales date).
- **Department meaning per table:** seller (sales, targets), assignee (tasks), requester (leave), spending department (expenses), owner (projects).
- **Projects are not dated.**

## Limits to state honestly

- A visual **cannot change report pages**, which is why there is a single page with in-visual views.
- A visual **cannot write to the model or the CSVs**. Action Center edits live in the report only; other views and DAX don't see them.
- **Downloads** (CSV) need sign-in and the tenant switch "Allow downloads from custom visuals". Otherwise the visual shows the reason. PDF: File › Export.
- The visual gets **no user identity** and no refresh timestamp.

## Mistakes already made (don't repeat)

- **PowerShell unrolls one-item arrays.** A function returning `@(@{…})` gives an object, and Power BI rejects `dataPoint` "not provided as correct type". Return with a leading comma: `, @(…)`.
- **Windows PowerShell reads BOM-less `.ps1` files as ANSI**, so `·` and `—` come out as `Â·`. Save scripts that contain non-ASCII text **with a BOM**.
- **ECharts `graphic` text** needs `GraphicComponent` registered, and `left` anchors its left edge. Donut centre labels are an HTML overlay in the card body instead. `echarts.init` takes over its container, so don't put overlays inside the chart div.
- **Count-up and entrance animations** play only when `animateNext` is true (data or view change), never on filter clicks.
- **Headless Chrome freezes CSS animations with delays** at frame 0. `preview.ps1` disables animations and renders twice to show the settled state.
- **`+ 0` in DAX measures** makes native visuals list every member. Not relevant now (no native visuals), but keep measures blank-safe.
