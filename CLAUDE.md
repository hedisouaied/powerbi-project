# CLAUDE.md

Guidance for Claude Code when working in this folder.

## Project

Power BI retail sales report for a Tunisian retailer (amounts in **TND**). Five raw CSVs are cleaned by a Python pipeline into a star schema, which a Power BI project (PBIP) loads and visualises across 6 pages. Every page is drawn by private TypeScript custom visuals with a **neon glassmorphism design**. The visuals keep their "Mauve" names from an earlier theme.

## Skills

Project skills in `.claude/skills/` hold the detailed instructions and scripts. Load the one that fits before starting that work.

| Skill | Use it for |
|---|---|
| `build-visual` | Changing, building or installing a custom visual or page layout |
| `test-visual` | Previewing and testing a visual outside Power BI |
| `mail-relay` | The Send by email button, mail service and email template |
| `edit-model` | Measures, Power Query, TMDL, relationships, DAX queries, the data pipeline |

## Layout

| Path | What it is |
|---|---|
| `01_…05_*_raw.csv` | Raw source data. **Read-only: never modify.** |
| `clean_data.py`, `validate_v2.py` | Pipeline (raw CSVs → `output/`) and its independent validation |
| `output/` | Model inputs: `FactSales`, `FactPayments`, `DimCustomer`, `DimProduct`, `DimStore`, `DimDate`, `DimOrder` CSVs |
| `biproject.pbip` | Power BI project entry point |
| `biproject.SemanticModel/definition/` | Model as TMDL |
| `biproject.Report/definition/` | Report as PBIR JSON: `pages/<id>/page.json` + `pages/<id>/visuals/<name>/visual.json` |
| `visuals/` | Custom visual sources (`mauveSalesPage`, `mauveReportPage`, `mauveTable`, `shared`) |
| `visuals/mailRelay/` | Local mail service. Its `.env` holds the SMTP password: **never read it into chat, copy it, or share it.** |
| `biproject.pbix`, `final_repport.pbix` | Old / exported single-file versions. Do not overwrite. |
| `POWERBI_CHANGELOG.md` | History of model/report changes and the documented data exceptions |
| `backup_multi_visual/` | Older versions of pages and visuals |
| `biproject_extract/`, `export_check/` | Scratch output from earlier tooling. Ignore. |

## Rules for every task

- **Reference totals:** Net Revenue **3,498.60**, Gross Sales **4,105.60**, Units **55**, Orders **32**.
- **Data exceptions: show them, never "fix" them.** ORD-1030 payment 999.00 vs gross 45.00; PAY020 has a null amount; ORD-1007 and ORD-1017 have no payment; refunds on ORD-1003 and ORD-1011 are retained; `Customer_Segment` is null for every customer; selling price equals list price everywhere (no discount data). The Data Quality page exists to surface these.
- **Don't send real emails when testing.** Use a dry run or the test page.
- **Every `.json` under `biproject.Report` must stay valid JSON;** check after each edit.
- The `HTML …` measures and the HTML Content approach are retired: no page uses them.

## Design palette

Page and outspace `#060818`, card `#141836`, accent cyan `#22D3EE`, blue `#3B82F6`, violet `#A855F7`, magenta `#E879F9`, text `#EEF2FF`, soft text `#C7D2FE`, muted `#8B93B8`, warning/loss pink `#F472B6`, positive green `#34D399`. Status colours: Completed cyan, Shipped violet, Pending blue, Returned orange `#FB923C`, Cancelled pink.

## Working with Power BI Desktop

- **Desktop overwrites the TMDL/PBIR files when it saves.** Before editing files on disk, make sure the user has closed Desktop or will close it **without saving**. Then they reopen `biproject.pbip`.
- A `.pbip` stores no data: after reopening, the model is empty until it's refreshed.

## Sharing

To send the report to someone, save from Desktop as a **new `.pbix`** (data is embedded). The `.pbip` folder alone won't work for them, because it has no data and its `DataFolder` points to this PC. All visuals are private and saved inside the file, so no AppSource access is needed. The Send by email button only works on a PC running the mail service.
