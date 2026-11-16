# Inventory (from the PBIX definition, Report/definition/*)

| Page | Visuals | Visual type | page.kind |
|---|---|---|---|
| Sales Overview | 1 | mauveSalesPage (custom, private) | — |
| Product Performance | 1 | mauveReportPage (custom, private) | products |
| Order Analysis | 1 | mauveReportPage | orders |
| Price Analysis | 1 | mauveReportPage | price |
| Date Trends | 1 | mauveReportPage | trends |
| Data Quality | 1 | mauveReportPage | quality |

Not present in the file: bookmarks (no bookmarks folder), drill-through pages (no pageBinding), native slicers,
buttons/action buttons, report-page tooltips, native tables/matrices, cross-filtering between visuals (one visual per page).
Mauve Table visual is registered in the file but not used on any page.

Interactive features inside the custom visuals (from source, to be verified on screen):
- Sales Overview: date range (from/to, quick period), Store and Category dropdowns, Clear all; KPI cards with sparklines;
  Net Revenue Trend (month chips filter); Order Status Mix donut (click status filters); Net Revenue by Store (click filters);
  Product Snapshot table (sort, search, Excel download); Download PDF; Send by email (NOT tested: real email).
- Product Performance: Category filter, category donut click-filter, bar chart tooltips, sortable/searchable table.
- Order Analysis: KPIs, Gross vs Net by status, Orders by status donut, Order Line Detail table (dropdown filters, search,
  sort, row click filters page to an order, order chip clears).
- Price Analysis: KPIs, avg unit price bars, units vs price scatter, list vs selling price, Price Metrics table.
- Date Trends: date range + month quick filter, daily trend with month chips, orders/units by month, monthly table.
- Data Quality: KPIs from measures, 5 tables (Payments, Order Flags, Customers, Products, Stores) with filters/search/sort.
