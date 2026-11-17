# Builds the BOI 360 Page custom visual and installs it into BOI360.Report (private visual, saved in the file).
# Run:  powershell -ExecutionPolicy Bypass -File exercice2\tools\build-visual.ps1 [-NoInstall]
# On this PC, cmd AutoRun = "wsl.exe ~" hangs npm/pbiviz: AutoRun is paused during the build and always restored.
param([switch]$NoInstall)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$project = Join-Path $root 'visuals\boi360Page'
$utf8 = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem

# Power BI keeps a cached copy of a visual unless its version changes.
$configPath = Join-Path $project 'pbiviz.json'
$config = [IO.File]::ReadAllText($configPath, $utf8)
$current = [regex]::Match($config, '"version"\s*:\s*"(\d+\.\d+\.\d+)\.(\d+)"')
$version = "$($current.Groups[1].Value).$([int]$current.Groups[2].Value + 1)"
$config = [regex]::Replace($config, '("version"\s*:\s*")\d+\.\d+\.\d+\.\d+(")', "`${1}$version`${2}")
[IO.File]::WriteAllText($configPath, $config, $utf8)

$key = 'HKCU:\Software\Microsoft\Command Processor'
$autoRun = (Get-ItemProperty $key -Name AutoRun -ErrorAction SilentlyContinue).AutoRun
$env:Path = 'C:\Users\DELL\tools\node-v22.23.5-win-x64;' + $env:Path
try {
    if ($autoRun) { Remove-ItemProperty $key -Name AutoRun }
    Push-Location $project
    try {
        $log = cmd /c "..\node_modules\.bin\pbiviz.cmd package 2>&1"
        $failed = $LASTEXITCODE -ne 0
    } finally { Pop-Location }
} finally {
    if ($autoRun) { Set-ItemProperty $key -Name AutoRun -Value $autoRun }
}
$log | Where-Object { $_ -match 'error|TS\d{4}|Module not found|warning' -and $_ -notmatch 'ertificate' } | Select-Object -First 30
$package = Get-ChildItem "$project\dist" -Filter "*.$version.pbiviz" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($failed -or -not $package) { $log | Select-Object -Last 25; throw "boi360Page did not build (version $version)" }
"boi360Page $version built: $([math]::Round($package.Length / 1kb)) KB"
if ($NoInstall) { return }

$guid = $package.Name -replace '\.\d+\.\d+\.\d+\.\d+\.pbiviz$', ''
$target = Join-Path $root "BOI360.Report\CustomVisuals\$guid"
if (Test-Path $target) { Remove-Item $target -Recurse -Force }
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
Copy-Item $package.FullName (Join-Path $root 'visuals\BOI360Page.pbiviz') -Force
"installed in BOI360.Report\CustomVisuals\$guid"
