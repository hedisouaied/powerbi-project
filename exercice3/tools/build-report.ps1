# Generates the report part of MissionControl.pbip (PBIR JSON): ONE page holding ONE custom visual (Mission Control),
# bound to the 31 "Feed <table>" measures (one data role per table, see tools\feeds.json).
# The visual's sidebar switches between its 33 modules inside itself (custom visuals cannot change report pages).
# Saved preferences / kept edits (objects prefs.json and workspace.json) are carried over from MissionControl.pbix if it has any.
# Run with Power BI Desktop closed:  powershell -ExecutionPolicy Bypass -File exercice3\tools\build-report.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$rp = Join-Path $root 'MissionControl.Report'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save([string]$path, [string]$text) { New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $text, $utf8) }
function Json($o) { ConvertTo-Json -InputObject $o -Depth 64 -Compress }
function L($v) { @{ expr = @{ Literal = @{ Value = $v } } } }
function S([string]$t) { L ("'" + $t.Replace("'", "''") + "'") }

$guid = (Get-ChildItem "$rp\CustomVisuals" -Directory | Where-Object Name -like 'missionControl*' | Select-Object -First 1).Name
if (-not $guid) { throw 'Build the visual first: tools\build-visual.ps1' }
$feeds = Get-Content (Join-Path $PSScriptRoot 'feeds.json') -Raw | ConvertFrom-Json

# Keep what users saved inside the visual (Ctrl+S in Desktop) when the .pbix already exists.
$saved = @{}
$pbix = Join-Path $root 'MissionControl.pbix'
if (Test-Path $pbix) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($pbix)
    try {
        foreach ($e in ($zip.Entries | Where-Object { $_.FullName -like 'Report/definition/pages/*/visuals/*/visual.json' })) {
            $r = New-Object IO.StreamReader($e.Open(), $utf8); $j = $r.ReadToEnd() | ConvertFrom-Json; $r.Close()
            foreach ($o in 'prefs', 'workspace') { if ($j.visual.objects.$o) { $saved[$o] = $j.visual.objects.$o; "carried over saved '$o' from MissionControl.pbix" } }
        }
    } finally { $zip.Dispose() }
}

$id = 'p01_mission'
if (Test-Path "$rp\definition\pages") { Remove-Item "$rp\definition\pages" -Recurse -Force }
$bg = @(@{ properties = @{ transparency = (L '0D'); color = @{ solid = @{ color = (S '#06070A') } } } })
$off = @(@{ properties = @{ show = (L 'false') } })
Save "$rp\definition\pages\$id\page.json" (Json ([ordered]@{
    '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json'
    name = $id; displayName = 'Mission Control'; displayOption = 'FitToPage'; height = 900; width = 1600
    objects = @{ background = $bg; outspace = $bg } }))
$queryState = [ordered]@{}
foreach ($t in $feeds) {
    $m = "Feed $t"
    $queryState[$t] = @{ projections = @([ordered]@{ field = @{ Measure = @{ Expression = @{ SourceRef = @{ Entity = '_Measures' } }; Property = $m } }; queryRef = "_Measures.$m"; nativeQueryRef = $m }) }
}
$visual = [ordered]@{
    visualType = $guid
    query = @{ queryState = $queryState }
    visualContainerObjects = @{ title = $off; background = $off; border = $off; dropShadow = $off; visualHeader = $off }
    drillFilterOtherVisuals = $true
}
if ($saved.Count) { $visual.objects = $saved }
Save "$rp\definition\pages\$id\visuals\mission_control\visual.json" (Json ([ordered]@{
    '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json'
    name = 'mission_control'
    position = [ordered]@{ x = 0; y = 0; z = 0; width = 1600; height = 900; tabOrder = 0 }
    visual = $visual }))
Save "$rp\definition\pages\pages.json" (Json ([ordered]@{
    '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json'
    pageOrder = @($id); activePageName = $id }))

# report.json: base theme + the private custom visual (registered the way Power BI writes it)
$base = (Get-ChildItem "$rp\StaticResources\SharedResources\BaseThemes" -Filter *.json | Select-Object -First 1).BaseName
if (Test-Path "$rp\StaticResources\RegisteredResources") { Remove-Item "$rp\StaticResources\RegisteredResources" -Recurse -Force }
Save "$rp\definition\report.json" (Json ([ordered]@{
    '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/report/3.3.0/schema.json'
    themeCollection = @{ baseTheme = [ordered]@{ name = $base; reportVersionAtImport = @{ visual = '2.13.0'; report = '3.4.0'; page = '2.3.1' }; type = 'SharedResources' } }
    resourcePackages = @(
        [ordered]@{ name = 'SharedResources'; type = 'SharedResources'; items = @(@{ name = $base; path = "BaseThemes/$base.json"; type = 'BaseTheme' }) },
        [ordered]@{ name = $guid; type = 'CustomVisual'; items = @([ordered]@{ name = "$guid.pbiviz.json"; path = "$guid.pbiviz.json"; type = 'CustomVisualMetadata' }) }
    )
    settings = [ordered]@{ useStylableVisualContainerHeader = $true; exportDataMode = 'AllowSummarized'; defaultDrillFilterOtherVisuals = $true; allowChangeFilterTypes = $true; useEnhancedTooltips = $true; useDefaultAggregateDisplayName = $true }
}))

$bad = 0; $count = 0
Get-ChildItem $rp -Recurse -Filter *.json | ForEach-Object { $count++; try { Get-Content $_.FullName -Raw | ConvertFrom-Json | Out-Null } catch { $bad++; "INVALID: $($_.FullName)" } }
"report: 1 page, 1 visual bound to $(@($feeds).Count) feed measures, $count JSON files, $bad invalid"
