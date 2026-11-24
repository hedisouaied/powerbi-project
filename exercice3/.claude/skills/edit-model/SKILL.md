---
name: edit-model
description: Use when changing or checking the exercice3 Mission Control semantic model — Power Query (powerquery/*.pq), DAX measures (dax/measures.dax), the Feed <table> JSON measures the visual reads, relationships, dim_date, the Revenue Shock what-if, TMDL generation, refresh, or DAX queries against the model open in Desktop.
---

# Edit the Mission Control model

## Sources of truth

| Source | What it holds |
|---|---|
| `Mission_Control_Enterprise/*.csv` | Read-only data |
| `tools/build-pbip.ps1` | Generates everything in the model |
| `dax/measures.dax` | The catalogue |

`build-pbip.ps1` generates:
- the Power Query queries (with `fnCleanText`);
- column types inferred from the values: S, D, T, I, N, C (money `*_tnd`), P, B;
- the relationship list (61, 12 inactive);
- the `'Revenue Shock'` table;
- the 31 feed measures;
- `tools/feeds.json` and `tools/schema.txt`.

`dax/measures.dax` format:
```
-- measure: <Name> | <format string> | <display folder>
-- <plain-language description>
<DAX>
```
After changing measures, regenerate the doc with `node tools/gen-measure-doc.js`.

## Rules

- Follow the business rules in `CLAUDE.md`. Revenue = Completed + Processing. Order amounts only from `sales_orders`.
- Check status literals against the CSV values. For example, quality issues are `Open`, `Under Review`, `Fixed` and `Accepted`.
- **No ambiguous paths.** A new relationship that creates a second path between two tables must be inactive. Document why in `docs/02_model_and_measures.md`.
- **Feeds:**
  - One `Feed <table>` per table: `{"c":[...],"r":[[...]]}`.
  - Text is escaped for `\` and `"`; numbers use `FORMAT(…, "0.####", "en-US")`; dates are `yyyy-mm-dd`.
  - Columns are dropped in `$feedDrop`. Salary must stay out.
  - Adding or renaming a column changes the visual's data. Keep `tools/csv-feeds.js` identical: same columns, same formatting.
  - The visual binds one data role per feed (`capabilities.json`, `build-report.ps1`). A new table needs:
    1. a role;
    2. a `TABLES` entry in `src/core/data.ts`;
    3. a rebuilt report.

## Regenerate and load

1. Close Desktop without saving.
2. Run:
   ```powershell
   powershell -ExecutionPolicy Bypass -File exercice3\tools\build-pbip.ps1
   ```
3. Open `exercice3\MissionControl.pbip`.
4. Click **Accueil › Actualiser** inside Desktop.
   - A PBIP has no data cache, so tables load only during that refresh.
   - `tools/model.ps1 -Refresh` refreshes the engine but does not make Desktop re-query visuals. Visuals keep whatever they fetched mid-load, for example empty `sales_orders`.

## Query the open model

```powershell
powershell -ExecutionPolicy Bypass -File exercice3\tools\model.ps1 -Query 'EVALUATE ROW("rev", [Net Revenue])'
powershell -ExecutionPolicy Bypass -File exercice3\tools\check-feeds.ps1                 # all feeds in one query: length + JSON validity
powershell -ExecutionPolicy Bypass -File exercice3\tools\test-engine.ps1                 # engine vs DAX: 28/28, 18/18, 17/17
```

- **Quoting:** from Bash, wrap the DAX in single quotes, because double quotes inside a PowerShell `-Command` string get eaten.
- **Load:** query feeds one at a time or with `check-feeds.ps1`. An earlier ad-hoc all-feeds query restarted Desktop.

## Reference values

See `CLAUDE.md`. Any change that moves them must be explained.
