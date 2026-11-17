# Phase 8: Test checklist and acceptance

Status on 17 Nov 2026.
- ✅ **Verified:** tested, with the evidence given.
- 🔶 **Partly verified:** see the note.
- ⬜ **Not yet verified:** needs a click-through in Desktop.

| # | Acceptance criterion | Status | Evidence |
|---|---|---|---|
| 1 | Every CSV imports, row counts recorded | ✅ | 6 / 48 / 18 / 96 / 90 / 80 / 8 / 600 / 150 / 60 rows in the model = the CSVs (`01_data_quality_report.md`) |
| 2 | No value fails type conversion | ✅ | The only blanks are the 42 empty `expenses.project_id` and 18 empty `leave_requests.comment` already in the source |
| 3 | Primary and foreign keys valid or documented | ✅ | All PKs unique; 12 FKs, 0 orphans; blank project IDs and the duplicate emails documented (`profiling/profile.ps1`) |
| 4 | Relationships filter correctly, no accidental many-to-many, no ambiguous path | ✅ | 22 relationships, all many-to-one and single direction, state Ready; propagation tests by department, project, manager role and date (`02_data_model.md`) |
| 5 | DAX measures sensible, percentages recalculated | ✅ | 65 core measures load without error; 31/31 match values computed directly from the CSVs; achievement recalculated (96.15 %) instead of averaged (95.81 %) (`03_measures.md`) |
| 6 | Visual numbers equal DAX numbers | ✅ | `tools/test-metrics.ps1`: 108 / 108 (36 KPIs × no filter, department IT, Mar–Jun 2026) |
| 7 | One visual per page | ✅ | 8 pages, each with exactly 1 visual of type `boi360Page…` (checked in the PBIR files and in Desktop) |
| 8 | All 8 pages render with data in Power BI Desktop | ✅ | Screenshots of every page in Desktop (build 1.0.0.1/1.0.0.2) |
| 9 | Filters affect the intended content only | 🔶 | Filter logic tested in Node (#6); filter dropdowns seen on every page. Clicking a filter in Desktop not yet recorded |
| 10 | Cross-filter clicks, drill-through drawer, view presets, metric switch, what-if | ⬜ | Built (1.0.0.3); click-through in Desktop still to record |
| 11 | Reset filters | ⬜ | Built on every page; click-through to record |
| 12 | Tooltips | 🔶 | Built on every chart; hover not yet recorded |
| 13 | Conditional formatting (below-target sellers, overdue tasks, over-budget projects) | ✅ | Seen in Desktop: seller bars amber/pink below 100 %/90 %, overdue counts pink, over-budget rows pink, past deadlines amber |
| 14 | Prototype create/edit/delete validation works; non-persistence warning visible | 🔶 | Warning banner, tabs, buttons and pager seen in Desktop. Validation rules are in `actions.ts`; form submission not yet clicked through |
| 15 | Refresh or reopen resets prototype edits (documented) | ✅ (by design) | Edits are only in memory (`actions.ts` has no `persistProperties`); a data refresh calls `load()`, which discards them. Documented in `05_action_center_crud.md` and on the page |
| 16 | No credentials or secrets in files or code | ✅ | Scan of every source file: no password, SMTP, API key or token. The only hit is library code inside the bundled visual. No email feature exists |
| 17 | No unsupported email, write-back or API call shown as working | ✅ | Visual source has no `fetch`, XHR, WebSocket or URL; only privilege is optional `ExportContent`. Export failure is explained, not hidden |
| 18 | CSV export | 🔶 | Built. Expected to be **blocked** in Desktop when not signed in (same Power BI rule as exercice1); the visual then shows the reason. PDF: File › Export › Export to PDF |
| 19 | Meaningful titles, units, labels, contrast | ✅ | Every card has a title and subtitle; amounts say TND; KPI notes explain each rule; light-on-dark text |
| 20 | Report JSON valid | ✅ | 22 / 22 JSON files under `BOI360.Report` parse |

## To finish rows 9–14 and 18

With Desktop open on `BOI360.pbix`:
1. On Sales, set Payment status = Cancelled: Revenue should be "—" and Cancelled revenue 1.02M.
2. On Overview, click "Sales" in *Approved expenses by department*: the department panel opens.
3. On Overview, click **Sales** under View: the department becomes Sales and the trend switches to collected vs receivables.
4. On Sales, set What-if to **Target +10%** and **Commission 5%**: the target column grows by 10 %, achievement drops, and a commission column appears.
5. On Action Center, click **New** and then **Create** with an empty title: "Required" appears. Then fill the form and create: a message appears, the change log shows the change, and the action queue updates.
6. Click any **CSV** button: either a file is saved, or the message explains the Power BI download rule.
7. Click **Reset filters**: everything clears.
