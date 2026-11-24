# Runs the feeds the way the visual's query does (all feed measures in ONE query) against the model open in Desktop,
# and reports per feed: length, whether it parses as JSON, row count. Detects feeds that fail or come back cut.
# Usage (Desktop open): powershell -ExecutionPolicy Bypass -File exercice3\tools\check-feeds.ps1 [-Measures 'Feed alerts','Feed incidents']
param([string[]]$Measures)
$ErrorActionPreference = 'Stop'
$desktop = Get-Process PBIDesktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $desktop) { throw 'Open MissionControl.pbip in Power BI Desktop first.' }
try { Add-Type -Path (Join-Path (Split-Path $desktop.Path) 'Microsoft.PowerBI.AdomdClient.dll') -ErrorAction Stop } catch { }
$ws = Get-ChildItem "$env:USERPROFILE\Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$port = [int]((Get-Content (Join-Path $ws.FullName 'Data\msmdsrv.port.txt') -Encoding Unicode) -join '')
$cn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$port$(if ($env:MC_LCID) { ";LocaleIdentifier=$env:MC_LCID" })"); $cn.Open()
$Measures = @($Measures | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
if (-not $Measures) {
    $cmd = $cn.CreateCommand(); $cmd.CommandText = "SELECT [MEASURE_NAME] FROM `$SYSTEM.MDSCHEMA_MEASURES WHERE [MEASUREGROUP_NAME] = '_Measures'"
    $r = $cmd.ExecuteReader(); $Measures = @(while ($r.Read()) { $n = $r.GetString(0); if ($n -like 'Feed *') { $n } }); $r.Close()
}
$q = 'EVALUATE SUMMARIZECOLUMNS ( ' + (($Measures | ForEach-Object { "`"$_`", [$_]" }) -join ', ') + ' )'
$cmd = $cn.CreateCommand(); $cmd.CommandText = $q; $cmd.CommandTimeout = 600
$t0 = Get-Date; $r = $cmd.ExecuteReader(); $r.Read() | Out-Null
"one query, $($Measures.Count) feeds, {0:N1} s" -f ((Get-Date) - $t0).TotalSeconds
for ($i = 0; $i -lt $r.FieldCount; $i++) {
    $v = $r.GetValue($i); $s = if ($v -is [DBNull] -or $null -eq $v) { '' } else { [string]$v }
    $ok = $true; $rows = -1
    try { $rows = @(($s | ConvertFrom-Json).r).Count } catch { $ok = $false }
    '{0,-30} {1,8} chars  {2}' -f $r.GetName($i), $s.Length, $(if ($ok) { "json ok, $rows rows" } else { 'INVALID JSON  ...' + $s.Substring([Math]::Max(0, $s.Length - 60)) })
}
$r.Close(); $cn.Close()
