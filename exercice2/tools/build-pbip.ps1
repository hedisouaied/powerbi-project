# Generates the Power BI project (BOI360.pbip) from the Power Query files in ..\powerquery.
# The .pq files stay the single source of the M code; this script only wraps them in TMDL.
# Run with Power BI Desktop closed:  powershell -ExecutionPolicy Bypass -File exercice2\tools\build-pbip.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save([string]$path, [string]$text) { New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $text.Replace("`r`n", "`n"), $utf8) }
function Guid([string]$seed) { $md5 = [Security.Cryptography.MD5]::Create(); $b = $md5.ComputeHash([Text.Encoding]::UTF8.GetBytes("BOI360|$seed")); $b[6] = ($b[6] -band 0x0F) -bor 0x30; $b[8] = ($b[8] -band 0x3F) -bor 0x80; ([guid]::new($b)).ToString() }
function MBody([string]$file) { ((Get-Content (Join-Path $root "powerquery\$file") -Encoding UTF8) | Where-Object { $_ -notmatch '^\s*//' }) -join "`n" }
function Indent([string]$text, [string]$tabs) { ($text.Trim("`n") -split "`n" | ForEach-Object { $tabs + $_ }) -join "`n" }

# Column types: S text, D date, C money (TND), I whole number, P percentage, N decimal number, B true/false
$tables = [ordered]@{
    departments        = @('01_departments.pq', 'department_id:S department_name:S division:S base_city:S')
    employees          = @('02_employees.pq', 'employee_id:S first_name:S last_name:S email:S department_id:S job_title:S city:S hire_date:D monthly_salary_tnd:C employment_status:S full_name:S dq_shared_email:B')
    projects           = @('03_projects.pq', 'project_id:S project_name:S project_manager_id:S department_id:S start_date:D deadline:D budget_tnd:C actual_cost_tnd:C project_status:S priority:S')
    targets            = @('04_targets.pq', 'target_id:S employee_id:S target_month:D target_amount_tnd:C actual_sales_tnd:C achievement_pct:N')
    tasks              = @('05_tasks.pq', 'task_id:S task_title:S project_id:S assignee_id:S created_date:D due_date:D task_status:S priority:S source:S')
    customers          = @('06_customers.pq', 'customer_id:S customer_name:S customer_segment:S city:S')
    products           = @('07_products.pq', 'product_id:S product_name:S category:S list_price_tnd:C')
    sales_transactions = @('08_sales_transactions.pq', 'transaction_id:S transaction_date:D customer_id:S product_id:S seller_id:S quantity:I unit_price_tnd:C discount_pct:P revenue_tnd:C cost_tnd:C profit_tnd:C payment_status:S sales_region:S')
    expenses           = @('09_expenses.pq', 'expense_id:S expense_date:D department_id:S project_id:S expense_category:S approval_status:S amount_tnd:C description:S')
    leave_requests     = @('10_leave_requests.pq', 'leave_id:S employee_id:S leave_type:S start_date:D end_date:D working_days:I request_status:S comment:S')
}
# Amounts that make sense to add up by default; prices, salaries and percentages never are.
$summable = 'budget_tnd actual_cost_tnd target_amount_tnd actual_sales_tnd quantity revenue_tnd cost_tnd profit_tnd amount_tnd working_days' -split ' '
$type = @{
    S = @('string', $null); D = @('dateTime', 'yyyy-mm-dd'); C = @('decimal', '#,0.00" TND"'); I = @('int64', '#,0')
    P = @('double', '0.0%'); N = @('double', '0.0'); B = @('boolean', '"TRUE";"TRUE";"FALSE"')
}

# Foreign keys are hidden (users filter through the dimension instead); salary and the stored
# achievement_pct are hidden so nobody sums or displays them by accident.
$hidden = @('employees.department_id', 'employees.monthly_salary_tnd', 'projects.department_id', 'projects.project_manager_id',
    'targets.employee_id', 'targets.achievement_pct', 'tasks.project_id', 'tasks.assignee_id',
    'sales_transactions.customer_id', 'sales_transactions.product_id', 'sales_transactions.seller_id',
    'expenses.department_id', 'expenses.project_id', 'leave_requests.employee_id')

# Phase 2 relationships: from (many side) -> to (one side). Inactive ones are switched on with USERELATIONSHIP in measures.
$relationships = @(
    @('employees.department_id', 'departments.department_id', $true),
    @('sales_transactions.seller_id', 'employees.employee_id', $true),
    @('targets.employee_id', 'employees.employee_id', $true),
    @('tasks.assignee_id', 'employees.employee_id', $true),
    @('leave_requests.employee_id', 'employees.employee_id', $true),
    @('sales_transactions.customer_id', 'customers.customer_id', $true),
    @('sales_transactions.product_id', 'products.product_id', $true),
    @('projects.project_manager_id', 'project_managers.project_manager_id', $true),
    @('tasks.project_id', 'projects.project_id', $true),
    @('expenses.project_id', 'projects.project_id', $true),
    @('expenses.department_id', 'departments.department_id', $true),
    @('projects.department_id', 'departments.department_id', $false),
    @("sales_transactions.transaction_date", "Date.Date", $true),
    @("targets.target_month", "Date.Date", $true),
    @("expenses.expense_date", "Date.Date", $true),
    @("tasks.due_date", "Date.Date", $true),
    @("tasks.created_date", "Date.Date", $false),
    @("leave_requests.start_date", "Date.Date", $true),
    @("leave_requests.end_date", "Date.Date", $false),
    @("projects.start_date", "Date.Date", $false),
    @("projects.deadline", "Date.Date", $false),
    @("employees.hire_date", "Date.Date", $false)
)

$sm = Join-Path $root 'BOI360.SemanticModel'
$rp = Join-Path $root 'BOI360.Report'
if (Test-Path "$sm\definition") { Remove-Item "$sm\definition" -Recurse -Force }

foreach ($name in $tables.Keys) {
    $file, $spec = $tables[$name]
    $cols = foreach ($c in ($spec -split ' ')) {
        $col, $t = $c -split ':'; $dt, $fmt = $type[$t]
        $agg = if ($col -in $summable) { 'sum' } else { 'none' }
        $lines = @("`tcolumn $col", "`t`tdataType: $dt")
        if ($fmt -and $t -ne 'B') { $lines += "`t`tformatString: $fmt" }
        if ($col -eq "$($name.TrimEnd('s'))_id" -or ($name -eq 'sales_transactions' -and $col -eq 'transaction_id') -or ($name -eq 'leave_requests' -and $col -eq 'leave_id')) { $lines += "`t`tisKey" }
        if ("$name.$col" -in $hidden) { $lines += "`t`tisHidden" }
        $lines += "`t`tlineageTag: $(Guid "$name.$col")", "`t`tsummarizeBy: $agg", "`t`tsourceColumn: $col", '', "`t`tannotation SummarizationSetBy = Automatic"
        if ($t -eq 'D') { $lines += '', "`t`tannotation UnderlyingDateTimeDataType = Date" }
        $lines -join "`n"
    }
    $tmdl = "table $name`n`tlineageTag: $(Guid $name)`n`n" + ($cols -join "`n`n") + "`n`n`tpartition $name = m`n`t`tmode: import`n`t`tsource =`n" + (Indent (MBody $file) "`t`t`t`t") + "`n`n`tannotation PBI_ResultType = Table`n"
    Save "$sm\definition\tables\$name.tmdl" $tmdl
}

# ---------- Phase 2: Date table (DAX calculated table, marked as date table) ----------
function CalcCol([string]$table, [string]$name, [string]$expr, [string]$dt, [string]$fmt, [string]$sortBy) {
    $q = if ($name -match '\W') { "'$name'" } else { $name }
    $l = @("`tcolumn $q = $expr", "`t`tdataType: $dt")
    if ($fmt) { $l += "`t`tformatString: $fmt" }
    $l += "`t`tlineageTag: $(Guid "$table.$name")", "`t`tsummarizeBy: none"
    if ($sortBy) { $l += "`t`tsortByColumn: '$sortBy'" }
    $l += '', "`t`tannotation SummarizationSetBy = Automatic"
    $l -join "`n"
}
$dateCols = @(
    (CalcCol 'Date' 'Year' "YEAR('Date'[Date])" 'int64' '0'),
    (CalcCol 'Date' 'Quarter' "`"Q`" & QUARTER('Date'[Date])" 'string'),
    (CalcCol 'Date' 'Month Number' "MONTH('Date'[Date])" 'int64' '0'),
    (CalcCol 'Date' 'Month' "FORMAT('Date'[Date], `"mmm`", `"en-US`")" 'string' $null 'Month Number'),
    (CalcCol 'Date' 'Year Month Number' "YEAR('Date'[Date]) * 100 + MONTH('Date'[Date])" 'int64' '0'),
    (CalcCol 'Date' 'Year Month' "FORMAT('Date'[Date], `"mmm yyyy`", `"en-US`")" 'string' $null 'Year Month Number'),
    (CalcCol 'Date' 'Month Start' "DATE(YEAR('Date'[Date]), MONTH('Date'[Date]), 1)" 'dateTime' 'yyyy-mm-dd'),
    (CalcCol 'Date' 'Weekday Number' "WEEKDAY('Date'[Date], 2)" 'int64' '0'),
    (CalcCol 'Date' 'Weekday' "FORMAT('Date'[Date], `"ddd`", `"en-US`")" 'string' $null 'Weekday Number'),
    (CalcCol 'Date' 'Is Weekend' "WEEKDAY('Date'[Date], 2) > 5" 'boolean')
)
Save "$sm\definition\tables\Date.tmdl" (@"
table Date
	lineageTag: $(Guid 'Date')
	dataCategory: Time

	column Date
		dataType: dateTime
		isKey
		formatString: yyyy-mm-dd
		lineageTag: $(Guid 'Date.Date')
		summarizeBy: none
		isNameInferred
		sourceColumn: [Date]

		annotation SummarizationSetBy = Automatic

"@ + ($dateCols -join "`n`n") + @"


	partition Date = calculated
		mode: import
		source = CALENDAR(DATE(2021, 1, 1), DATE(2027, 12, 31))
"@)

# ---------- Phase 2: project manager role-playing dimension (copy of employees) ----------
$pmCols = foreach ($c in @('project_manager_id', 'project_manager', 'pm_department', 'pm_job_title', 'pm_city')) {
    $key = if ($c -eq 'project_manager_id') { "`n`t`tisKey" } else { '' }
    "`tcolumn $c`n`t`tdataType: string$key`n`t`tlineageTag: $(Guid "project_managers.$c")`n`t`tsummarizeBy: none`n`t`tisNameInferred`n`t`tsourceColumn: [$c]`n`n`t`tannotation SummarizationSetBy = Automatic"
}
Save "$sm\definition\tables\project_managers.tmdl" (@"
table project_managers
	lineageTag: $(Guid 'project_managers')

"@ + ($pmCols -join "`n`n") + @"


	partition project_managers = calculated
		mode: import
		source =
				SELECTCOLUMNS(
				    FILTER(employees, employees[employee_id] IN DISTINCT(projects[project_manager_id])),
				    "project_manager_id", employees[employee_id],
				    "project_manager", employees[full_name],
				    "pm_department", RELATED(departments[department_name]),
				    "pm_job_title", employees[job_title],
				    "pm_city", employees[city]
				)
"@)

# ---------- Phase 3: measures table, generated from dax\measures.dax ----------
. (Join-Path $PSScriptRoot 'measures.ps1')
$measureText = foreach ($ms in (Get-Measures)) {
    $q = if ($ms.Name -match '[^A-Za-z0-9_]') { "'$($ms.Name)'" } else { $ms.Name }
    $expr = ($ms.Expression -split "`n" | ForEach-Object { if ($_.Trim()) { "`t`t`t$_" } }) -join "`n"
    "`t/// $($ms.Description)`n`tmeasure $q =`n$expr`n`t`tformatString: $($ms.Format)`n`t`tdisplayFolder: $($ms.Folder)`n`t`tlineageTag: $(Guid "measure.$($ms.Name)")"
}
Save "$sm\definition\tables\_Measures.tmdl" (@"
table _Measures
	lineageTag: $(Guid '_Measures')

"@ + ($measureText -join "`n`n") + @"


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

$relText = foreach ($r in $relationships) {
    $from, $to, $active = $r
    $t = "relationship $(Guid "rel|$from|$to")`n"
    if (-not $active) { $t += "`tisActive: false`n" }
    $t + "`tfromColumn: $from`n`ttoColumn: $to"
}

$fn = Indent (MBody '00_fnCleanText.pq') "`t`t"
$dataFolder = Join-Path $root 'data'
Save "$sm\definition\model.tmdl" @"
model Model
	culture: en-US
	defaultPowerBIDataSourceVersion: powerBI_V3
	sourceQueryCulture: en-US
	dataAccessOptions
		legacyRedirects
		returnErrorValuesAsNull

expression DataFolder = "$dataFolder" meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]
	lineageTag: $(Guid 'DataFolder')

	annotation PBI_ResultType = Text

expression fnCleanText =
$fn
	lineageTag: $(Guid 'fnCleanText')

	annotation PBI_ResultType = Function

annotation __PBI_TimeIntelligenceEnabled = 0

$($relText -join "`n`n")

annotation PBI_QueryOrder = ["DataFolder","fnCleanText",$((($tables.Keys) | ForEach-Object { '"' + $_ + '"' }) -join ',')]
"@
Save "$sm\definition\database.tmdl" "database $(Guid 'database')`n`tcompatibilityLevel: 1606`n"
Save "$sm\definition.pbism" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/semanticModel/definitionProperties/1.0.0/schema.json","version":"4.2","settings":{"qnaEnabled":false}}'

# Report: one empty dark page for now (pages come in Phase 4).
if (-not (Test-Path "$rp\definition\report.json")) {
    $theme = 'c:\Users\DELL\Downloads\powerBiProject\exercice1\biproject.Report\StaticResources\SharedResources\BaseThemes'
    New-Item -ItemType Directory -Force "$rp\StaticResources\SharedResources" | Out-Null
    Copy-Item $theme "$rp\StaticResources\SharedResources\" -Recurse -Force
    $themeName = (Get-ChildItem "$rp\StaticResources\SharedResources\BaseThemes" -Filter *.json | Select-Object -First 1).BaseName
    Save "$rp\definition.pbir" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/report/definitionProperties/2.0.0/schema.json","version":"4.0","datasetReference":{"byPath":{"path":"../BOI360.SemanticModel"}}}'
    Save "$rp\definition\version.json" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/report/definition/versionMetadata/1.0.0/schema.json","version":"2.0.0"}'
    Save "$rp\definition\report.json" ('{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json","themeCollection":{"baseTheme":{"name":"' + $themeName + '","reportVersionAtImport":{"visual":"2.13.0","report":"3.4.0","page":"2.3.1"},"type":"SharedResources"}},"resourcePackages":[{"name":"SharedResources","type":"SharedResources","items":[{"name":"' + $themeName + '","path":"BaseThemes/' + $themeName + '.json","type":"BaseTheme"}]}],"settings":{"useStylableVisualContainerHeader":true,"exportDataMode":"AllowSummarized","defaultDrillFilterOtherVisuals":true,"allowChangeFilterTypes":true,"useEnhancedTooltips":true,"useDefaultAggregateDisplayName":true}}')
    Save "$rp\definition\pages\pages.json" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json","pageOrder":["p01overview"],"activePageName":"p01overview"}'
    Save "$rp\definition\pages\p01overview\page.json" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json","name":"p01overview","displayName":"Executive Overview","displayOption":"FitToPage","height":720,"width":1280,"objects":{"background":[{"properties":{"transparency":{"expr":{"Literal":{"Value":"0D"}}},"color":{"solid":{"color":{"expr":{"Literal":{"Value":"''#0B1020''"}}}}}}}],"outspace":[{"properties":{"transparency":{"expr":{"Literal":{"Value":"0D"}}},"color":{"solid":{"color":{"expr":{"Literal":{"Value":"''#0B1020''"}}}}}}}]}}'
}
Save "$root\BOI360.pbip" '{"$schema":"https://developer.microsoft.com/json-schemas/fabric/pbip/pbipProperties/1.0.0/schema.json","version":"1.0","artifacts":[{"report":{"path":"BOI360.Report"}}],"settings":{"enableAutoRecovery":true}}'
"built: $($tables.Count) tables -> $sm"
