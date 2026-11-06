# Builds a test page that runs a compiled custom visual outside Power BI, with data from output/*.csv and a fake host.
# The mail service is stubbed, so nothing can reach port 8787 and no real email can be sent. Downloads are logged, not saved.
# Usage: make-test-page.ps1 -Which sales|report|table    The report visual picks its page with ?kind=products|orders|price|trends|quality
param([ValidateSet('sales', 'report', 'table')][string]$Which = 'report')
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..\..\..").Path
$out = "$root\output"
$utf8 = New-Object System.Text.UTF8Encoding($false)
$project = @{ sales = 'mauveSalesPage'; report = 'mauveReportPage'; table = 'mauveTable' }[$Which]

$package = Get-ChildItem "$root\visuals\$project\dist" -Filter *.pbiviz | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($package.FullName)
$entry = $zip.Entries | Where-Object { $_.FullName -like 'resources/*.pbiviz.json' }
$reader = New-Object IO.StreamReader($entry.Open(), $utf8)
$visual = $reader.ReadToEnd() | ConvertFrom-Json
$reader.Close(); $zip.Dispose()

$sales = Import-Csv "$out\FactSales.csv"
$dates = @{}; Import-Csv "$out\DimDate.csv" | ForEach-Object { $dates[$_.DateKey] = $_.Date }
$products = @{}; Import-Csv "$out\DimProduct.csv" | ForEach-Object { $products[$_.ProductKey] = $_ }
$stores = @{}; Import-Csv "$out\DimStore.csv" | ForEach-Object { $stores[$_.StoreKey] = $_ }
$customers = Import-Csv "$out\DimCustomer.csv"
$customerUnknown = @{}; $customers | ForEach-Object { $customerUnknown[$_.CustomerKey] = $_.Is_Unknown -eq 'True' }
$payments = Import-Csv "$out\FactPayments.csv"
$orders = Import-Csv "$out\DimOrder.csv"
$inv = [Globalization.CultureInfo]::InvariantCulture

$rows = foreach ($s in $sales) {
    $p = $products[$s.ProductKey]; $st = $stores[$s.StoreKey]
    [pscustomobject]@{
        date = $dates[$s.DateKey]; order = $s.Order_ID; line = $s.Order_Line_ID
        store = $st.Store_Name; storeUnknown = $st.Is_Unknown -eq 'True'
        product = $p.Product_Name; productUnknown = $p.Is_Unknown -eq 'True'; category = $p.Category
        listPrice = $(if ($p.List_Price_TND) { [double]::Parse($p.List_Price_TND, $inv) } else { $null })
        status = $s.Order_Status; quantity = [int]$s.Quantity; discount = [double]::Parse($s.Discount_Percent, $inv)
        gross = [double]::Parse($s.Gross_Sales_TND, $inv); net = [double]::Parse($s.Net_Sales_TND, $inv); flag = $s.Data_Quality_Flag
    }
}
$unknownLines = @($sales | Where-Object { $customerUnknown[$_.CustomerKey] }).Count + @($sales | Where-Object { $products[$_.ProductKey].Is_Unknown -eq 'True' }).Count + @($sales | Where-Object { $stores[$_.StoreKey].Is_Unknown -eq 'True' }).Count
$missingSegments = @($customers | Where-Object { -not $_.Segment }).Count
$measures = [ordered]@{
    flaggedLines = @($sales | Where-Object { $_.Data_Quality_Flag }).Count; orderLines = @($sales).Count; unknownLines = $unknownLines
    missingPayments = @($payments | Where-Object { -not $_.Payment_Amount_TND }).Count
    noPaymentOrders = @($orders | Where-Object { $_.Payment_Status -eq 'No Payment' }).Count
    paymentExceptions = @($payments | Where-Object { $_.Payment_Flag }).Count
    segmentCoverage = (@($customers).Count - $missingSegments) / @($customers).Count; missingSegments = $missingSegments
}

$fullPage = "const size = () => { const width = document.documentElement.clientWidth; return { width, height: Math.round(width * 1340 / 1920) }; };"
$setup = switch ($Which) {
    'sales' { @"
const roles = ['date','order','line','store','storeUnknown','product','category','status','quantity','gross','net'];
const rows = raw.map(r => roles.map(role => role === 'date' ? new Date(r.date + 'T00:00:00') : r[role]));
const columns = roles.map((role, i) => ({ displayName: role, roles: { [role]: true }, type: i === 0 ? { dateTime: true } : {} }));
let objects = {};
$fullPage
"@ }
    'report' { @"
const kind = new URLSearchParams(location.search).get('kind') || 'products';
const measures = $($measures | ConvertTo-Json -Compress);
const lineRoles = ['date','order','line','product','productUnknown','category','listPrice','status','quantity','discount','gross','net'];
const roles = kind === 'quality' ? Object.keys(measures) : lineRoles;
const rows = kind === 'quality' ? [roles.map(r => measures[r])] : raw.map(r => roles.map(role => role === 'date' ? new Date(r.date + 'T00:00:00') : r[role]));
const columns = roles.map(role => ({ displayName: role, roles: { [role]: true }, type: {} }));
let objects = { page: { kind } };
$fullPage
"@ }
    'table' { @"
const defs = [['Order_ID','order',{}],['Line','line',{}],['Date','date',{}],['Product','product',{}],['Category','category',{}],['Order_Status','status',{}],['Quantity','quantity',{numeric:true}],['Gross','gross',{numeric:true}],['Net','net',{numeric:true}],['Data_Quality_Flag','flag',{}]];
const rows = raw.map(r => defs.map(d => r[d[1]] === '' ? null : r[d[1]]));
const columns = defs.map(d => ({ displayName: d[0], queryName: d[0], roles: { fields: true }, type: d[2] }));
let objects = { table: { title: 'Test table', subtitle: 'Mauve Table test page', showFilters: true, showSearch: true } };
const size = () => { const width = Math.min(document.documentElement.clientWidth - 40, 1400); return { width, height: Math.round(width * 506 / 1840) + 120 }; };
"@ }
}

$html = @"
<!doctype html><html><head><meta charset='utf-8'><title>$project test</title><style>body{margin:0;background:#060818}#v{position:relative}$($visual.content.css)</style></head>
<body><div id='v'></div><script>
window.fetch = (url, init) => {
  const u = String(url);
  if (u.endsWith('/health')) return Promise.resolve(new Response(JSON.stringify({ ok: true, configured: true, to: 'dry-run@test.local' })));
  if (u.endsWith('/send')) { window.lastEmail = JSON.parse(init.body); return Promise.resolve(new Response(JSON.stringify({ ok: true, to: 'dry-run@test.local' }))); }
  return Promise.reject(new Error('blocked in test: ' + u));
};
window.powerbi = {};
// A hidden test browser never fires requestAnimationFrame, which chart animations and the PDF capture need.
window.requestAnimationFrame = cb => setTimeout(() => cb(performance.now()), 16);
</script><script>$($visual.content.js)</script><script>
const raw = $($rows | ConvertTo-Json -Depth 3 -Compress);
$setup
window.persistLog = []; window.selected = []; window.exportLog = [];
const callbacks = [];
const host = {
  eventService: { renderingStarted() {}, renderingFinished() {}, renderingFailed(o, e) { window.renderError = e; console.error(e); } },
  downloadService: { exportStatus: () => Promise.resolve(0), exportVisualsContentExtended: (c, n, t) => { window.exportLog.push({ name: n, type: t, size: c.length }); return Promise.resolve({ downloadCompleted: true, fileName: n }); } },
  webAccessService: { webAccessStatus: () => Promise.resolve(0) },
  createSelectionManager: () => ({
    select(id, multi) { const ids = [].concat(id); window.selected = multi ? window.selected.concat(ids) : ids; return Promise.resolve(window.selected); },
    clear() { window.selected = []; return Promise.resolve(); },
    showContextMenu() { return Promise.resolve(); },
    registerOnSelectCallback(c) { callbacks.push(c); },
    getSelectionIds() { return window.selected; },
    hasSelection() { return window.selected.length > 0; }
  }),
  createSelectionIdBuilder: () => { let key = ''; const b = { withTable(t, i) { key = 'row' + i; return b; }, createSelectionId() { const k = key; return { getKey: () => k, equals: o => o.getKey() === k }; } }; return b; },
  persistProperties(changes) { window.persistLog.push(changes); changes.merge.forEach(m => { objects[m.objectName] = Object.assign({}, objects[m.objectName], m.properties); }); setTimeout(update, 0); }
};
const element = document.getElementById('v');
const instance = powerbi.visuals.plugins['$($visual.visual.guid)'].create({ element, host });
function update() {
  const { width, height } = size();
  element.style.width = width + 'px'; element.style.height = height + 'px';
  instance.update({ viewport: { width, height }, dataViews: [{ table: { columns, rows }, metadata: { columns, objects } }] });
}
update();
</script></body></html>
"@
$folder = Join-Path $env:TEMP 'biproject-test'
New-Item -ItemType Directory -Force $folder | Out-Null
[IO.File]::WriteAllText("$folder\preview.html", $html, $utf8)
"$Which test page ready from $($package.Name): $(@($rows).Count) rows. Serve it with serve.js on http://localhost:4317/"
