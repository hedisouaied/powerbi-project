# Profiles the 10 source CSVs in ..\data (read-only) and prints findings.
# Run:  powershell -ExecutionPolicy Bypass -File exercice2\profiling\profile.ps1
$data = Join-Path $PSScriptRoot '..\data'
$inv = [Globalization.CultureInfo]::InvariantCulture
$T = [ordered]@{}
foreach ($n in 'departments','employees','projects','targets','tasks','customers','products','sales_transactions','expenses','leave_requests') {
    $T[$n] = @(Import-Csv (Join-Path $data "$n.csv") -Encoding UTF8)
}
function Num($v) { $d = 0.0; if ([double]::TryParse([string]$v, [Globalization.NumberStyles]::Float, $inv, [ref]$d)) { $d } else { $null } }
function Dt($v) { $d = [datetime]::MinValue; if ([datetime]::TryParseExact([string]$v, 'yyyy-MM-dd', $inv, 'None', [ref]$d)) { $d } else { $null } }
function Head($s) { ""; "### $s" }

Head 'Row counts and column profile (blank = empty string or null)'
foreach ($n in $T.Keys) {
    $rows = $T[$n]; $cols = $rows[0].PSObject.Properties.Name
    "{0}: {1} rows, {2} columns" -f $n, $rows.Count, $cols.Count
    foreach ($c in $cols) {
        $vals = $rows | ForEach-Object { $_.$c }
        $blank = @($vals | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count
        $distinct = @($vals | Sort-Object -Unique).Count
        $ws = @($vals | Where-Object { $_ -and ($_ -ne $_.Trim() -or $_ -match '  ') }).Count
        $flag = @(); if ($blank) { $flag += "BLANK=$blank" }; if ($ws) { $flag += "WHITESPACE=$ws" }
        "    {0,-20} distinct={1,-4} {2}" -f $c, $distinct, ($flag -join ' ')
    }
}

Head 'Primary key duplicates'
$pk = @{ departments='department_id'; employees='employee_id'; projects='project_id'; targets='target_id'; tasks='task_id'; customers='customer_id'; products='product_id'; sales_transactions='transaction_id'; expenses='expense_id'; leave_requests='leave_id' }
foreach ($n in $pk.Keys) { $d = $T[$n] | Group-Object $pk[$n] | Where-Object Count -gt 1; "{0,-20} {1}: {2}" -f $n, $pk[$n], $(if ($d) { 'DUPLICATES ' + ($d.Name -join ',') } else { 'unique' }) }
"Full-row duplicates (ignoring PK):"
foreach ($n in $pk.Keys) { $cols = $T[$n][0].PSObject.Properties.Name | Where-Object { $_ -ne $pk[$n] }; $d = $T[$n] | Group-Object { $r = $_; ($cols | ForEach-Object { $r.$_ }) -join '|' } | Where-Object Count -gt 1; if ($d) { "  {0}: {1} groups -> {2}" -f $n, @($d).Count, (($d | ForEach-Object { ($_.Group.($pk[$n])) -join '=' }) -join '; ') } }
$e = $T.employees | Group-Object email | Where-Object Count -gt 1; "Duplicate employee emails: " + $(if ($e) { ($e | ForEach-Object { "$($_.Name) ($($_.Group.employee_id -join ','))" }) -join '; ' } else { 'none' })
$bad = $T.employees | Where-Object { $_.email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$' }; "Invalid email format: " + $(if ($bad) { ($bad | ForEach-Object { "$($_.employee_id)='$($_.email)'" }) -join '; ' } else { 'none' })

Head 'Foreign key integrity (orphans; blanks reported separately)'
$fks = @(
    @('employees','department_id','departments','department_id'), @('projects','department_id','departments','department_id'),
    @('projects','project_manager_id','employees','employee_id'), @('targets','employee_id','employees','employee_id'),
    @('tasks','assignee_id','employees','employee_id'), @('tasks','project_id','projects','project_id'),
    @('sales_transactions','customer_id','customers','customer_id'), @('sales_transactions','product_id','products','product_id'),
    @('sales_transactions','seller_id','employees','employee_id'), @('expenses','department_id','departments','department_id'),
    @('expenses','project_id','projects','project_id'), @('leave_requests','employee_id','employees','employee_id'))
foreach ($f in $fks) {
    $keys = @{}; $T[$f[2]] | ForEach-Object { $keys[$_.($f[3])] = 1 }
    $vals = $T[$f[0]] | ForEach-Object { $_.($f[1]) }
    $blank = @($vals | Where-Object { [string]::IsNullOrWhiteSpace($_) }).Count
    $orph = @($vals | Where-Object { $_ -and -not $keys.ContainsKey($_) } | Sort-Object -Unique)
    "{0,-34} -> {1,-24} blank={2,-3} orphans={3}" -f "$($f[0]).$($f[1])", "$($f[2]).$($f[3])", $blank, $(if ($orph) { $orph -join ',' } else { 'none' })
}

Head 'Role checks (employees in several roles)'
$dept = @{}; $T.departments | ForEach-Object { $dept[$_.department_id] = $_.department_name }
$emp = @{}; $T.employees | ForEach-Object { $emp[$_.employee_id] = $_ }
foreach ($role in @(@('sales_transactions','seller_id','Sellers'), @('targets','employee_id','Target owners'), @('projects','project_manager_id','Project managers'), @('tasks','assignee_id','Task assignees'), @('leave_requests','employee_id','Leave requesters'))) {
    $ids = @($T[$role[0]] | ForEach-Object { $_.($role[1]) } | Where-Object { $_ } | Sort-Object -Unique)
    $byDept = $ids | Where-Object { $emp[$_] } | Group-Object { $dept[$emp[$_].department_id] } | ForEach-Object { "$($_.Name)=$($_.Count)" }
    "{0,-18} {1,3} distinct employees; by department: {2}" -f $role[2], $ids.Count, ($byDept -join ', ')
}
$sellers = @($T.sales_transactions.seller_id | Sort-Object -Unique); $tgt = @($T.targets.employee_id | Sort-Object -Unique)
"Sellers without targets: " + (@($sellers | Where-Object { $_ -notin $tgt }) -join ',')
"Target owners without sales: " + (@($tgt | Where-Object { $_ -notin $sellers }) -join ',')
"Sellers not in Sales department: " + (@($sellers | Where-Object { $emp[$_] -and $dept[$emp[$_].department_id] -ne 'Sales' } | ForEach-Object { "$_($($dept[$emp[$_].department_id]))" }) -join ',')
"Sellers/managers/assignees with status Terminated/Inactive: " + (@(($sellers + $T.projects.project_manager_id + $T.tasks.assignee_id) | Sort-Object -Unique | Where-Object { $emp[$_] -and $emp[$_].employment_status -notin 'Active','On Leave' } | ForEach-Object { "$_($($emp[$_].employment_status))" }) -join ',')
$pm = $T.projects | Where-Object { $emp[$_.project_manager_id] -and $emp[$_.project_manager_id].department_id -ne $_.department_id }; "Projects whose manager is in another department: $(@($pm).Count) of $($T.projects.Count)"

Head 'Date ranges and parse failures'
$dcols = @(@('employees','hire_date'), @('projects','start_date'), @('projects','deadline'), @('targets','target_month'), @('tasks','created_date'), @('tasks','due_date'), @('sales_transactions','transaction_date'), @('expenses','expense_date'), @('leave_requests','start_date'), @('leave_requests','end_date'))
$all = @()
foreach ($d in $dcols) {
    $vals = $T[$d[0]] | ForEach-Object { $_.($d[1]) } | Where-Object { $_ }
    $p = @($vals | ForEach-Object { Dt $_ } | Where-Object { $_ }); $all += $p
    $fail = @($vals | Where-Object { -not (Dt $_) })
    "{0,-30} {1:yyyy-MM-dd} .. {2:yyyy-MM-dd}  unparsed={3}" -f "$($d[0]).$($d[1])", ($p | Measure-Object -Minimum).Minimum, ($p | Measure-Object -Maximum).Maximum, $(if ($fail) { $fail -join ',' } else { 0 })
}
"All dates span {0:yyyy-MM-dd} .. {1:yyyy-MM-dd}" -f ($all | Measure-Object -Minimum).Minimum, ($all | Measure-Object -Maximum).Maximum
"target_month not first of month: " + @($T.targets | Where-Object { (Dt $_.target_month).Day -ne 1 }).Count
$tm = $T.targets | Group-Object employee_id, target_month | Where-Object Count -gt 1; "Duplicate seller+month targets: " + @($tm).Count
"Targets per seller: " + (($T.targets | Group-Object employee_id | ForEach-Object { $_.Count } | Sort-Object -Unique) -join ',') + " months; months: " + (($T.targets.target_month | Sort-Object -Unique) -join ',')
"Sales by month: " + (($T.sales_transactions | Group-Object { $_.transaction_date.Substring(0,7) } | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ')

Head 'Date logic'
"projects deadline < start: " + (@($T.projects | Where-Object { (Dt $_.deadline) -lt (Dt $_.start_date) } | ForEach-Object project_id) -join ',')
"tasks due < created: " + (@($T.tasks | Where-Object { (Dt $_.due_date) -lt (Dt $_.created_date) } | ForEach-Object task_id) -join ',')
"leave end < start: " + (@($T.leave_requests | Where-Object { (Dt $_.end_date) -lt (Dt $_.start_date) } | ForEach-Object leave_id) -join ',')
$lv = foreach ($l in $T.leave_requests) { $s = Dt $l.start_date; $e2 = Dt $l.end_date; $cal = ($e2 - $s).Days + 1; $wd = 0; for ($x = $s; $x -le $e2; $x = $x.AddDays(1)) { if ($x.DayOfWeek -notin 'Saturday','Sunday') { $wd++ } }; [pscustomobject]@{ id=$l.leave_id; wd=[int]$l.working_days; cal=$cal; monfri=$wd } }
"leave working_days = calendar days: $(@($lv | Where-Object { $_.wd -eq $_.cal }).Count); = Mon-Fri days: $(@($lv | Where-Object { $_.wd -eq $_.monfri }).Count); neither: " + (@($lv | Where-Object { $_.wd -ne $_.cal -and $_.wd -ne $_.monfri } | ForEach-Object { "$($_.id)(wd=$($_.wd),cal=$($_.cal),monfri=$($_.monfri))" }) -join ',')
$ov = foreach ($g in ($T.leave_requests | Where-Object request_status -ne 'Rejected' | Group-Object employee_id)) { $r = @($g.Group | Sort-Object start_date); for ($i = 1; $i -lt $r.Count; $i++) { if ((Dt $r[$i].start_date) -le (Dt $r[$i-1].end_date)) { "$($r[$i-1].leave_id)/$($r[$i].leave_id)" } } }
"overlapping non-rejected leave of same employee: " + ($ov -join ',')
"tasks created before project start: " + @($T.tasks | Where-Object { $p = $T.projects | Where-Object project_id -eq $_.project_id; $p -and (Dt $_.created_date) -lt (Dt $p.start_date) }).Count + " of $($T.tasks.Count)"
"tasks due after project deadline: " + @($T.tasks | Where-Object { $p = $T.projects | Where-Object project_id -eq $_.project_id; $p -and (Dt $_.due_date) -gt (Dt $p.deadline) }).Count
"sales before seller hire_date: " + (@($T.sales_transactions | Where-Object { $emp[$_.seller_id] -and (Dt $_.transaction_date) -lt (Dt $emp[$_.seller_id].hire_date) } | ForEach-Object transaction_id) -join ',')
"expenses with project outside project dates: " + @($T.expenses | Where-Object { $_.project_id } | Where-Object { $id = $_.project_id; $p = $T.projects | Where-Object project_id -eq $id; $p -and ((Dt $_.expense_date) -lt (Dt $p.start_date) -or (Dt $_.expense_date) -gt (Dt $p.deadline)) }).Count
"expenses whose department differs from its project's department: " + @($T.expenses | Where-Object { $_.project_id } | Where-Object { $id = $_.project_id; $p = $T.projects | Where-Object project_id -eq $id; $p -and $p.department_id -ne $_.department_id }).Count

Head 'Category / status distributions'
foreach ($c in @(@('employees','employment_status'), @('employees','city'), @('employees','job_title'), @('departments','department_name'), @('customers','customer_segment'), @('customers','city'), @('products','category'), @('sales_transactions','payment_status'), @('sales_transactions','sales_region'), @('sales_transactions','discount_pct'), @('projects','project_status'), @('projects','priority'), @('tasks','task_status'), @('tasks','priority'), @('tasks','source'), @('expenses','expense_category'), @('expenses','approval_status'), @('leave_requests','leave_type'), @('leave_requests','request_status'), @('leave_requests','comment'))) {
    "{0,-36} {1}" -f "$($c[0]).$($c[1])", (($T[$c[0]] | Group-Object $c[1] | Sort-Object Count -Descending | ForEach-Object { "$(if ($_.Name) { $_.Name } else { '<blank>' })=$($_.Count)" }) -join ', ')
}
"Departments: " + (($T.departments | ForEach-Object { "$($_.department_id) $($_.department_name) [$($_.division), $($_.base_city)]" }) -join '; ')
"Products: " + (($T.products | ForEach-Object { "$($_.product_id) $($_.product_name) [$($_.category)] $($_.list_price_tnd)" }) -join '; ')

Head 'Numeric ranges and IQR outliers (beyond Q3 + 1.5 IQR or below Q1 - 1.5 IQR)'
foreach ($c in @(@('employees','monthly_salary_tnd','employee_id'), @('projects','budget_tnd','project_id'), @('projects','actual_cost_tnd','project_id'), @('targets','target_amount_tnd','target_id'), @('targets','actual_sales_tnd','target_id'), @('targets','achievement_pct','target_id'), @('sales_transactions','quantity','transaction_id'), @('sales_transactions','unit_price_tnd','transaction_id'), @('sales_transactions','revenue_tnd','transaction_id'), @('sales_transactions','cost_tnd','transaction_id'), @('sales_transactions','profit_tnd','transaction_id'), @('expenses','amount_tnd','expense_id'), @('leave_requests','working_days','leave_id'))) {
    $rows = $T[$c[0]]; $v = @($rows | ForEach-Object { Num $_.($c[1]) } | Where-Object { $null -ne $_ } | Sort-Object)
    $q = { param($p) $i = ($v.Count - 1) * $p; $lo = [math]::Floor($i); $hi = [math]::Ceiling($i); $v[$lo] + ($v[$hi] - $v[$lo]) * ($i - $lo) }
    $q1 = & $q 0.25; $q3 = & $q 0.75; $iqr = $q3 - $q1; $lo = $q1 - 1.5 * $iqr; $hi = $q3 + 1.5 * $iqr
    $out = @($rows | Where-Object { $x = Num $_.($c[1]); $null -ne $x -and ($x -gt $hi -or $x -lt $lo) } | ForEach-Object { "$($_.($c[2]))=$($_.($c[1]))" })
    $sum = ($v | Measure-Object -Sum).Sum
    "{0,-36} min={1} median={2} max={3} sum={4:N2} neg={5} zero={6} outliers={7} {8}" -f "$($c[0]).$($c[1])", $v[0], (& $q 0.5), $v[-1], $sum, @($v | Where-Object { $_ -lt 0 }).Count, @($v | Where-Object { $_ -eq 0 }).Count, $out.Count, $(if ($out.Count -le 12) { $out -join ',' } else { ($out[0..11] -join ',') + ',...' })
}

Head 'Arithmetic consistency'
$pr = @{}; $T.products | ForEach-Object { $pr[$_.product_id] = Num $_.list_price_tnd }
$s = $T.sales_transactions
$r1 = @($s | Where-Object { [math]::Abs((Num $_.quantity) * (Num $_.unit_price_tnd) * (1 - (Num $_.discount_pct) / 100) - (Num $_.revenue_tnd)) -gt 0.05 })
$r1b = @($s | Where-Object { [math]::Abs((Num $_.quantity) * (Num $_.unit_price_tnd) * (1 - (Num $_.discount_pct)) - (Num $_.revenue_tnd)) -gt 0.05 })
"revenue <> qty*price*(1-disc/100): $($r1.Count) ; revenue <> qty*price*(1-disc) (disc as fraction): $($r1b.Count)"
if ($r1.Count -and $r1.Count -le 10) { "   " + (($r1 | ForEach-Object { "$($_.transaction_id) q=$($_.quantity) p=$($_.unit_price_tnd) d=$($_.discount_pct) rev=$($_.revenue_tnd)" }) -join '; ') }
"profit <> revenue - cost: " + (@($s | Where-Object { [math]::Abs((Num $_.revenue_tnd) - (Num $_.cost_tnd) - (Num $_.profit_tnd)) -gt 0.05 } | ForEach-Object transaction_id) -join ',')
$ratio = @($s | ForEach-Object { (Num $_.unit_price_tnd) / $pr[$_.product_id] }); "unit_price / list_price: min={0:N3} max={1:N3}" -f ($ratio | Measure-Object -Minimum).Minimum, ($ratio | Measure-Object -Maximum).Maximum
"loss-making transactions (profit<0): " + @($s | Where-Object { (Num $_.profit_tnd) -lt 0 }).Count
"cost/revenue ratio range: {0:N3} .. {1:N3}" -f (($s | ForEach-Object { (Num $_.cost_tnd) / (Num $_.revenue_tnd) }) | Measure-Object -Minimum -Maximum).Minimum, (($s | ForEach-Object { (Num $_.cost_tnd) / (Num $_.revenue_tnd) }) | Measure-Object -Maximum).Maximum
"achievement_pct <> round(actual/target*100,1): " + (@($T.targets | Where-Object { [math]::Abs([math]::Round((Num $_.actual_sales_tnd) / (Num $_.target_amount_tnd) * 100, 1) - (Num $_.achievement_pct)) -gt 0.051 } | ForEach-Object target_id) -join ',')
"projects over budget: " + (@($T.projects | Where-Object { (Num $_.actual_cost_tnd) -gt (Num $_.budget_tnd) } | ForEach-Object { "$($_.project_id)($([math]::Round((Num $_.actual_cost_tnd)/(Num $_.budget_tnd)*100))% $($_.project_status))" }) -join ', ')
"Completed projects with cost < 50% budget: " + (@($T.projects | Where-Object { $_.project_status -eq 'Completed' -and (Num $_.actual_cost_tnd) -lt 0.5 * (Num $_.budget_tnd) } | ForEach-Object project_id) -join ',')
"Not Started projects with cost > 0: " + (@($T.projects | Where-Object { $_.project_status -match 'Not Started|Planned' -and (Num $_.actual_cost_tnd) -gt 0 } | ForEach-Object { "$($_.project_id)=$($_.actual_cost_tnd)" }) -join ',')
"Project expenses vs project actual_cost: " + (($T.projects | ForEach-Object { $id = $_.project_id; $ex = ($T.expenses | Where-Object project_id -eq $id | ForEach-Object { Num $_.amount_tnd } | Measure-Object -Sum).Sum; "$id exp=$([math]::Round($ex)) cost=$($_.actual_cost_tnd)" }) -join '; ')

Head 'Targets vs transactions (seller x month)'
$txm = @{}; foreach ($x in $s) { $k = "$($x.seller_id)|$($x.transaction_date.Substring(0,7))"; $txm[$k] = $txm[$k] + (Num $x.revenue_tnd) }
$cmp = foreach ($tg in $T.targets) { $k = "$($tg.employee_id)|$($tg.target_month.Substring(0,7))"; [pscustomobject]@{ k=$k; actual=(Num $tg.actual_sales_tnd); tx=[math]::Round([double]$txm[$k],2) } }
"Target rows: $($cmp.Count); sum actual_sales_tnd={0:N2}; sum transaction revenue for same seller-months={1:N2}" -f ($cmp | Measure-Object actual -Sum).Sum, ($cmp | Measure-Object tx -Sum).Sum
"Transaction revenue total={0:N2}; profit={1:N2}" -f ($s | ForEach-Object { Num $_.revenue_tnd } | Measure-Object -Sum).Sum, ($s | ForEach-Object { Num $_.profit_tnd } | Measure-Object -Sum).Sum
"Revenue by payment status: " + (($s | Group-Object payment_status | ForEach-Object { "{0}={1:N2}" -f $_.Name, ($_.Group | ForEach-Object { Num $_.revenue_tnd } | Measure-Object -Sum).Sum }) -join '; ')
"Expenses by approval: " + (($T.expenses | Group-Object approval_status | ForEach-Object { "{0}={1:N2}" -f $_.Name, ($_.Group | ForEach-Object { Num $_.amount_tnd } | Measure-Object -Sum).Sum }) -join '; ')
"Customers with no sales: " + @($T.customers | Where-Object { $_.customer_id -notin $s.customer_id }).Count + "; employees with no role at all: " + (@($T.employees.employee_id | Where-Object { $_ -notin ($s.seller_id + $T.targets.employee_id + $T.projects.project_manager_id + $T.tasks.assignee_id) }).Count)
$cm = @{}; $T.customers | ForEach-Object { $cm[$_.customer_id] = $_ }
"sales_region = customer city: " + @($s | Where-Object { $cm[$_.customer_id].city -eq $_.sales_region }).Count + " of $($s.Count); = seller city: " + @($s | Where-Object { $emp[$_.seller_id].city -eq $_.sales_region }).Count
$lastDate = ($s | ForEach-Object { Dt $_.transaction_date } | Measure-Object -Maximum).Maximum
"Open tasks (status <> Done): " + @($T.tasks | Where-Object task_status -ne 'Done').Count + "; of which due before last data date {0:yyyy-MM-dd}: " -f $lastDate + @($T.tasks | Where-Object { $_.task_status -ne 'Done' -and (Dt $_.due_date) -lt $lastDate }).Count
"Projects past deadline (before {0:yyyy-MM-dd}) and not Completed: " -f $lastDate + (@($T.projects | Where-Object { (Dt $_.deadline) -lt $lastDate -and $_.project_status -ne 'Completed' } | ForEach-Object { "$($_.project_id)($($_.project_status))" }) -join ',')
"Planned projects with actual_cost 0: " + (@($T.projects | Where-Object { $_.project_status -eq 'Planned' } | ForEach-Object { "$($_.project_id)=$($_.actual_cost_tnd)" }) -join ',')

Head 'Number precision (values with more than 2 decimals, stored as floating point in the workbook)'
foreach ($n in $T.Keys) { foreach ($col in ($T[$n][0].PSObject.Properties.Name | Where-Object { $_ -match '_tnd$' })) { $k = @($T[$n] | Where-Object { $_.$col -match '\.\d{3,}$' }); if ($k) { "{0,-36} {1} values, e.g. {2}" -f "$n.$col", $k.Count, (($k | Select-Object -First 3 | ForEach-Object { $_.$col }) -join ', ') } } }
