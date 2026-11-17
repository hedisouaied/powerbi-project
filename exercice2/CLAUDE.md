# CLAUDE.md — exercice2 (Business Operations Intelligence 360)

Power BI learning project for a fictional Tunisian company (amounts in **TND**, data year 2026). Built and checked phase by phase; docs in `docs/01…06`.

## Skills

Project skills in `.claude/skills/`. Load the one that fits before starting that work.

| Skill | Use it for |
|---|---|
| `build-visual` | Changing, building or installing the BOI 360 Page visual (views, design, Action Center) |
| `edit-model` | Power Query, DAX measures, relationships, TMDL generation, refresh, DAX queries |
| `test-visual` | Headless previews and scripted tests of the visual; visual vs DAX check |

## Rules

- **One visual per page, always.** The report is ONE page holding ONE **BOI 360 Page** TypeScript visual. Its sidebar switches between the 8 views inside the visual (custom visuals cannot change report pages). State `{v: view, f: {view: filters}}` is saved in `state.filters`. Never add native visuals; new features go inside the visual (`visuals/boi360Page/src`).
- **The user wants the work done, not assigned.** Build, test and save; report the results. Don't end with "your task".
- **Source data is read-only:** `data/*.csv` (exported from `Business_Operations_Intelligence_360.xlsx`). Cleaning happens in Power Query only.
- **No backend.** Action Center create/edit/delete is saved in the report itself (visual property `crud.changes`, re-applied on top of the model after open/refresh). It never changes the CSVs or the model, so other pages don't see it; say so. Never claim email sending or API write-back.
- **Agreed rules:**
  - Revenue = all payment statuses except Cancelled; Collected = Paid; Receivables = Pending + Overdue.
  - Expenses = Approved only.
  - "Today" = reference date (last sales date, 2026-11-16).
- **Reference values:**
  - Revenue 2,626,958.24; Profit 971,081.16
  - Approved expenses 215,363.87; Budget 1,755,000
  - Open tasks 67, all overdue; Target achievement 96.15 %

## Design

Futuristic 3D Command Center, dark + yellow/gold (`#090B0F`, `#171D26`, `#FFD43B`, `#F5B82E`; success `#35D39A`, warning `#FFB84D`, danger `#FF5C64`). Sidebar + header + floating KPI panels + business health core. See `docs/04_report_one_visual_per_page.md`.

## Files

| Path | What |
|---|---|
| `powerquery/*.pq` | M code per table (source of truth) |
| `dax/measures.dax` | All measures, incl. the 11 `JSON …` feeds the visual reads |
| `tools/build-pbip.ps1` | Writes the model (TMDL) from `powerquery/` and `dax/` |
| `tools/build-visual.ps1` | Builds the visual (pauses cmd AutoRun `wsl.exe ~`, uses Node 22) and installs it in `BOI360.Report/CustomVisuals` |
| `tools/build-report.ps1` | Writes the single page + visual; carries over saved Action Center changes from `BOI360.pbix` |
| `tools/model.ps1` | Refresh / DAX query against the open Desktop model |
| `tools/test-metrics.ps1` | Visual's TypeScript calculations vs DAX (must stay 108/108) |
| `tools/preview.ps1` | Headless-Chrome screenshots of every page from the packaged visual (no Desktop, no screen) |
| `visuals/node_modules`, `visuals/boi360Page/node_modules` | Junctions to exercice1's installed SDK |

## Workflow

1. Close Desktop without saving.
2. Run the build scripts.
3. Open `BOI360.pbip`, then refresh (`tools/model.ps1 -Refresh`).
4. Check the result.
5. Save as `BOI360.pbix`.

Desktop overwrites the PBIP files when it saves the `.pbip`. A `.pbip` has no data until it is refreshed.
