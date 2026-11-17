# Builds reports/test-report.html from tmp/results.jsonl (tests actually run) and the inventory.
$demo = 'c:\Users\DELL\Downloads\powerBiProject\powerbi-demo'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$results = Get-Content "$demo\tmp\results.jsonl" -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json }
function Enc([string]$s) { [System.Net.WebUtility]::HtmlEncode($s) }
function Badge([string]$status) {
    $cls = if ($status -like 'Pass (*') { 'warn' } elseif ($status -like 'Pass*') { 'pass' } elseif ($status -like 'Fail*') { 'fail' } else { 'inc' }
    "<span class='badge $cls'>$(Enc $status)</span>"
}
$pass = @($results | Where-Object { $_.status -like 'Pass*' }).Count
$fail = @($results | Where-Object { $_.status -like 'Fail*' }).Count
$minor = @($results | Where-Object { $_.status -like 'Pass (*' }).Count

$rows = ($results | ForEach-Object {
    "<tr><td class='id'>$($_.id)</td><td>$(Enc $_.page)</td><td><b>$(Enc $_.feature)</b><div class='muted'>$(Enc $_.action)</div></td><td>$(Enc $_.expected)</td><td>$(Enc $_.actual)</td><td>$(Badge $_.status)</td><td><a href='../screenshots/$($_.shot)'><img src='../screenshots/$($_.shot)' alt='$(Enc $_.id) screenshot' loading='lazy'></a></td></tr>"
}) -join "`n"

$pages = @(
    @('Sales Overview', 'Mauve Sales Page', 'Date range + quick period, Store and Category dropdowns, Clear all; 4 KPI cards with sparklines; weekly trend with month chips; status donut (click-filter); store ranking (click-filter); Product Snapshot table (sort, search, Excel); Download PDF; Send by email', 'dashboard-overview.png'),
    @('Product Performance', 'Mauve Report Page (products)', 'Category filter; 4 KPIs; net revenue by product bars; category donut (click-filter); Product Metrics table (sort, search)', '20-product-performance.png'),
    @('Order Analysis', 'Mauve Report Page (orders)', '4 KPIs; gross vs net by status; orders by status donut; Order Line Detail table (5 dropdown filters, search, sort, row click filters page, order chip)', '23-order-analysis.png'),
    @('Price Analysis', 'Mauve Report Page (price)', '4 KPIs; avg unit price bars; units vs price scatter; selling vs list price; Price Metrics table (category filter, search, sort)', '28-price-analysis.png'),
    @('Date Trends', 'Mauve Report Page (trends)', 'Date range + month filter; 4 KPIs; daily trend with average line and month chips; orders/units by month; Monthly Detail with total row', '32-date-trends.png'),
    @('Data Quality', 'Mauve Report Page (quality)', '5 KPIs; Payments, Order Flags, Customers, Products, Stores tables (dropdown filters, search, sort, flag chips, UNKNOWN badges)', '36-data-quality.png')
)
$pageCards = ($pages | ForEach-Object { "<div class='page'><a href='../screenshots/$($_[3])'><img src='../screenshots/$($_[3])' alt='$(Enc $_[0])'></a><h3>$(Enc $_[0])</h3><div class='muted'>$(Enc $_[1]) &middot; 1 visual</div><p>$(Enc $_[2])</p></div>" }) -join "`n"

$html = @"
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Power BI Test Report</title>
<style>
:root{--bg:#060818;--card:#141836;--line:rgba(148,163,255,.18);--text:#EEF2FF;--soft:#C7D2FE;--muted:#8B93B8;--cyan:#22D3EE;--green:#34D399;--pink:#F472B6;--orange:#FB923C}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.5 "Segoe UI",system-ui,sans-serif}
main{max-width:1280px;margin:0 auto;padding:32px 16px 64px}h1{font-size:30px;margin:0 0 4px}h2{font-size:21px;margin:40px 0 14px;color:var(--cyan)}h3{margin:10px 0 2px;font-size:17px}
.muted{color:var(--muted);font-size:13px}.lead{color:var(--soft);max-width:900px}
.stats{display:flex;flex-wrap:wrap;gap:12px;margin:20px 0}.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 20px;min-width:150px}.stat b{display:block;font-size:28px}
.pages{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}.page{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px}.page img{width:100%;border-radius:8px;display:block}.page p{color:var(--soft);font-size:14px;margin:8px 0 0}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:14px}table{border-collapse:collapse;width:100%;min-width:1000px;background:var(--card)}
th,td{padding:10px 12px;border-bottom:1px solid var(--line);vertical-align:top;text-align:left;font-size:14px}th{color:var(--muted);font-size:12px;letter-spacing:1px;text-transform:uppercase;position:sticky;top:0;background:#101430}
td img{width:180px;border-radius:6px;display:block}.id{font-weight:700;color:var(--cyan);white-space:nowrap}
.badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:12px;font-weight:700;border:1px solid;white-space:nowrap}.pass{color:var(--green)}.warn{color:var(--orange)}.fail{color:var(--pink)}.inc{color:var(--muted)}
ul{color:var(--soft)}li{margin:6px 0}code{color:var(--cyan)}
</style></head><body><main>
<h1>Power BI Dashboard Test Report</h1>
<div class="muted">onepage.pbix &middot; tested on a copy in Power BI Desktop 2.159.1231.0 (Windows 11, 1920&times;1080) &middot; 16 Nov 2026</div>
<p class="lead">Retail sales report for a Tunisian retailer (amounts in TND). Six pages, each drawn by a single private TypeScript custom visual. Every result below comes from a real interaction recorded on screen; numbers were cross-checked against the source CSVs (net 3,498.60, gross 4,105.60, 55 units, 32 orders, 33 lines, store totals, cancelled lines, refunded payments: all match).</p>
<div class="stats">
<div class="stat"><b>$($results.Count)</b><span class="muted">tests run</span></div>
<div class="stat"><b style="color:var(--green)">$pass</b><span class="muted">passed ($minor with minor issues)</span></div>
<div class="stat"><b style="color:var(--pink)">$fail</b><span class="muted">failed (environment)</span></div>
<div class="stat"><b>6</b><span class="muted">pages &middot; 6 visuals</span></div>
</div>

<h2>Report pages</h2>
<div class="pages">
$pageCards
</div>

<h2>Inventory of interactive features</h2>
<ul>
<li><b>Present (inside the custom visuals):</b> dropdown filters (store, category, period, per-column table filters), date range inputs, Clear all, click-to-filter on donuts, bars, month chips and table rows, removable filter chips, glass tooltips on every chart and sparkline, sortable and searchable tables, Download PDF and Excel buttons, Send by email button, saved filter state (filters persist in the file).</li>
<li><b>Not present in this report</b> (checked in the PBIX definition): bookmarks, drill-down / drill-up hierarchies, drill-through pages, native slicers, navigation or action buttons, report-page tooltips, native tables or matrices, cross-filtering between visuals (each page has one visual, so all interaction is inside it).</li>
</ul>

<h2>Tests executed</h2>
<div class="tablewrap"><table>
<thead><tr><th>ID</th><th>Page</th><th>Feature / action</th><th>Expected</th><th>Actual</th><th>Status</th><th>Evidence</th></tr></thead>
<tbody>
$rows
</tbody></table></div>

<h2>Issues and limitations</h2>
<ul>
<li><b>Download PDF blocked (T12).</b> The visual's confirmation dialog works, but Power BI Desktop then showed "Telechargement non disponible - your administrator has restricted downloads". Power BI only lets custom visuals save files when the user is signed in and the tenant switch "Allow downloads from custom visuals" is on; Desktop here was not signed in. Workaround: File &rsaquo; Export &rsaquo; Export to PDF. (A later build of the visual explains this to the user; the tested file predates it.)</li>
<li><b>Minor:</b> the Net Revenue sparkline tooltip is clipped at the KPI card's right edge (T02).</li>
<li><b>Minor:</b> scatter labels overlap where bubbles are close (Wireless Mouse / Water Bottle, USB-C Cable / Notebook A5) (T22).</li>
<li><b>Minor:</b> the last column of the Customers and Products tables on Data Quality is partly cut off behind a horizontal scrollbar (T30).</li>
<li><b>Minor:</b> the Product Performance donut centre shows net revenue rounded (3,499) while elsewhere it is 3,498.60.</li>
<li>Documented data exceptions are shown as intended, not treated as defects: selling price = list price everywhere, ORD-1030 paid 999.00, PAY020 without amount, ORD-1007/ORD-1017 without payment, refunds on ORD-1003/ORD-1011 retained, no customer segments.</li>
</ul>

<h2>Features not tested</h2>
<ul>
<li><b>Send by email</b>: not clicked on purpose, it sends a real email.</li>
<li><b>Excel download</b>: the test was interrupted; it uses the same download API as the PDF and is expected to be blocked the same way in this environment.</li>
<li>Typing dates into the From/To inputs (dates were set through the month controls instead), the mobile layout, and the report in Power BI Service.</li>
<li>Test automation could not read inside the custom visuals (sandboxed frames), so every result was verified from screenshots.</li>
</ul>
</main></body></html>
"@
[IO.File]::WriteAllText("$demo\reports\test-report.html", $html, $utf8)
"report: $($results.Count) tests, $pass pass, $fail fail"
