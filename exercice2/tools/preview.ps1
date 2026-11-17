# Renders the packaged BOI 360 Page visual OUTSIDE Power BI (fake host, data from data\*.csv shaped like the
# JSON feed measures) and saves headless-Chrome screenshots. Does not touch the screen or Power BI Desktop.
# Usage: preview.ps1 [-Kinds overview,sales,...] [-Out folder] [-Filters '{"dept":"IT"}']
param(
    [string[]]$Kinds = @('overview', 'sales', 'people', 'projects', 'tasks', 'finance', 'customers', 'actions'),
    [string]$Out = (Join-Path $env:TEMP 'boi360-preview'),
    [string]$Filters = '{}',
    [string]$Script = '',      # extra JS run after the visual renders (tests)
    [switch]$DumpDom            # print document.title instead of a screenshot (test results)
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $root 'data'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$inv = [Globalization.CultureInfo]::InvariantCulture
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force $Out | Out-Null

$package = Get-ChildItem "$root\visuals\boi360Page\dist" -Filter *.pbiviz | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$zip = [IO.Compression.ZipFile]::OpenRead($package.FullName)
$reader = New-Object IO.StreamReader(($zip.Entries | Where-Object { $_.FullName -like 'resources/*.pbiviz.json' }).Open(), $utf8)
$visual = $reader.ReadToEnd() | ConvertFrom-Json
$reader.Close(); $zip.Dispose()

function N($v) { if ($v) { [double]::Parse($v, $inv) } else { 0 } }
function Csv($n) { Import-Csv (Join-Path $data "$n.csv") -Encoding UTF8 }
$emp = Csv employees; $emails = $emp | Group-Object email | Where-Object Count -gt 1 | ForEach-Object Name
$sales = Csv sales_transactions
$ref = ($sales.transaction_date | Sort-Object | Select-Object -Last 1)
$feeds = [ordered]@{
    meta = @{ ref = $ref }
    departments = @(Csv departments | ForEach-Object { [ordered]@{ id = $_.department_id; n = $_.department_name; dv = $_.division; c = $_.base_city } })
    employees = @($emp | ForEach-Object { [ordered]@{ id = $_.employee_id; n = "$($_.first_name) $($_.last_name)"; d = $_.department_id; j = $_.job_title; c = $_.city; h = $_.hire_date; s = $_.employment_status; e = $_.email; x = ($_.email -in $emails) } })
    customers = @(Csv customers | ForEach-Object { [ordered]@{ id = $_.customer_id; n = $_.customer_name; g = $_.customer_segment; c = $_.city } })
    products = @(Csv products | ForEach-Object { [ordered]@{ id = $_.product_id; n = $_.product_name; c = $_.category; l = (N $_.list_price_tnd) } })
    sales = @($sales | ForEach-Object { [ordered]@{ id = $_.transaction_id; d = $_.transaction_date; c = $_.customer_id; p = $_.product_id; s = $_.seller_id; q = [int]$_.quantity; u = (N $_.unit_price_tnd); dc = (N $_.discount_pct); r = (N $_.revenue_tnd); k = (N $_.cost_tnd); pf = (N $_.profit_tnd); st = $_.payment_status; rg = $_.sales_region } })
    targets = @(Csv targets | ForEach-Object { [ordered]@{ id = $_.target_id; e = $_.employee_id; m = $_.target_month; t = (N $_.target_amount_tnd); a = (N $_.actual_sales_tnd) } })
    projects = @(Csv projects | ForEach-Object { [ordered]@{ id = $_.project_id; n = $_.project_name; pm = $_.project_manager_id; d = $_.department_id; sd = $_.start_date; dl = $_.deadline; b = (N $_.budget_tnd); ac = (N $_.actual_cost_tnd); st = $_.project_status; pr = $_.priority } })
    tasks = @(Csv tasks | ForEach-Object { [ordered]@{ id = $_.task_id; t = $_.task_title; p = $_.project_id; a = $_.assignee_id; cd = $_.created_date; dd = $_.due_date; st = $_.task_status; pr = $_.priority; so = $_.source } })
    expenses = @(Csv expenses | ForEach-Object { [ordered]@{ id = $_.expense_id; dt = $_.expense_date; d = $_.department_id; p = $_.project_id; c = $_.expense_category; st = $_.approval_status; a = (N $_.amount_tnd); ds = $_.description } })
    leave = @(Csv leave_requests | ForEach-Object { [ordered]@{ id = $_.leave_id; e = $_.employee_id; t = $_.leave_type; sd = $_.start_date; ed = $_.end_date; w = [int]$_.working_days; st = $_.request_status; cm = $_.comment } })
}
$feedJson = ($feeds.Keys | ForEach-Object { "'$_': " + (ConvertTo-Json -InputObject $feeds[$_] -Depth 4 -Compress | ConvertTo-Json -Compress) }) -join ",`n"

$chrome = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
foreach ($kind in $Kinds) {
    $html = @"
<!doctype html><html><head><meta charset='utf-8'><style>html,body{margin:0;background:#090B0F;overflow:hidden} .bx-page *, .bx-page *::before, .bx-page *::after{animation:none!important;transition:none!important}#v{position:relative;width:1280px;height:720px}$($visual.content.css)</style></head>
<body><div id='v'></div><script>
window.fetch = () => Promise.reject(new Error('network blocked in preview'));
window.powerbi = {};
</script><script>$($visual.content.js)</script><script>
const feeds = { $feedJson };
const roles = Object.keys(feeds);
const columns = roles.map(r => ({ displayName: r, roles: { [r]: true }, type: { text: true } }));
const rows = [roles.map(r => feeds[r])];
let objects = { page: { kind: '$kind' }, state: { filters: JSON.stringify($Filters) } };
window.persistLog = []; window.exportLog = [];
const host = {
  eventService: { renderingStarted() {}, renderingFinished() {}, renderingFailed(o, e) { window.renderError = e; } },
  downloadService: { exportStatus: () => Promise.resolve(3), exportVisualsContentExtended: (c, n, t) => { window.exportLog.push({ n, t }); return Promise.resolve({ downloadCompleted: false }); } },
  persistProperties(ch) { window.persistLog.push(ch); ch.merge.forEach(m => { objects[m.objectName] = Object.assign({}, objects[m.objectName], m.properties); }); setTimeout(update, 0); }
};
const element = document.getElementById('v');
const instance = powerbi.visuals.plugins['$($visual.visual.guid)'].create({ element, host });
function update() { instance.update({ viewport: { width: 1280, height: 720 }, dataViews: [{ table: { columns, rows }, metadata: { columns, objects } }] }); }
update();
setTimeout(update, 100);  // settled state: the second render has no entrance animation or count-up
$Script
</script></body></html>
"@
    $page = Join-Path $Out "preview-$kind.html"
    [IO.File]::WriteAllText($page, $html, $utf8)
    $png = Join-Path $Out "$kind.png"
    if (Test-Path $png) { Remove-Item $png }
    $profile = Join-Path $Out 'chrome-profile'
    if ($DumpDom) {
        $args = @('--headless=new', '--disable-gpu', "--user-data-dir=`"$(Join-Path $Out 'chrome-profile')`"", '--virtual-time-budget=8000', '--dump-dom', ("file:///" + $page.Replace('\', '/')))
        $dom = Join-Path $Out "$kind.dom.html"
        Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden -RedirectStandardOutput $dom -RedirectStandardError (Join-Path $Out 'chrome.log')
        $m = [regex]::Match((Get-Content $dom -Raw), '<title>(.*?)</title>', 'Singleline'); "{0,-10} {1}" -f $kind, [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
        continue
    }
    $args = @('--headless=new', '--disable-gpu', '--hide-scrollbars', "--user-data-dir=`"$profile`"", '--window-size=1280,720', '--virtual-time-budget=6000', "--screenshot=`"$png`"", ("file:///" + $page.Replace('\', '/')))
    Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden -RedirectStandardError (Join-Path $Out 'chrome.log')
    for ($i = 0; $i -lt 30 -and -not (Test-Path $png); $i++) { Start-Sleep -Milliseconds 500 }
    "{0,-10} {1}" -f $kind, $(if (Test-Path $png) { $png } else { 'NO SCREENSHOT' })
}
