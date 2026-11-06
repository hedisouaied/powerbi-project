---
name: edit-model
description: Use when changing or debugging the Power BI semantic model, including tables, relationships, DAX measures, Power Query (M), TMDL files, refresh errors, or running DAX queries against the open model.
---

# Edit the semantic model

The model is TMDL in `biproject.SemanticModel/definition/`. All measures live on `FactSales`, in display folders `01 Financial` … `05 Data Quality` and `06 HTML`. The `06 HTML` measures are retired: no page uses them.

## Model structure

- **Facts:** `FactSales` (order-line grain, 33 rows) and `FactPayments` (31 rows).
- **Dimensions:** `DimCustomer`, `DimProduct`, `DimStore`, `DimDate` (marked as the date table) and `DimOrder` (the bridge between the two facts; there's no direct Sales–Payments relationship).
- All relationships are single-direction, dimension → fact. Filters on `FactPayments` don't reach `FactSales`.
- Each dimension has an explicit **Unknown** member (`C999`, `P999`, `ST99`) with `Is_Unknown = True`.
- The `DataFolder` parameter in `model.tmdl` holds the absolute path to `output/`. Change it if the folder moves.

## Power Query rules (each one caused a real bug)

- `Table.TransformColumnTypes` takes a **list of pairs**: `{{"A", type text}, {"B", type number}}`, never a flat list `{{"A", type text, "B", type number}}`. A flat list silently types only the first column, so `SUM` measures fail with "cannot work with values of type String".
- Always pass the culture `"en-US"`. The model culture is `fr-FR`, which misreads decimals like `45.00`.
- Each table ends with a `Blanks` step that turns empty text into `null`. Without it, `ISBLANK` measures count every row.

## Running DAX

1. **Prefer the Power BI Modeling MCP** (`powerbi-modeling` in `.mcp.json`) for connecting to the open model, running queries, refreshing, and editing measures, tables and Power Query. It needs the EULA accepted once; ask the user first. It does not edit report layout.
2. **If the MCP isn't connected,** run a read-only query through the script, with Desktop open and the model refreshed:
   ```powershell
   .\.claude\skills\edit-model\scripts\run-dax.ps1 -Query 'EVALUATE ROW("Net", [Net Revenue])'
   ```

Test new or changed DAX against the live model before writing it to TMDL, including an empty filter context (for example a slicer value with no data).

## If a measure's definition changes

Mauve Sales Page and Mauve Report Page compute their own totals in `src/visual.ts`, with these rules: Net Revenue = sum of net, Orders = distinct Order_ID, AOV = net / orders, % kept = net / gross. Change the visuals too (see the `build-visual` skill), then check the reference totals.

## Pipeline

`clean_data.py` turns the raw CSVs into `output/`, and `validate_v2.py` checks the result and writes `output/final_validation_report_v2.txt`. Python isn't installed on Windows here: run them with `python3` from WSL or another environment that has `pandas`.
