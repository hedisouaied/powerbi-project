# Renders the packaged Mission Control visual OUTSIDE Power BI (fake host; feeds built from the CSVs exactly like the
# "Feed <table>" measures by csv-feeds.js) and saves headless-Chrome screenshots. Does not touch the screen or Desktop.
# Usage: preview.ps1 [-Routes command,tasks,...] [-Theme dark|light] [-Out folder] [-Script 'js run after render'] [-DumpDom]
#        -Width/-Height = visual viewport (default 1600x900, the report page size)
param(
    [string[]]$Routes = @('command'),
    [string]$Theme = 'dark',
    [string]$Out = (Join-Path $env:TEMP 'mc-preview'),
    [string]$Script = '',
    [string]$Prefs = '',        # extra prefs JSON merged in, e.g. '{"persistEdits":true}'
    [int]$Width = 1600, [int]$Height = 900,
    [switch]$DumpDom            # print document.title (set by -Script) instead of a screenshot
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$utf8 = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.IO.Compression.FileSystem
New-Item -ItemType Directory -Force $Out | Out-Null
$node = 'C:\Users\DELL\tools\node-v22.23.5-win-x64\node.exe'

$package = Get-ChildItem "$root\visuals\missionControl\dist" -Filter *.pbiviz | Sort-Object LastWriteTime -Descending | Select-Object -First 1
$zip = [IO.Compression.ZipFile]::OpenRead($package.FullName)
$reader = New-Object IO.StreamReader(($zip.Entries | Where-Object { $_.FullName -like 'resources/*.pbiviz.json' }).Open(), $utf8)
$visual = $reader.ReadToEnd() | ConvertFrom-Json
$reader.Close(); $zip.Dispose()
[IO.File]::WriteAllText((Join-Path $Out 'visual.js'), "window.powerbi = {};`n" + $visual.content.js, $utf8)
[IO.File]::WriteAllText((Join-Path $Out 'visual.css'), $visual.content.css, $utf8)
& $node (Join-Path $PSScriptRoot 'csv-feeds.js') (Join-Path $Out 'feeds.js') | Out-Null

$chrome = @('C:\Program Files\Google\Chrome\Application\chrome.exe', 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
foreach ($route in $Routes) {
    $html = @"
<!doctype html><html><head><meta charset='utf-8'><link rel='stylesheet' href='visual.css'>
<style>html,body{margin:0;background:#06070A;overflow:hidden}#v{position:relative;width:${Width}px;height:${Height}px}</style></head>
<body><div id='v'></div>
<script>window.fetch = () => Promise.reject(new Error('network blocked in preview')); window.XMLHttpRequest = function () { throw new Error('network blocked'); };</script>
<script src='feeds.js'></script><script src='visual.js'></script><script>
const roles = Object.keys(window.FEEDS);
const columns = roles.map(r => ({ displayName: 'Feed ' + r, roles: { [r]: true }, type: { text: true } }));
const rows = [roles.map(r => window.FEEDS[r])];
let objects = { prefs: { json: JSON.stringify(Object.assign({ theme: '$Theme', landing: '$route', motion: 'reduced' }, $(if ($Prefs) { $Prefs } else { '{}' }))) } };
window.persistLog = []; window.exportLog = [];
const host = {
  eventService: { renderingStarted() {}, renderingFinished() {}, renderingFailed(o, e) { window.renderError = e; document.title = 'RENDER FAILED ' + e; } },
  downloadService: { exportStatus: () => Promise.resolve(0), exportVisualsContentExtended: (c, n, t) => { window.exportLog.push({ n, t, size: c.length }); return Promise.resolve({ downloadCompleted: true, fileName: n }); } },
  persistProperties(ch) { window.persistLog.push(ch); ch.merge.forEach(m => { objects[m.objectName] = Object.assign({}, objects[m.objectName], m.properties); }); setTimeout(update, 0); }
};
const element = document.getElementById('v');
const instance = powerbi.visuals.plugins['$($visual.visual.guid)'].create({ element, host });
function update() { instance.update({ viewport: { width: $Width, height: $Height }, dataViews: [{ table: { columns, rows }, metadata: { columns, objects } }] }); }
window.onerror = (m) => { document.title = 'JS ERROR ' + m; };
update();
const app = () => element.querySelector('.mc-app');
const click = (sel, i = 0) => { const e = element.querySelectorAll(sel)[i]; if (!e) { throw new Error('missing ' + sel); } e.click(); return e; };
$Script
</script></body></html>
"@
    $page = Join-Path $Out "preview-$route.html"
    [IO.File]::WriteAllText($page, $html, $utf8)
    $profile = Join-Path $Out 'chrome-profile'
    if ($DumpDom) {
        $dom = Join-Path $Out "$route.dom.html"
        $args = @('--headless=new', '--disable-gpu', "--user-data-dir=`"$profile`"", '--allow-file-access-from-files', '--virtual-time-budget=12000', '--dump-dom', ("file:///" + $page.Replace('\', '/')))
        Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden -RedirectStandardOutput $dom -RedirectStandardError (Join-Path $Out 'chrome.log')
        $m = [regex]::Match((Get-Content $dom -Raw -Encoding UTF8), '<title>(.*?)</title>', 'Singleline'); "{0,-12} {1}" -f $route, [Net.WebUtility]::HtmlDecode($m.Groups[1].Value)
        continue
    }
    $png = Join-Path $Out "$route-$Theme.png"
    if (Test-Path $png) { Remove-Item $png }
    $args = @('--headless=new', '--disable-gpu', '--hide-scrollbars', "--user-data-dir=`"$profile`"", '--allow-file-access-from-files', "--window-size=$Width,$Height", '--virtual-time-budget=8000', "--screenshot=`"$png`"", ("file:///" + $page.Replace('\', '/')))
    Start-Process -FilePath $chrome -ArgumentList $args -Wait -WindowStyle Hidden -RedirectStandardError (Join-Path $Out 'chrome.log')
    for ($i = 0; $i -lt 30 -and -not (Test-Path $png); $i++) { Start-Sleep -Milliseconds 500 }
    "{0,-12} {1}" -f $route, $(if (Test-Path $png) { $png } else { 'NO SCREENSHOT' })
}
