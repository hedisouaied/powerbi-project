# How the custom visuals work

## Shared design rules

- `visuals/shared/neon.ts` holds the ECharts setup, glass tooltips, gradients, Lucide icons and `ChartHost`. `visuals/shared/neon.less` holds the glass styles over the `.sp-*` classes. Both are compiled into Mauve Sales Page and Mauve Report Page. Mauve Table has its own styles and imports only Lucide, so it stays small.
- **An ECharts chart takes its size when it's created.** Create it after the page around it is complete: `ChartHost.queue` plus `flush` at the end of the render (Report Page), or after its siblings are filled (Sales Page). Otherwise a chart measures itself alone in its row and runs off the card.
- Scale pages with `transform: scale()`, not `zoom`, so chart tooltips stay in the right place.
- Skip the redraw when `dataKey()` is unchanged, because saving filters triggers an update that would restart the animations.
- Pages are 1920×1340 with display option `FitToWidth` (they scroll vertically), on a 40 px margin / 20 px gutter grid.
- **Leave spare height in every card.** Content designed edge to edge gets clipped in Power BI; tables scroll inside their card instead of growing.
- Glass blur works inside a visual, not across two visuals, because each one is its own iframe.

## Mauve Sales Page (page 1)

- Sales Overview is a single visual, `visuals/mauveSalesPage/` (`sales_page_ts`, 1920×1340, no other visuals on the page). It receives order lines through 11 grouping roles (date, order, line, store, storeUnknown, product, category, status, quantity, gross, net) and computes every total itself.
- It **duplicates the DAX rules**: Net Revenue = sum of net, Orders = distinct Order_ID, AOV = net / orders, % kept = net / gross. If a measure's definition changes, change `src/visual.ts` too, and check the reference totals.
- Its filters (from/to dates, quick-period, Store and Category dropdowns on one line, plus status, store and month clicks on the charts) only filter this visual. They are saved in the report through `persistProperties` (object `state.filters`, JSON).
- Send by email is covered by the `mail-relay` skill.
- **Downloads:** "Download PDF" (under the title) and "Excel" (Product Snapshot) use Power BI's file download API (`ExportContent` privilege, `host.downloadService`, content as base64).
  - The PDF is an html-to-image JPEG of the page at 1920×1340 put into jsPDF. Elements with class `sp-no-capture` are left out.
  - The `.xlsx` is written by hand (fflate zip of SpreadsheetML: Product Snapshot sheet with autofilter and frozen header, plus a Filters sheet).
  - html-to-image needs `skipFonts: true` and a page where `requestAnimationFrame` fires.
  - In Power BI Service, the admin switch "Allow downloads from custom visuals" must be on; otherwise the visual shows a message.
- The previous page is in `backup_multi_visual/sales_overview_before_ts/`. `backup_multi_visual/custom_visuals_before_neon_rollout/` holds the packaged visuals from before the neon rollout (mauve Report Page and Table, with the Sales Page neon pilot).

## Mauve Report Page (pages 2 to 6)

- `visuals/mauveReportPage/` is one visual (`report_page_ts`) shared by 5 pages; the `page.kind` object chooses which: `products`, `orders`, `price`, `trends`, `quality`. Styles are in `style/visual.less` (a copy of Mauve Sales Page's), `style/report-pages.less` and the shared `neon.less`.
- Each KPI sparkline shows weekly totals, and its tooltip names the metric it plots (`KpiSpark.label`), which can differ from the KPI's own title.
- **Sales pages** receive order lines through grouping roles and compute totals in `src/visual.ts`, so they **duplicate the DAX rules**, like page 1. Keep the query at line grain and never add a filter-independent measure to it: multi-table grouping would cross-join.
- **Product Performance and Date Trends** are entirely this visual, with built-in Category and date filters that apply to the visual only (saved through `persistProperties`).
- **Order Analysis and Price Analysis** keep a Mauve Table (`oa_lines_table`, `pa_metrics_table`, y 814, h 506, z 500) over an empty area of the page; clicking a table row cross-filters this visual through Power BI. Change one layout and you must change the other.
- **Data Quality** uses this visual for the header and KPIs only (measure roles, one row). It's 1340 high so its background runs behind the 5 Mauve Tables, which stay on top.
- Because the query only returns products with sales, unsold products don't appear in this visual, and **Avg List Price (106.79) covers sold products only**, not the whole catalogue like the `Average List Price` measure (127.20). The Price Metrics and Products tables still list every product.

| Page | Page id |
|---|---|
| Sales Overview | `444395464d5a503c003d` |
| Product Performance | `a577494bd3aa5f7f8ebf` |
| Order Analysis | `2407e83163cd5c45b1fe` |
| Price Analysis | `f05839f12ec650be89af` |
| Date Trends | `458d256ddf07558d87f8` |
| Data Quality | `3bcb7d3a0d785c309bca` |

## Mauve Table

- The 7 standalone tables (Order Line Detail, Price Metrics, 5 on Data Quality) are this private visual in `visuals/mauveTable/` (source in `src/visual.ts`, styles in `style/visual.less`).
- Filters are chosen per column: a dropdown for lists ≤ 30 values and flags, radio buttons for Yes/No and ≤ 3 short values, a `>100`/`<50` box for numbers, a "contains" box otherwise. It also has search, header sorting, row click to cross-filter, and status pills, flag chips and UNKNOWN badges detected from column names.
- Table visuals (`<block>_table`) sit on top of the Mauve Report Page visual (z 500), which leaves their area empty.
- Size the visual from `options.viewport`, never `height: 100%`: the host element has no fixed height and the table collapses to 0 px. Errors and layout problems are written inside the visual in pink, not swallowed.
- Format pane (Table card): title, subtitle, text size, search box, column filters, default sort column and direction.
