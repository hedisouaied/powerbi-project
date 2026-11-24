# Reads dax\measures.dax into objects: Name, Format, Folder, Description, Expression.
# Dot-source it:  . exercice2\tools\measures.ps1;  $measures = Get-Measures
function Get-Measures {
    $file = Join-Path (Split-Path $PSScriptRoot -Parent) 'dax\measures.dax'
    $list = New-Object System.Collections.Generic.List[object]
    $current = $null
    foreach ($line in (Get-Content $file -Encoding UTF8)) {
        if ($line -match '^-- measure:\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*$') {
            if ($current) { $list.Add($current) }
            $current = [pscustomobject]@{ Name = $Matches[1]; Format = $Matches[2]; Folder = $Matches[3]; Description = ''; Lines = New-Object System.Collections.Generic.List[string] }
        } elseif ($current -and $current.Lines.Count -eq 0 -and $line -match '^--\s?(.*)$') {
            $current.Description = ($current.Description + ' ' + $Matches[1]).Trim()
        } elseif ($current) {
            $current.Lines.Add($line)
        }
    }
    if ($current) { $list.Add($current) }
    foreach ($m in $list) {
        $m | Add-Member Expression (($m.Lines -join "`n").Trim())
        $m.PSObject.Properties.Remove('Lines')
    }
    $list
}
