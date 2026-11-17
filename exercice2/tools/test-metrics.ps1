# Compiles the visual's calculation module (src/metrics.ts), runs it in Node on the model's JSON feeds,
# and compares every KPI with the DAX measure of the same name - with no filter and with sample filters.
# Needs Power BI Desktop open on BOI360 (refreshed).   Run: powershell -ExecutionPolicy Bypass -File exercice2\tools\test-metrics.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$node = 'C:\Users\DELL\tools\node-v22.23.5-win-x64\node.exe'
$tsc = Join-Path $root 'visuals\boi360Page\node_modules\typescript\bin\tsc'
$work = Join-Path $env:TEMP 'boi360-metrics-test'
New-Item -ItemType Directory -Force $work | Out-Null
. (Join-Path $PSScriptRoot 'measures.ps1')
$model = Join-Path $PSScriptRoot 'model.ps1'
$inv = [Globalization.CultureInfo]::InvariantCulture

# 1. compile metrics.ts to CommonJS
& $node $tsc (Join-Path $root 'visuals\boi360Page\src\metrics.ts') --outDir $work --module commonjs --target es2020 --skipLibCheck | Out-Host
if ($LASTEXITCODE) { throw 'metrics.ts does not compile' }

# 2. export the JSON feeds from the open model
$define = "DEFINE`n" + ((Get-Measures | Where-Object Name -like 'JSON *' | ForEach-Object { "MEASURE sales_transactions[$($_.Name)] =`n$($_.Expression)" }) -join "`n")
$feed = [ordered]@{}
foreach ($n in 'Meta', 'Departments', 'Employees', 'Customers', 'Products', 'Sales', 'Targets', 'Projects', 'Tasks', 'Expenses', 'Leave') {
    $out = & $model -Query ($define + "`nEVALUATE ROW(""v"", [JSON $n])")
    $feed[$n] = ($out | Select-Object -Skip 1) -join "`n"
}
$dataJs = "module.exports = { ref: ($($feed.Meta)).ref, departments: $($feed.Departments), employees: $($feed.Employees), customers: $($feed.Customers), products: $($feed.Products), sales: $($feed.Sales), targets: $($feed.Targets), projects: $($feed.Projects), tasks: $($feed.Tasks), expenses: $($feed.Expenses), leave: $($feed.Leave) };"
[IO.File]::WriteAllText("$work\data.js", $dataJs, (New-Object Text.UTF8Encoding($false)))

# 3. scenarios: visual filters, and the same filters written as DAX
$scenarios = @(
    @{ name = 'no filter'; filters = '{}'; dax = '' },
    @{ name = 'department = IT'; filters = '{"dept":"IT"}'; dax = 'departments[department_name] = "IT"' },
    @{ name = 'Mar-Jun 2026'; filters = '{"from":"2026-03","to":"2026-06"}'; dax = 'DATESBETWEEN(''Date''[Date], DATE(2026,3,1), DATE(2026,6,30))' }
)
$failures = 0
foreach ($sc in $scenarios) {
    $js = @"
const m = require('./metrics.js'); const data = require('./data.js');
const L = new m.Lookup(data); const f = $($sc.filters);
const s = m.salesKpis(m.filterSales(L, f)), t = m.targetKpis(m.filterTargets(L, f)), x = m.expenseKpis(m.filterExpenses(L, f), L);
const p = m.projectKpis(m.filterProjects(L, f), data.ref), k = m.taskKpis(m.filterTasks(L, f), data.ref), e = m.peopleKpis(m.filterEmployees(L, f)), l = m.leaveKpis(m.filterLeave(L, f));
console.log(JSON.stringify({ 'Revenue': s.revenue, 'Profit': s.profit, 'Profit Margin %': s.margin, 'Transactions': s.transactions, 'Average Order Value': s.aov,
  'Units Sold': s.units, 'Average Discount %': s.discount, 'Collected Revenue': s.collected, 'Receivables': s.receivables, 'Cancelled Revenue': s.cancelled,
  'Customers with Sales': s.customers, 'Target Amount': t.target, 'Target Achievement %': t.achievement, 'Sellers Below Target': t.below,
  'Approved Expenses': x.approved, 'Pending Expenses': x.pending, 'Rejected Expenses': x.rejected, 'Expense Approval Rate %': x.approvalRate,
  'Expenses Without Project': x.withoutProject, 'Cross-Department Project Expenses': x.crossDepartment,
  'Project Budget': p.budget, 'Project Actual Cost': p.cost, 'Budget Utilization %': p.utilization, 'Projects Over Budget': p.overBudget, 'Projects Past Deadline': p.pastDeadline,
  'Tasks': k.tasks, 'Open Tasks': k.open, 'Overdue Tasks': k.overdue, 'Task Completion Rate %': k.completion, 'Average Days Overdue': k.avgDaysOverdue,
  'Employees': e.employees, 'Active Employees': e.active, 'Leave Requests': l.requests, 'Leave Days': l.days, 'Approved Leave Days': l.approvedDays, 'Leave Approval Rate %': l.approvalRate }));
"@
    [IO.File]::WriteAllText("$work\run.js", $js, (New-Object Text.UTF8Encoding($false)))
    Push-Location $work; try { $ts = & $node run.js | ConvertFrom-Json } finally { Pop-Location }
    $names = $ts.PSObject.Properties.Name
    # Projects have no date relationship and employees are not dated: under a date filter DAX keeps them unfiltered, like the visual.
    $row = ($names | ForEach-Object { "`"$_`", [$_]" }) -join ', '
    $query = if ($sc.dax) { "EVALUATE CALCULATETABLE(ROW($row), $($sc.dax))" } else { "EVALUATE ROW($row)" }
    $out = & $model -Query $query
    if ($out[0] -like 'ERROR*') { throw ($out -join ' ') }
    $vals = $out[1] -split ' \| '
    $bad = @()
    for ($i = 0; $i -lt $names.Count; $i++) {
        $d = if ($vals[$i] -eq '<null>') { $null } else { [double]::Parse(($vals[$i] -replace ',', '.'), $inv) }
        $v = $ts.($names[$i])
        $ok = ($null -eq $d -and ($null -eq $v -or $v -eq 0)) -or ($null -ne $d -and $null -ne $v -and [math]::Abs($d - [double]$v) -lt 0.006)
        if (-not $ok) { $bad += "$($names[$i]): visual=$v dax=$d" }
    }
    "{0,-18} {1}/{2} match" -f $sc.name, ($names.Count - $bad.Count), $names.Count
    $bad | ForEach-Object { "   MISMATCH $_" }
    $failures += $bad.Count
}
if ($failures) { exit 1 }
