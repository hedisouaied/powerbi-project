---
name: edit-model
description: Use when changing or checking the exercice2 BOI 360 semantic model: Power Query (powerquery/*.pq), DAX measures (dax/measures.dax), relationships, the Date table, TMDL generation, refresh, or running DAX queries against the open model.
---

# Edit the BOI 360 model

The model is **generated**. Never edit `BOI360.SemanticModel/definition/*.tmdl` by hand. Edit the sources, then run `tools/build-pbip.ps1` (Desktop closed).

| Source | What |
|---|---|
| `powerquery/00_fnCleanText.pq` … `10_leave_requests.pq` | M per table. Types use the `"en-US"` culture; `fnCleanText` trims and turns `""` into null |
| `dax/measures.dax` | All measures. Format per measure: `-- measure: Name \| format \| folder`, then `-- description` lines, then DAX. Parsed by `tools/measures.ps1` |
| `tools/build-pbip.ps1` | Column types, hidden columns, the 22 relationships, the Date table (DAX `CALENDAR` 2021–2027, marked) and `project_managers` (role-playing copy of employees) |

## Model rules (Phase 2)

- **One `employees` table** for seller, target owner, assignee and leave requester.
- **Project managers have their own table**, so assignee and manager paths to `tasks` aren't ambiguous.
- **Inactive relationships** (use `USERELATIONSHIP` in measures):
  - departments → projects
  - Date → projects (start date, deadline)
  - Date → tasks.created_date, leave.end_date, employees.hire_date
- All relationships are many-to-one and single direction.
- The blank member of `projects` comes from the 42 expenses that have no project. It is expected; don't "fix" it.

## Agreed business rules

- **Revenue** excludes Cancelled. Collected = Paid. Receivables = Pending + Overdue.
- **Expenses** = Approved only.
- **Reference date** = last sales date (2026-11-16), used instead of `TODAY()`.
- Never sum or average `achievement_pct`; recalculate it from the sums.

**Reference values:**
- Revenue 2,626,958.24; Profit 971,081.16
- Approved expenses 215,363.87; Budget 1,755,000
- Target achievement 96.15 %; Open tasks 67 = overdue tasks 67

## Running DAX against the open Desktop model

```powershell
powershell -ExecutionPolicy Bypass -File exercice2\tools\model.ps1 -Refresh                      # full refresh (same as Actualiser)
powershell -ExecutionPolicy Bypass -File exercice2\tools\model.ps1 -Query "EVALUATE ROW(""r"", [Revenue])"
```

To test new measures before building, prepend `DEFINE MEASURE sales_transactions[Name] = …` to the query (`tools/test-metrics.ps1` shows how).

## After changing a measure the visual mirrors

The visual computes its KPIs in `visuals/boi360Page/src/metrics.ts`. Change it too, rebuild (the `build-visual` skill), and run `tools/test-metrics.ps1`: it must stay **108/108**.

## Data quality

- `profiling/profile.ps1` re-profiles `data/*.csv`: keys, orphans, dates, outliers.
- The findings are in `docs/01_data_quality_report.md`.
- The source CSVs are read-only for analysis; they change only on purpose, as the manual CRUD workflow.
