# Generates the report part of BOI360.pbip (PBIR JSON): ONE page holding ONE custom visual (BOI 360 Page).
# The visual's sidebar switches between the 8 views (overview, sales, people, projects, tasks, finance, customers,
# actions) inside itself: Power BI has no API for a custom visual to change report pages.
# Saved Action Center changes (crud.changes) are carried over from BOI360.pbix if it has any.
# Run with Power BI Desktop closed:  powershell -ExecutionPolicy Bypass -File exercice2\tools\build-report.ps1
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$rp = Join-Path $root 'BOI360.Report'
$utf8 = New-Object System.Text.UTF8Encoding($false)
function Save([string]$path, [string]$text) { New-Item -ItemType Directory -Force (Split-Path $path) | Out-Null; [IO.File]::WriteAllText($path, $text, $utf8) }
function Json($o) { ConvertTo-Json -InputObject $o -Depth 64 -Compress }
function L($v) { @{ expr = @{ Literal = @{ Value = $v } } } }
function S([string]$t) { L ("'" + $t.Replace("'", "''") + "'") }

$guid = (Get-ChildItem "$rp\CustomVisuals" -Directory | Where-Object Name -like 'boi360Page*' | Select-Object -First 1).Name
if (-not $guid) { throw 'Build the visual first: tools\build-visual.ps1' }

$pages = [ordered]@{ p01_command = @('BOI 360 Command Center', 'overview') }

# Keep the Action Center changes already saved in the .pbix (they live in that visual's crud.changes property).
$crud = $null
$pbix = Join-Path $root 'BOI360.pbix'
if (Test-Path $pbix) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($pbix)
    try {
        foreach ($e in ($zip.Entries | Where-Object { $_.FullName -like 'Report/definition/pages/*/visuals/*/visual.json' })) {
            $r = New-Object IO.StreamReader($e.Open(), $utf8); $j = $r.ReadToEnd() | ConvertFrom-Json; $r.Close()
            if ($j.visual.objects.crud) { $crud = $j.visual.objects.crud; "carried over saved Action Center changes from $($e.FullName)" }
        }
    } finally { $zip.Dispose() }
}
# data role -> measure feeding it
$feeds = [ordered]@{ meta = 'JSON Meta'; departments = 'JSON Departments'; employees = 'JSON Employees'; customers = 'JSON Customers'; products = 'JSON Products'
    sales = 'JSON Sales'; targets = 'JSON Targets'; projects = 'JSON Projects'; tasks = 'JSON Tasks'; expenses = 'JSON Expenses'; leave = 'JSON Leave' }

if (Test-Path "$rp\definition\pages") { Remove-Item "$rp\definition\pages" -Recurse -Force }
$bg = @(@{ properties = @{ transparency = (L '0D'); color = @{ solid = @{ color = (S '#060818') } } } })
$off = @(@{ properties = @{ show = (L 'false') } })
foreach ($id in $pages.Keys) {
    $display, $kind = $pages[$id]
    Save "$rp\definition\pages\$id\page.json" (Json ([ordered]@{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json'
        name = $id; displayName = $display; displayOption = 'FitToPage'; height = 720; width = 1280
        objects = @{ background = $bg; outspace = $bg } }))
    $queryState = [ordered]@{}
    foreach ($role in $feeds.Keys) {
        $m = $feeds[$role]
        $queryState[$role] = @{ projections = @([ordered]@{ field = @{ Measure = @{ Expression = @{ SourceRef = @{ Entity = '_Measures' } }; Property = $m } }; queryRef = "_Measures.$m"; nativeQueryRef = $m }) }
    }
    Save "$rp\definition\pages\$id\visuals\page_visual\visual.json" (Json ([ordered]@{
        '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.9.0/schema.json'
        name = 'page_visual'
        position = [ordered]@{ x = 0; y = 0; z = 0; width = 1280; height = 720; tabOrder = 0 }
        visual = [ordered]@{
            visualType = $guid
            query = @{ queryState = $queryState }
            objects = $(if ($crud) { @{ page = @(@{ properties = @{ kind = (S $kind) } }); crud = $crud } } else { @{ page = @(@{ properties = @{ kind = (S $kind) } }) } })
            visualContainerObjects = @{ title = $off; background = $off; border = $off; dropShadow = $off; visualHeader = $off }
            drillFilterOtherVisuals = $true
        } }))
}
Save "$rp\definition\pages\pages.json" (Json ([ordered]@{
    '$schema' = 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json'
    pageOrder = @($pages.Keys); activePageName = 'p01_command' }))

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
$visuals = Get-ChildItem "$rp\definition\pages" -Recurse -Filter visual.json
"report: $($pages.Count) page, $($visuals.Count) visual, $count JSON files, $bad invalid"
