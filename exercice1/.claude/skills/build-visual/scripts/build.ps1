# Bumps the version, packages the chosen custom visuals, installs them into the report, then checks every report JSON file.
# Usage: build.ps1 -Visual table,report,sales   (or all)   [-NoInstall]
param(
    [ValidateSet('table', 'report', 'sales', 'all')][string[]]$Visual = 'all',
    [switch]$NoInstall
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path "$PSScriptRoot\..\..\..\..").Path
$utf8 = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem

$known = [ordered]@{
    table  = @{ project = 'mauveTable'; file = 'MauveTable.pbiviz' }
    report = @{ project = 'mauveReportPage'; file = 'MauveReportPage.pbiviz' }
    sales  = @{ project = 'mauveSalesPage'; file = 'MauveSalesPage.pbiviz' }
}
$chosen = if ($Visual -contains 'all') { @($known.Keys) } else { $Visual }

foreach ($key in $chosen) {
    $v = $known[$key]
    $folder = "$root\visuals\$($v.project)"

    # Power BI keeps a cached copy of a visual unless its version changes.
    $configPath = "$folder\pbiviz.json"
    $config = [IO.File]::ReadAllText($configPath, $utf8)
    $current = [regex]::Match($config, '"version"\s*:\s*"(\d+\.\d+\.\d+)\.(\d+)"')
    if (-not $current.Success) { throw "No version found in $configPath" }
    $version = "$($current.Groups[1].Value).$([int]$current.Groups[2].Value + 1)"
    $config = [regex]::Replace($config, '("version"\s*:\s*")\d+\.\d+\.\d+\.\d+(")', "`${1}$version`${2}")
    [IO.File]::WriteAllText($configPath, $config, $utf8)

    Push-Location $folder
    try {
        $log = cmd /c "..\node_modules\.bin\pbiviz.cmd package 2>&1"
        $failed = $LASTEXITCODE -ne 0
    } finally { Pop-Location }
    $log | Where-Object { $_ -match 'error|TS\d{4}|Module not found' -and $_ -notmatch 'ertificate' } | Select-Object -First 20
    $package = Get-ChildItem "$folder\dist" -Filter "*.$version.pbiviz" | Select-Object -First 1
    if ($failed -or -not $package) { throw "$($v.project) did not build (version $version)" }
    "$($v.project) $version built: $([math]::Round($package.Length / 1kb)) KB"

    if ($NoInstall) { continue }
    Copy-Item $package.FullName "$root\visuals\$($v.file)" -Force
    $guid = $package.Name -replace '\.\d+\.\d+\.\d+\.\d+\.pbiviz$', ''
    $target = "$root\biproject.Report\CustomVisuals\$guid"
    $zip = [IO.Compression.ZipFile]::OpenRead($package.FullName)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -eq 'package.json' -or $entry.FullName -like 'resources/*.pbiviz.json') {
                $destination = Join-Path $target ($entry.FullName -replace '/', '\')
                New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $true)
            }
        }
    } finally { $zip.Dispose() }
    "$($v.project) installed in CustomVisuals\$guid"
}

$files = Get-ChildItem "$root\biproject.Report" -Recurse -Filter *.json
$bad = 0
foreach ($file in $files) {
    try { $null = [IO.File]::ReadAllText($file.FullName, $utf8) | ConvertFrom-Json } catch { $bad++; "INVALID JSON: $($file.FullName)" }
}
"Report JSON files checked: $($files.Count), invalid: $bad"
if ($bad) { exit 1 }
