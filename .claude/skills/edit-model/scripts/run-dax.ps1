# Runs a DAX query against the model open in Power BI Desktop, using the client library that ships with Desktop.
# Usage: run-dax.ps1 -Query "EVALUATE ROW(""Net"", [Net Revenue])"
param([Parameter(Mandatory)][string]$Query)
$desktop = Get-Process PBIDesktop -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $desktop) { 'ERROR: Power BI Desktop is not running. Open biproject.pbip first.'; exit 1 }
Add-Type -Path (Join-Path (Split-Path $desktop.Path) 'Microsoft.PowerBI.AdomdClient.dll')
$workspace = Get-ChildItem "$env:USERPROFILE\Microsoft\Power BI Desktop Store App\AnalysisServicesWorkspaces" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$port = [int]((Get-Content (Join-Path $workspace.FullName 'Data\msmdsrv.port.txt') -Encoding Unicode) -join '')
$connection = New-Object Microsoft.AnalysisServices.AdomdClient.AdomdConnection("Data Source=localhost:$port")
$connection.Open()
try {
    $command = $connection.CreateCommand()
    $command.CommandText = $Query
    $reader = $command.ExecuteReader()
    'COLUMNS: ' + ((0..($reader.FieldCount - 1) | ForEach-Object { $reader.GetName($_) }) -join ' | ')
    while ($reader.Read()) {
        (0..($reader.FieldCount - 1) | ForEach-Object { $value = $reader.GetValue($_); if ($null -eq $value -or $value -is [DBNull]) { '<null>' } else { "$value" } }) -join ' | '
    }
    $reader.Close()
} catch {
    'ERROR: ' + $_.Exception.Message
    if ($_.Exception.InnerException) { 'INNER: ' + $_.Exception.InnerException.Message }
} finally { $connection.Close() }
