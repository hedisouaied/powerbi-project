What if every page of a Power BI report was one single custom visual? 📊

I built a retail sales report for a Tunisian retailer (amounts in TND), and every one of its 6 pages is drawn by a single custom visual written in TypeScript: no stacked slicers, cards or tables, just one coherent, interactive page.

What you can do in it (all shown in the video, recorded live in Power BI Desktop):

🔹 Filter by date range, month, store or category, then reset everything with one click
🔹 Click a donut slice, a store bar, a month or a table row and the whole page recalculates
🔹 Hover any chart for detailed tooltips (net, gross, orders, units, average order value)
🔹 Sort, search and filter every table, column by column
🔹 Drill into a single order from the line-level table, then clear it with a chip

The 6 pages: Sales Overview, Product Performance, Order Analysis, Price Analysis, Date Trends and Data Quality.

The part I care about most is the Data Quality page. The source data has real problems: a payment of 999.00 against a 45.00 order, a payment with no amount, orders with no payment, refunds, missing customer segments. Instead of silently "fixing" them, the report keeps them visible and flagged, so anyone can see exactly where the numbers come from.

Before recording, I tested 30 interactions and checked the totals against the source data (3,498.60 TND net revenue, 32 orders, 55 units). 29 passed. One honest limitation: Power BI only lets custom visuals download files when you're signed in and your admin allows it, so in that case the built-in File › Export to PDF is the way to go.

Built with: Power BI Desktop, TypeScript custom visuals (Power BI visuals SDK) with ECharts, a star-schema model in DAX, and a Python cleaning pipeline.

How do you handle data quality issues in your dashboards: fix them upstream, or keep them visible? I'd love to hear your approach 👇

#PowerBI #DataVisualization #DataAnalytics #BusinessIntelligence #TypeScript #DataQuality #Dashboard #DAX
