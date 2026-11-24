# Generates the Power BI project MissionControl.pbip from the CSV pack:
#   - one Power Query per CSV (types inferred from the data, "en-US" culture) -> powerquery\*.pq and the TMDL partitions
#   - dim_date marked as the date table, the 'Revenue Shock' what-if table
#   - the star-schema relationships (single direction, no ambiguous path)
#   - _Measures from dax\measures.dax + one JSON feed measure per table for the Mission Control visual
# Run with Power BI Desktop closed:  powershell -ExecutionPolicy Bypass -File exercice3\tools\build-pbip.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$data = Join-Path $root 'Mission_Control_Enterprise'
$utf8 = New-Object System.Text.UTF8Encoding($false)
$inv = [Globalization.CultureInfo]::InvariantCulture
function Save([string]$path, [string]$text) { New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $text.Replace("`r`n", "`n"), $utf8) }
function Guid([string]$seed) { $md5 = [Security.Cryptography.MD5]::Create(); $b = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes("MC|$seed")); $b[7] = ($b[7] -band 0x0F) -bor 0x40; $b[8] = ($b[8] -band 0x3F) -bor 0x80; ([guid]::new($b)).ToString() }
function Q([string]$name) { if ($name -match '^[A-Za-z_][A-Za-z0-9_]*$') { $name } else { "'$($name.Replace("'", "''"))'" } }

# ---------- 1. infer column types from the data ----------
# S text, D date, T datetime, I whole number, N decimal, C money (TND), P fraction/percent, B true/false
function Infer([string]$col, [string[]]$vals) {
    $v = @($vals | Where-Object { $_ -ne '' -and $null -ne $_ })
    if (-not $v.Count) { return 'S' }
    if ($col -like '*_id' -or $col -eq 'date_key' -and $false) { return 'S' }
    if (@($v | Where-Object { $_ -notmatch '^(True|False)$' }).Count -eq 0) { return 'B' }
    if (@($v | Where-Object { $_ -notmatch '^\d{4}-\d{2}-\d{2}$' }).Count -eq 0) { return 'D' }
    if (@($v | Where-Object { $_ -notmatch '^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$' }).Count -eq 0) { return 'T' }
    if (@($v | Where-Object { $_ -notmatch '^-?\d+$' }).Count -eq 0) { return $(if ($col -like '*_id' -or $col -like '*code*') { 'S' } else { 'I' }) }
    if (@($v | Where-Object { $_ -notmatch '^-?\d+(\.\d+)?([eE]-?\d+)?$' }).Count -eq 0) {
        if ($col -like '*_tnd') { return 'C' }
        if ($col -match 'pct|percent|rate|score|strength' -and $col -ne 'incident_rate_target_pct') { return 'P' }
        return 'N'
    }
    'S'
}
$type = @{
    S = @('string', $null, 'type text'); D = @('dateTime', 'yyyy-mm-dd', 'type date'); T = @('dateTime', 'yyyy-mm-dd hh:nn', 'type datetime')
    I = @('int64', '#,0', 'Int64.Type'); N = @('double', '#,0.##', 'type number'); C = @('decimal', '#,0.00" TND"', 'Currency.Type')
    P = @('double', '0.0%', 'type number'); B = @('boolean', $null, 'type logical')
}
$tables = [ordered]@{}
foreach ($f in (Get-ChildItem $data -Filter *.csv | Sort-Object Name)) {
    $rows = @(Import-Csv $f.FullName -Encoding UTF8)
    $cols = [ordered]@{}
    foreach ($c in $rows[0].PSObject.Properties.Name) { $cols[$c] = Infer $c ($rows | ForEach-Object { $_.$c }) }
    $tables[$f.BaseName] = @{ cols = $cols; rows = $rows.Count; key = @($cols.Keys)[0] }
}
$tables['dim_date'].key = 'date'
$tables['dim_date'].cols['date_key'] = 'I'

# ---------- 2. Power Query ----------
$fnClean = @'
(source as table) as table =>
    Table.TransformColumns(
        source,
        List.Transform(
            Table.ColumnNames(source),
            (col) => {
                col,
                (v) => (let t = if v = null then null else Text.Trim(Text.Clean(v)) in if t = "" then null else t),
                type nullable text
            }
        )
    )
'@
Save "$root\powerquery\00_fnCleanText.pq" "// Query name: fnCleanText (function, not loaded)`n$fnClean"
function MCode([string]$name) {
    $t = $tables[$name]
    $pairs = ($t.cols.Keys | ForEach-Object { "{`"$_`", $($type[$t.cols[$_]][2])}" }) -join ', '
    $extra = ''
    $last = 'Typed'
    if ($name -eq 'calendar_events') { $extra = "`n    EventDate = Table.AddColumn(Typed, `"event_date`", each Date.From([start_datetime]), type date),"; $last = 'EventDate' }
    if ($name -eq 'dim_date') { $extra = "`n    YearMonth = Table.AddColumn(Typed, `"year_month`", each [year] * 100 + [month_number], Int64.Type),"; $last = 'YearMonth' }
    @"
let
    Source = Csv.Document(File.Contents(DataFolder & "\$name.csv"), [Delimiter = ",", Columns = $($t.cols.Count), Encoding = 65001, QuoteStyle = QuoteStyle.Csv]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),
    Cleaned = fnCleanText(Promoted),
    Typed = Table.TransformColumnTypes(Cleaned, {$pairs}, "en-US"),$extra
    Result = $last
in
    Result
"@
}
$i = 0
foreach ($name in $tables.Keys) { $i++; Save ("$root\powerquery\{0:D2}_$name.pq" -f $i) ("// Query name: $name`n" + (MCode $name)) }

# ---------- 3. TMDL tables ----------
$sm = Join-Path $root 'MissionControl.SemanticModel'
if (Test-Path "$sm\definition") { Remove-Item "$sm\definition" -Recurse -Force }
$hidden = @('employees.monthly_salary_tnd')
$sortBy = @{ 'dim_date.month_year' = 'year_month'; 'dim_date.month_name' = 'month_number' }
$summable = '_tnd$|quantity|quantity_on_hand|resolution_hours'
foreach ($name in $tables.Keys) {
    $t = $tables[$name]
    $colDefs = @($t.cols.Keys | ForEach-Object { @{ n = $_; t = $t.cols[$_] } })
    if ($name -eq 'calendar_events') { $colDefs += @{ n = 'event_date'; t = 'D' } }
    if ($name -eq 'dim_date') { $colDefs += @{ n = 'year_month'; t = 'I' } }
    $cols = foreach ($c in $colDefs) {
        $dt, $fmt = $type[$c.t]
        $l = @("`tcolumn $(Q $c.n)", "`t`tdataType: $dt")
        if ($fmt) { $l += "`t`tformatString: $fmt" }
        if ($c.n -eq $t.key) { $l += "`t`tisKey" }
        if ("$name.$($c.n)" -in $hidden) { $l += "`t`tisHidden" }
        $agg = if ($c.n -match $summable -and $c.t -in 'C', 'I', 'N') { 'sum' } else { 'none' }
        $l += "`t`tlineageTag: $(Guid "$name.$($c.n)")", "`t`tsummarizeBy: $agg", "`t`tsourceColumn: $($c.n)"
        if ($sortBy["$name.$($c.n)"]) { $l += "`t`tsortByColumn: $($sortBy["$name.$($c.n)"])" }
        $l += '', "`t`tannotation SummarizationSetBy = Automatic"
        if ($c.t -eq 'D') { $l += '', "`t`tannotation UnderlyingDateTimeDataType = Date" }
        $l -join "`n"
    }
    $m = ((MCode $name).Trim() -split "`n" | ForEach-Object { "`t`t`t`t$_" }) -join "`n"
    $head = "table $name`n`tlineageTag: $(Guid $name)`n"
    if ($name -eq 'dim_date') { $head += "`tdataCategory: Time`n" }
    Save "$sm\definition\tables\$name.tmdl" ($head + "`n" + ($cols -join "`n`n") + "`n`n`tpartition $name = m`n`t`tmode: import`n`t`tsource =`n$m`n`n`tannotation PBI_ResultType = Table`n")
}

# What-if parameter table (DAX GENERATESERIES): revenue shock -40% .. +40%
Save "$sm\definition\tables\Revenue Shock.tmdl" @"
table 'Revenue Shock'
	lineageTag: $(Guid 'Revenue Shock')

	column 'Revenue Shock'
		dataType: double
		formatString: +0%;-0%;0%
		lineageTag: $(Guid 'Revenue Shock.col')
		summarizeBy: none
		sourceColumn: [Value]

		annotation SummarizationSetBy = Automatic

	partition 'Revenue Shock' = calculated
		mode: import
		source = GENERATESERIES(-0.4, 0.4, 0.05)

	annotation PBI_Id = $(Guid 'Revenue Shock.id')
"@

# ---------- 4. measures: catalogue + JSON feeds ----------
. (Join-Path $PSScriptRoot 'measures.ps1')
$script:measureFile = Join-Path $root 'dax\measures.dax'
$catalogue = @(Get-Measures)
# Feed columns per table (all columns unless listed; salary never sent to the visual).
$feedDrop = @{ employees = @('monthly_salary_tnd'); sales_order_items = @('order_line_id'); payments = @('customer_id'); inventory_snapshots = @('inventory_snapshot_id'); kpi_targets = @('target_id'); calendar_events = @('data_origin'); expenses = @('reference_code') }
$feedSkip = @('dim_date')
function FeedValue([string]$tbl, [string]$col, [string]$t) {
    $ref = "$(Q $tbl)[$col]"
    switch ($t) {
        'S' { "IF ( ISBLANK ( $ref ), `"null`", `"`"`"`" & SUBSTITUTE ( SUBSTITUTE ( $ref, `"\`", `"\\`" ), `"`"`"`", `"\`"`"`" ) & `"`"`"`" )" }
        'D' { "IF ( ISBLANK ( $ref ), `"null`", `"`"`"`" & FORMAT ( $ref, `"yyyy-mm-dd`", `"en-US`" ) & `"`"`"`" )" }
        'T' { "IF ( ISBLANK ( $ref ), `"null`", `"`"`"`" & FORMAT ( $ref, `"yyyy-mm-dd hh:nn`", `"en-US`" ) & `"`"`"`" )" }
        'B' { "IF ( $ref, `"true`", `"false`" )" }
        # FORMAT(5, "0.####") gives "5." (trailing dot) which JSON.parse rejects: strip it.
        default { "IF ( ISBLANK ( $ref ), `"null`", VAR _s = FORMAT ( $ref, `"0.####`", `"en-US`" ) RETURN IF ( RIGHT ( _s, 1 ) = `".`", LEFT ( _s, LEN ( _s ) - 1 ), _s ) )" }
    }
}
$feeds = [ordered]@{}
foreach ($name in $tables.Keys) {
    if ($name -in $feedSkip) { continue }
    $t = $tables[$name]
    $cols = @($t.cols.Keys | Where-Object { $_ -notin $feedDrop[$name] })
    $header = ($cols | ForEach-Object { "\`"`"$_\`"`"" }) -join ','
    $header = ($cols | ForEach-Object { '""' + $_ + '""' }) -join ','
    $row = ($cols | ForEach-Object { FeedValue $name $_ $t.cols[$_] }) -join " & `",`" & "
    $sortCol = $t.key
    $expr = "`"{`"`"c`"`":[$header],`"`"r`"`":[`" & CONCATENATEX ( $(Q $name), `"[`" & $row & `"]`", `",`", $(Q $name)[$sortCol], ASC ) & `"]}`""
    $feeds[$name] = $expr
}
$feedMeasures = foreach ($name in $feeds.Keys) {
    [pscustomobject]@{ Name = "Feed $name"; Format = 'General'; Folder = '99 Visual Feeds'; Description = "Columnar JSON feed of $name for the Mission Control visual ({c: columns, r: rows}). Generated."; Expression = $feeds[$name] }
}
$all = @($catalogue) + @($feedMeasures)
$measureText = foreach ($ms in $all) {
    $expr = ($ms.Expression -split "`n" | ForEach-Object { if ($_.Trim()) { "`t`t`t$_" } }) -join "`n"
    "`t/// $($ms.Description)`n`tmeasure $(Q $ms.Name) =`n$expr`n`t`tformatString: $($ms.Format)`n`t`tdisplayFolder: $($ms.Folder)`n`t`tlineageTag: $(Guid "measure.$($ms.Name)")"
}
Save "$sm\definition\tables\_Measures.tmdl" ("table _Measures`n`tlineageTag: $(Guid '_Measures')`n`n" + ($measureText -join "`n`n") + @"


	column Value
		dataType: int64
		isHidden
		lineageTag: $(Guid '_Measures.Value')
		summarizeBy: none
		isNameInferred
		sourceColumn: [Value]

		annotation SummarizationSetBy = Automatic

	partition _Measures = calculated
		mode: import
		source = ROW("Value", 0)
"@)
# Feed list for the visual's capabilities / report generator
Save "$root\tools\feeds.json" (ConvertTo-Json -InputObject @($feeds.Keys) -Compress)

# ---------- 5. relationships (from many-side column, to one-side column, active) ----------
$rel = @(
    # sales
    @('sales_orders.customer_id', 'customers.customer_id', 1), @('sales_orders.sales_owner_id', 'employees.employee_id', 1),
    @('sales_orders.order_date', 'dim_date.date', 1), @('sales_orders.promised_delivery_date', 'dim_date.date', 0),
    @('sales_order_items.order_id', 'sales_orders.order_id', 1), @('sales_order_items.product_id', 'products.product_id', 1),
    @('payments.order_id', 'sales_orders.order_id', 1), @('payments.customer_id', 'customers.customer_id', 0),
    @('payments.payment_date', 'dim_date.date', 0), @('payments.settlement_date', 'dim_date.date', 0),
    # spend & inventory
    @('expenses.department_id', 'departments.department_id', 1), @('expenses.submitted_by_employee_id', 'employees.employee_id', 1), @('expenses.expense_date', 'dim_date.date', 1),
    @('inventory_snapshots.product_id', 'products.product_id', 1), @('inventory_snapshots.supplier_id', 'suppliers.supplier_id', 1), @('inventory_snapshots.snapshot_date', 'dim_date.date', 1),
    # people (employees -> departments inactive: departments relate to the facts directly, so no second path)
    @('employees.department_id', 'departments.department_id', 0),
    # projects & tasks (tasks reach projects; their own department and project owner are inactive)
    @('projects.department_id', 'departments.department_id', 1), @('projects.project_owner_id', 'employees.employee_id', 0), @('projects.start_date', 'dim_date.date', 0), @('projects.planned_end_date', 'dim_date.date', 0),
    @('tasks.project_id', 'projects.project_id', 1), @('tasks.department_id', 'departments.department_id', 0), @('tasks.assignee_employee_id', 'employees.employee_id', 1),
    @('tasks.due_date', 'dim_date.date', 1), @('tasks.created_date', 'dim_date.date', 0),
    # operations
    @('incidents.department_id', 'departments.department_id', 1), @('incidents.incident_owner_id', 'employees.employee_id', 1), @('incidents.incident_date', 'dim_date.date', 1),
    @('alerts.alert_date', 'dim_date.date', 1),
    @('decisions.department_id', 'departments.department_id', 1), @('decisions.decision_owner_id', 'employees.employee_id', 1), @('decisions.decision_date', 'dim_date.date', 1),
    @('kpi_targets.department_id', 'departments.department_id', 1), @('kpi_targets.month_start', 'dim_date.date', 1),
    @('customer_interactions.customer_id', 'customers.customer_id', 1), @('customer_interactions.owner_employee_id', 'employees.employee_id', 1), @('customer_interactions.interaction_date', 'dim_date.date', 1),
    @('data_quality_issues.detected_date', 'dim_date.date', 1),
    @('activity_log.employee_id', 'employees.employee_id', 1), @('activity_log.activity_date', 'dim_date.date', 1),
    @('calendar_events.owner_employee_id', 'employees.employee_id', 1), @('calendar_events.department_id', 'departments.department_id', 1), @('calendar_events.event_date', 'dim_date.date', 1),
    @('missions.department_id', 'departments.department_id', 1), @('missions.target_date', 'dim_date.date', 0),
    @('risk_register.department_id', 'departments.department_id', 1), @('risk_register.risk_owner_employee_id', 'employees.employee_id', 1), @('risk_register.identified_date', 'dim_date.date', 1),
    @('investigation_cases.department_id', 'departments.department_id', 1), @('investigation_cases.case_owner_employee_id', 'employees.employee_id', 1), @('investigation_cases.opened_date', 'dim_date.date', 1),
    @('investigation_evidence.case_id', 'investigation_cases.case_id', 1),
    @('notifications.recipient_employee_id', 'employees.employee_id', 1), @('notifications.notification_date', 'dim_date.date', 1),
    @('collaboration_comments.author_employee_id', 'employees.employee_id', 1), @('collaboration_comments.comment_date', 'dim_date.date', 1),
    @('approval_requests.requester_employee_id', 'employees.employee_id', 1), @('approval_requests.approver_employee_id', 'employees.employee_id', 0), @('approval_requests.request_date', 'dim_date.date', 1),
    @('strategic_goals.department_id', 'departments.department_id', 1)
)
$relText = foreach ($r in $rel) {
    $fromT, $fromC = $r[0].Split('.'); $toT, $toC = $r[1].Split('.')
    $tx = "relationship $(Guid "rel|$($r[0])|$($r[1])")`n"
    if (-not $r[2]) { $tx += "`tisActive: false`n" }
    $tx + "`tfromColumn: $(Q $fromT).$(Q $fromC)`n`ttoColumn: $(Q $toT).$(Q $toC)"
}
$fn = ($fnClean.Trim() -split "`n" | ForEach-Object { "`t`t$_" }) -join "`n"
Save "$sm\definition\model.tmdl" @"
model Model
	culture: en-US
	defaultPowerBIDataSourceVersion: powerBI_V3
	sourceQueryCulture: en-US
	dataAccessOptions
		legacyRedirects
		returnErrorValuesAsNull

expression DataFolder = "$data" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
	lineageTag: $(Guid 'DataFolder')

	annotation PBI_ResultType = Text

expression fnCleanText =
$fn
	lineageTag: $(Guid 'fnCleanText')

	annotation PBI_ResultType = Function

annotation __PBI_TimeIntelligenceEnabled = 0

$($relText -join "`n`n")
"@
Save "$sm\definition\database.tmdl" "database $(Guid 'database')`n`tcompatibilityLevel: 1606`n"
Save "$sm\definition.pbism" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json","version":"4.2","settings":{"qnaEnabled":false}}'
Save "$root\MissionControl.pbip" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json","version":"1.0","artifacts":[{"report":{"path":"MissionControl.Report"}}],"settings":{"enableAutoRecovery":true}}'
"model: $($tables.Count) tables + Revenue Shock, $($rel.Count) relationships ($(@($rel | Where-Object { -not $_[2] }).Count) inactive), $($catalogue.Count) measures + $($feeds.Count) feeds"
($tables.Keys | ForEach-Object { "{0,-26} {1}" -f $_, (($tables[$_].cols.GetEnumerator() | ForEach-Object { "$($_.Key):$($_.Value)" }) -join ' ') }) | Set-Content "$root\tools\schema.txt" -Encoding UTF8
