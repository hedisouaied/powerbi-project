---
name: build-visual
description: Use when changing, building or installing the report's TypeScript custom visuals (Mauve Sales Page, Mauve Report Page, Mauve Table), including page layout, charts, tables, filters, downloads and the shared neon design.
---

# Build and install a custom visual

Before changing a visual's code or a page layout, read [visuals-reference.md](visuals-reference.md) for how the visuals work and the mistakes to avoid.

## Build

Run from the project root, with the visuals you changed:

```powershell
.\.claude\skills\build-visual\scripts\build.ps1 -Visual table,report,sales
```

`-Visual all` builds all three. `-NoInstall` only packages, which is enough for testing outside Power BI.

The script does the whole routine:
1. Bumps `version` in `pbiviz.json`, because Power BI keeps the cached copy otherwise.
2. Runs `pbiviz package` (the SDK is installed in `visuals/`).
3. Copies the package to `visuals/MauveTable.pbiviz`, `MauveReportPage.pbiviz` or `MauveSalesPage.pbiviz`.
4. Extracts `package.json` and `resources/*.pbiviz.json` into `biproject.Report/CustomVisuals/<guid>/`.
5. Checks that every report JSON file is still valid.

After changing `visuals/shared/*`, build both `sales` and `report`. If `mauveSalesPage/style/visual.less` changes, copy it to `mauveReportPage/style/visual.less` and keep its `@import "report-pages.less";` line before the `neon.less` import.

## Visual GUIDs

| Visual | GUID | Used by |
|---|---|---|
| Mauve Table | `mauveTable206323CE31CC48B796ED1D3480CC2EE7` | none (retired: one visual per page) |
| Mauve Report Page | `mauveReportPage54F8CE52AF994908A86522ADBF64F28C` | `report_page_ts` on pages 2 to 6 |
| Mauve Sales Page | `mauveSalesPage0BC9FF907287439685E99AB7EDABBCAC` | `sales_page_ts` on page 1 |

## Registration in `report.json`

Each visual is one item in the `CustomVisual` resource package, written the way Power BI writes it:

```json
{ "name": "<guid>.pbiviz.json", "path": "<guid>.pbiviz.json", "type": "CustomVisualMetadata" }
```

Any other shape leaves pages empty until the visual is imported by hand.

## Finish

Test with the `test-visual` skill first. Then tell the user to close Desktop **without saving**, reopen `biproject.pbip` and click Refresh. They shouldn't need to import anything.
