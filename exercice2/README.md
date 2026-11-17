# Business Operations Intelligence 360
Learning dataset for Power BI Desktop. All data is synthetic, in TND, and covers 2026.

## Files
- 10 CSV source tables
- `Business_Operations_Intelligence_360.xlsx` workbook containing the same tables on separate sheets
- `DATA_DICTIONARY.md` with schemas, relationships, measures and caveats
- `CLAUDE_PROMPT.md` with a detailed phased build prompt

## Important architecture note
The requested configuration is enterprise scope with **no backend**. A Power BI-only exercise can provide rich analytics and prototype CRUD interactions, but cannot provide durable arbitrary create/update/delete operations against CSV sources from inside a report. Use external source-file editing followed by refresh for persistence. In-visual TypeScript CRUD can only be a temporary prototype unless a separate writeback service is introduced.

## Quick start
1. Extract this package.
2. Open Power BI Desktop.
3. Home > Get data > Text/CSV.
4. Import each CSV.
5. Follow `DATA_DICTIONARY.md` and `CLAUDE_PROMPT.md`.
