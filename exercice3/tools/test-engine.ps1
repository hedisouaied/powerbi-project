# Unit + reconciliation tests of the visual's engine (src/core/data.ts + engine.ts):
#   1. compiles the TypeScript to CommonJS and runs it in Node on the model's JSON feeds
#   2. compares the KPIs with the DAX measures of the open model (all data, and one department, and 2025 only)
#   3. runs unit tests of the scenario engine, risk scoring, anomaly rules, recurrence/conflicts and forecasting
# Needs Power BI Desktop open on MissionControl (refreshed).  Run: powershell -ExecutionPolicy Bypass -File exercice3\tools\test-engine.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = 'C:\Users\DELL\tools\node-v22.23.5-win-x64\node.exe'
$tsc = Join-Path $root 'visuals\missionControl\node_modules\typescript\bin\tsc'
$work = Join-Path $env:TEMP 'mc-engine-test'
$model = Join-Path $PSScriptRoot 'model.ps1'
$inv = [Globalization.CultureInfo]::InvariantCulture
New-Item -ItemType Directory -Force $work | Out-Null
$src = Join-Path $root 'visuals\missionControl\src\core'
& $node $tsc "$src\data.ts" "$src\engine.ts" --outDir $work --module commonjs --target es2020 --skipLibCheck | Out-Host
if ($LASTEXITCODE) { throw 'engine does not compile' }

# feeds from the open model
$feeds = Get-Content (Join-Path $PSScriptRoot 'feeds.json') | ConvertFrom-Json
$parts = foreach ($f in $feeds) {
    $r = @(& $model -Query "EVALUATE ROW(""v"", [Feed $f])" 2>$null)
    if ($r[0] -like 'ERROR*') { throw "feed $f : $r" }
    "  ${f}: " + ($r[1..($r.Count - 1)] -join "`n")
}
[IO.File]::WriteAllText("$work\feeds.js", "module.exports = {`n" + ($parts -join ",`n") + "`n};", (New-Object Text.UTF8Encoding($false)))

$js = @'
const D = require('./data.js'), E = require('./engine.js'), F = require('./feeds.js');
const ds = D.emptyDataset(); for (const t of D.TABLES) { ds[t] = D.decode(JSON.stringify(F[t])); }
const ix = new D.Index(ds);
const all = { p: E.period('all', ix.ref, ix.first), dept: '' };
const y25 = { p: { from: '2025-01-01', to: '2025-12-31', label: '' }, dept: '' };
const out = { ref: ix.ref, all: E.kpis(ix, all), y25: E.kpis(ix, y25) };
// ---- unit tests
const t = [];
const ok = (name, cond, info) => t.push({ name, pass: !!cond, info: info ?? '' });
const b = E.baseline(ix); const base = E.simulate(b, E.ZERO_INPUTS);
ok('scenario: zero inputs reproduce baseline profit', Math.abs(base.operatingProfit - (b.revenue - b.productCost - b.opex)) < 0.01, base.operatingProfit.toFixed(2));
const up = E.simulate(b, { ...E.ZERO_INPUTS, revenuePct: 0.1 });
ok('scenario: +10% revenue raises revenue by 10%', Math.abs(up.revenue - b.revenue * 1.1) < 0.01);
ok('scenario: bridge sums to scenario profit', Math.abs(up.bridge.reduce((s, x) => s + x.value, 0) - up.operatingProfit) < 1, (up.bridge.reduce((s, x) => s + x.value, 0) - up.operatingProfit).toFixed(4));
const mix = E.simulate(b, { revenuePct: 0.05, costPct: 0.1, discountPts: 0.02, headcount: 3, churnPct: 0.04, supplierCostPct: 0.05, marketingPct: -0.2 });
ok('scenario: bridge sums with every input moved', Math.abs(mix.bridge.reduce((s, x) => s + x.value, 0) - mix.operatingProfit) < 1, (mix.bridge.reduce((s, x) => s + x.value, 0) - mix.operatingProfit).toFixed(4));
ok('scenario: risk score in 0..100', mix.risk >= 0 && mix.risk <= 100, mix.risk);
const an = E.anomalies(ix);
ok('anomaly: O00004 amount mismatch detected', an.some(a => a.record === 'O00004' && a.rule === 'Amount mismatch'));
ok('anomaly: O00008 date anomaly detected', an.some(a => a.record === 'O00008' && a.rule === 'Invalid date order'));
const doc = E.dataDoctor(ix); ok('data doctor: score in 0..100', doc.score >= 0 && doc.score <= 100, doc.score);
const q = E.missionQueue(ix); ok('queue: scores sorted and sum of parts', q.every((x, i) => i === 0 || q[i - 1].score >= x.score) && q.every(x => x.score === x.parts.severity + x.parts.impact + x.parts.age + x.parts.confidence), q.length + ' items');
const maxExp = Math.max(...ds.risk_register.map(r => r.estimated_exposure_tnd)); const rs = ds.risk_register.map(r => E.riskScore(r, maxExp).score);
ok('risk score in 0..100', rs.every(s => s >= 0 && s <= 100));
const ev = E.expandEvents([{ event_id: 'X', event_title: 't', start_datetime: '2026-01-05 09:00', end_datetime: '2026-01-05 10:00', recurrence_pattern: 'Weekly', event_status: 'Scheduled', owner_employee_id: 'E1' }], '2026-01-01', '2026-01-31');
ok('recurrence: weekly event gives 4 January occurrences', ev.length === 4, ev.length);
const cf = E.conflicts([{ id: 'a', owner: 'E1', start: '2026-01-05 09:00', end: '2026-01-05 10:00', status: 'Scheduled' }, { id: 'b', owner: 'E1', start: '2026-01-05 09:30', end: '2026-01-05 11:00', status: 'Scheduled' }, { id: 'c', owner: 'E1', start: '2026-01-05 10:00', end: '2026-01-05 11:00', status: 'Cancelled' }]);
ok('conflicts: overlapping same-owner events found, cancelled ignored', cf.length === 1, cf.length);
const fc = E.forecast([1,2,3,4,5,6,7,8,9,10,11,12,13,14].map((v, i) => ({ m: E.addMonths('2025-01-01', i).slice(0, 7), v: 100 + 10 * v })));
const lin = fc.find(f => f.method === 'Linear trend'); ok('forecast: linear trend exact on a straight line', Math.abs(lin.future[0].v - 250) < 1e-6, lin.future[0].v);
ok('forecast: MA3 backtest MAPE computed', fc[0].mape !== null);
const dec = E.decomposeRevenue(ix, { p: { from: '2026-10-01', to: '2026-10-31', label: '' }, dept: '' }, { p: { from: '2026-09-01', to: '2026-09-30', label: '' }, dept: '' });
const byDept = dec.drivers.filter(d => d.dim === 'Department').reduce((s, d) => s + d.delta, 0);
ok('root cause: department contributions add up to the total change', Math.abs(byDept - dec.total) < 0.01, dec.total.toFixed(2));
ok('root cause: price + volume = total change', Math.abs(dec.priceVolume.price + dec.priceVolume.volume - dec.total) < 0.01);
const cr = E.crisis(ix, b, 'revenue', 0.2); ok('crisis: revenue −20% exposure = 20% of baseline revenue', Math.abs(cr.exposure - b.revenue * 0.2) < 0.01);
out.tests = t;
console.log(JSON.stringify(out));
'@
[IO.File]::WriteAllText("$work\run.js", $js, (New-Object Text.UTF8Encoding($false)))
Push-Location $work; try { $res = & $node run.js | ConvertFrom-Json } finally { Pop-Location }

# DAX comparison
$map = [ordered]@{ netRevenue = 'Net Revenue'; grossRevenue = 'Gross Revenue'; tax = 'Tax'; orders = 'Orders'; revenueOrders = 'Revenue Orders'; cancelled = 'Cancelled Orders'; returned = 'Returned Orders'; units = 'Units Sold'; aov = 'Average Order Value'; discount = 'Discount Amount'; cost = 'Product Cost'; gm = 'Gross Margin %'; paid = 'Paid Amount'; outstanding = 'Outstanding Amount'; collectionRate = 'Collection Rate %'; overdue = 'Overdue Payments'; expenses = 'Total Expenses'; openIncidents = 'Open Incidents'; criticalIncidents = 'Critical Incidents'; incidentImpact = 'Estimated Incident Impact'; openAlerts = 'Open Alerts'; criticalAlerts = 'Critical Alerts'; atRiskCustomers = 'At-Risk Customers'; projectCompletion = 'Project Completion %'; atRiskProjects = 'At-Risk Projects'; openTasks = 'Open Tasks'; overdueTasks = 'Overdue Tasks'; revenueTarget = 'Revenue Target' }
$fail = 0
foreach ($sc in @(@{ n = 'all data'; k = 'all'; f = '' }, @{ n = 'year 2025 (dated KPIs)'; k = 'y25'; f = 'DATESBETWEEN(dim_date[date], DATE(2025,1,1), DATE(2025,12,31))'; only = 'netRevenue,grossRevenue,tax,orders,revenueOrders,cancelled,returned,units,aov,discount,cost,gm,paid,outstanding,collectionRate,overdue,expenses,revenueTarget' })) {
    $keys = @($map.Keys | Where-Object { -not $sc.only -or $_ -in $sc.only.Split(',') })
    $row = ($keys | ForEach-Object { "`"$_`", [$($map[$_])]" }) -join ', '
    $q = if ($sc.f) { "EVALUATE CALCULATETABLE(ROW($row), $($sc.f))" } else { "EVALUATE ROW($row)" }
    $r = @(& $model -Query $q 2>$null); $vals = $r[1] -split ' \| '
    $bad = @()
    for ($i = 0; $i -lt $keys.Count; $i++) {
        $d = if ($vals[$i] -eq '<null>') { 0 } else { [double]::Parse(($vals[$i] -replace ',', '.'), $inv) }
        $v = [double]($res.($sc.k).($keys[$i]))
        if ([math]::Abs($d - $v) -gt [math]::Max(0.01, [math]::Abs($d) * 1e-9)) { $bad += "$($keys[$i]): visual=$v dax=$d" }
    }
    "{0,-26} {1}/{2} KPIs match DAX" -f $sc.n, ($keys.Count - $bad.Count), $keys.Count
    $bad | ForEach-Object { "   MISMATCH $_" }; $fail += $bad.Count
}
"unit tests: {0}/{1} pass" -f @($res.tests | Where-Object pass).Count, $res.tests.Count
$res.tests | Where-Object { -not $_.pass } | ForEach-Object { "   FAIL $($_.name) $($_.info)"; $fail++ }
if ($fail) { exit 1 }
