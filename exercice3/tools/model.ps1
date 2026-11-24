# Talks to the model open in Power BI Desktop (localhost Analysis Services), using the client library shipped with Desktop.
#   model.ps1 -Refresh                 full refresh of every table (same as Home > Refresh)
#   model.ps1 -Query "EVALUATE ..."    run a DAX query or DMV and print the rows
param([switch]$Refresh, [string]$Query)
$desktop = Get-Process PBIDesktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $desktop) { 'ERROR: Power BI Desktop is not running. Open exercice3\MissionControl.pbip first.'; exit 1 }
try { Add-Type -Path (Join-Path (Split-Path $desktop.Path) 'Microsoft.PowerBI.AdomdClient.dll') -ErrorAction Stop } catch { }  # partial type-load warnings are harmless
$workspace = Get-ChildItem "$env:USERPROFILE\Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$port = [int]((Get-Content (Join-Path $workspace.FullName 'Data\msmdsrv.port.txt') -Encoding Unicode) -join '')
$cn = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$port")
$cn.Open()
try {
    if ($Refresh) {
        $cmd = $cn.CreateCommand(); $cmd.CommandText = 'SELECT [CATALOG_NAME] FROM $SYSTEM.DBSCHEMA_CATALOGS'
        $r = $cmd.ExecuteReader(); $r.Read() | Out-Null; $db = $r.GetString(0); $r.Close()
        $cmd.CommandText = '{"refresh":{"type":"full","objects":[{"database":"' + $db + '"}]}}'
        $t0 = Get-Date; $cmd.ExecuteNonQuery() | Out-Null
        "refreshed $db in {0:N1} s" -f ((Get-Date) - $t0).TotalSeconds
    }
    if ($Query) {
        $cmd = $cn.CreateCommand(); $cmd.CommandText = $Query; $r = $cmd.ExecuteReader()
        ((0..($r.FieldCount - 1) | ForEach-Object { $r.GetName($_) }) -join ' | ')
        while ($r.Read()) { (0..($r.FieldCount - 1) | ForEach-Object { $v = $r.GetValue($_); if ($null -eq $v -or $v -is [DBNull]) { '<null>' } else { "$v" } }) -join ' | ' }
        $r.Close()
    }
} catch {
    'ERROR: ' + $_.Exception.Message
    if ($_.Exception.InnerException) { 'INNER: ' + $_.Exception.InnerException.Message }
} finally { $cn.Close() }
