# Profiles the Mission Control dataset (read-only): keys, foreign keys, nulls, dates, reconciliations, planted anomalies.
# Run: powershell -ExecutionPolicy Bypass -File exercice3\tools\profile.ps1
$data = Join-Path (Split-Path $PSScriptRoot -Parent) 'Mission_Control_Enterprise'
$inv = [Globalization.CultureInfo]::InvariantCulture
function N($v) { $d = 0.0; if ([double]::TryParse([string]$v, [Globalization.NumberStyles]::Float, $inv, [ref]$d)) { $d } else { $null } }
$T = @{}; Get-ChildItem $data -Filter *.csv | ForEach-Object { $T[$_.BaseName] = @(Import-Csv $_.FullName -Encoding UTF8) }

"### Primary keys and empty cells"
$pk = @{ dim_date = 'date_key' }
foreach ($n in ($T.Keys | Sort-Object)) {
    $rows = $T[$n]; $cols = $rows[0].PSObject.Properties.Name
    $key = if ($pk[$n]) { $pk[$n] } else { $cols[0] }
    $dup = @($rows | Group-Object $key | Where-Object Count -gt 1).Count
    $blanks = ($cols | ForEach-Object { $c = $_; $b = @($rows | Where-Object { [string]::IsNullOrWhiteSpace($_.$c) }).Count; if ($b) { "$c=$b" } }) -join ' '
    "{0,-26} {1,5} rows  key {2,-24} dup={3}  blanks: {4}" -f $n, $rows.Count, $key, $dup, $blanks
}

"### Foreign keys (orphans; blanks allowed)"
$fk = @(
    @('employees', 'department_id', 'departments', 'department_id'), @('sales_orders', 'customer_id', 'customers', 'customer_id'),
    @('sales_orders', 'sales_owner_id', 'employees', 'employee_id'), @('sales_order_items', 'order_id', 'sales_orders', 'order_id'),
    @('sales_order_items', 'product_id', 'products', 'product_id'), @('payments', 'order_id', 'sales_orders', 'order_id'),
    @('payments', 'customer_id', 'customers', 'customer_id'), @('expenses', 'department_id', 'departments', 'department_id'),
    @('expenses', 'submitted_by_employee_id', 'employees', 'employee_id'), @('inventory_snapshots', 'product_id', 'products', 'product_id'),
    @('inventory_snapshots', 'supplier_id', 'suppliers', 'supplier_id'), @('projects', 'department_id', 'departments', 'department_id'),
    @('projects', 'project_owner_id', 'employees', 'employee_id'), @('tasks', 'project_id', 'projects', 'project_id'),
    @('tasks', 'department_id', 'departments', 'department_id'), @('tasks', 'assignee_employee_id', 'employees', 'employee_id'),
    @('incidents', 'department_id', 'departments', 'department_id'), @('incidents', 'incident_owner_id', 'employees', 'employee_id'),
    @('decisions', 'department_id', 'departments', 'department_id'), @('decisions', 'decision_owner_id', 'employees', 'employee_id'),
    @('kpi_targets', 'department_id', 'departments', 'department_id'), @('customer_interactions', 'customer_id', 'customers', 'customer_id'),
    @('customer_interactions', 'owner_employee_id', 'employees', 'employee_id'), @('activity_log', 'employee_id', 'employees', 'employee_id'),
    @('calendar_events', 'owner_employee_id', 'employees', 'employee_id'), @('calendar_events', 'department_id', 'departments', 'department_id'),
    @('calendar_events', 'related_project_id', 'projects', 'project_id'), @('calendar_events', 'related_task_id', 'tasks', 'task_id'),
    @('missions', 'department_id', 'departments', 'department_id'), @('risk_register', 'department_id', 'departments', 'department_id'),
    @('risk_register', 'risk_owner_employee_id', 'employees', 'employee_id'), @('investigation_cases', 'case_owner_employee_id', 'employees', 'employee_id'),
    @('investigation_cases', 'department_id', 'departments', 'department_id'), @('investigation_evidence', 'case_id', 'investigation_cases', 'case_id'),
    @('notifications', 'recipient_employee_id', 'employees', 'employee_id'), @('collaboration_comments', 'author_employee_id', 'employees', 'employee_id'),
    @('approval_requests', 'requester_employee_id', 'employees', 'employee_id'), @('approval_requests', 'approver_employee_id', 'employees', 'employee_id'),
    @('strategic_goals', 'department_id', 'departments', 'department_id'))
foreach ($f in $fk) {
    $keys = @{}; $T[$f[2]] | ForEach-Object { $keys[$_.($f[3])] = 1 }
    $vals = $T[$f[0]] | ForEach-Object { $_.($f[1]) }
    $orph = @($vals | Where-Object { $_ -and -not $keys.ContainsKey($_) } | Sort-Object -Unique)
    $blank = @($vals | Where-Object { -not $_ }).Count
    if ($orph.Count -or $blank) { "{0,-46} blank={1,-4} orphans={2}" -f "$($f[0]).$($f[1])", $blank, (($orph | Select-Object -First 6) -join ',') }
}
"(foreign keys not listed above are complete and valid)"

"### Orders: grain and reconciliation"
$o = $T.sales_orders; $items = $T.sales_order_items
$lineNet = @{}; $items | ForEach-Object { $lineNet[$_.order_id] = $lineNet[$_.order_id] + (N $_.net_line_amount_tnd) }
"orders {0}; lines {1}; orders without lines {2}" -f $o.Count, $items.Count, @($o | Where-Object { -not $lineNet.ContainsKey($_.order_id) }).Count
"order net = sum(line net): {0} of {1}" -f @($o | Where-Object { [math]::Abs((N $_.net_amount_tnd) - $lineNet[$_.order_id]) -lt 0.05 }).Count, $o.Count
"gross = net + tax: {0} of {1}" -f @($o | Where-Object { [math]::Abs((N $_.net_amount_tnd) + (N $_.tax_amount_tnd) - (N $_.gross_amount_tnd)) -lt 0.05 }).Count, $o.Count
"gross <> net + tax: " + (($o | Where-Object { [math]::Abs((N $_.net_amount_tnd) + (N $_.tax_amount_tnd) - (N $_.gross_amount_tnd)) -ge 0.05 } | ForEach-Object { "$($_.order_id) net=$($_.net_amount_tnd) tax=$($_.tax_amount_tnd) gross=$($_.gross_amount_tnd)" }) -join '; ')
"promised delivery before order date: " + (($o | Where-Object { $_.promised_delivery_date -and $_.promised_delivery_date -lt $_.order_date } | ForEach-Object { "$($_.order_id) order=$($_.order_date) promised=$($_.promised_delivery_date)" }) -join '; ')
$g = @($o | ForEach-Object { N $_.gross_amount_tnd } | Sort-Object); "gross min={0} median={1} p99={2} max={3}" -f $g[0], $g[[int]($g.Count / 2)], $g[[int]($g.Count * 0.99)], $g[-1]
"order status: " + (($o | Group-Object order_status | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ', ')
"order dates: {0} .. {1}" -f ($o.order_date | Sort-Object | Select-Object -First 1), ($o.order_date | Sort-Object | Select-Object -Last 1)
"net total {0:N2} | tax {1:N2} | gross {2:N2}" -f ($o | ForEach-Object { N $_.net_amount_tnd } | Measure-Object -Sum).Sum, ($o | ForEach-Object { N $_.tax_amount_tnd } | Measure-Object -Sum).Sum, ($o | ForEach-Object { N $_.gross_amount_tnd } | Measure-Object -Sum).Sum
"line cost total {0:N2}; units {1}" -f ($items | ForEach-Object { N $_.line_cost_tnd } | Measure-Object -Sum).Sum, ($items | ForEach-Object { [int]$_.quantity } | Measure-Object -Sum).Sum

"### Payments"
"payments per order: " + (($T.payments | Group-Object order_id | Group-Object Count | ForEach-Object { "$($_.Name) payment(s)=$($_.Count) orders" }) -join ', ')
"payment status: " + (($T.payments | Group-Object payment_status | ForEach-Object { "{0}={1} ({2:N0} TND)" -f $_.Name, $_.Count, ($_.Group | ForEach-Object { N $_.amount_tnd } | Measure-Object -Sum).Sum }) -join ', ')
"payment customer <> order customer: " + @($T.payments | Where-Object { $ord = $_.order_id; $oc = ($o | Where-Object order_id -eq $ord).customer_id; $oc -ne $_.customer_id }).Count

"### Status / category distributions"
foreach ($c in @(@('projects', 'project_status'), @('tasks', 'task_status'), @('tasks', 'priority'), @('incidents', 'incident_status'), @('incidents', 'severity'), @('alerts', 'alert_status'), @('alerts', 'severity'), @('risk_register', 'risk_category'), @('risk_register', 'mitigation_status'), @('decisions', 'decision_status'), @('approval_requests', 'approval_status'), @('missions', 'mission_status'), @('customers', 'customer_status'), @('customers', 'region'), @('customers', 'customer_segment'), @('calendar_events', 'event_type'), @('calendar_events', 'event_status'), @('calendar_events', 'recurrence_pattern'), @('inventory_snapshots', 'warehouse'), @('notifications', 'read_status'), @('data_quality_issues', 'issue_type'), @('entity_relationships', 'source_entity_type'), @('departments', 'department_name'))) {
    "{0,-36} {1}" -f "$($c[0]).$($c[1])", (($T[$c[0]] | Group-Object $c[1] | Sort-Object Count -Descending | ForEach-Object { "$(if ($_.Name) { $_.Name } else { '<blank>' })=$($_.Count)" }) -join ', ')
}

"### Date ranges"
foreach ($c in @(@('payments', 'payment_date'), @('expenses', 'expense_date'), @('incidents', 'incident_date'), @('alerts', 'alert_date'), @('tasks', 'due_date'), @('projects', 'planned_end_date'), @('calendar_events', 'start_datetime'), @('activity_log', 'activity_date'), @('inventory_snapshots', 'snapshot_date'), @('customer_interactions', 'interaction_date'), @('kpi_targets', 'month_start'))) {
    $v = @($T[$c[0]] | ForEach-Object { $_.($c[1]) } | Where-Object { $_ } | Sort-Object)
    "{0,-40} {1} .. {2}" -f "$($c[0]).$($c[1])", $v[0], $v[-1]
}
