# Starts the Mission Control web app: checks MySQL in WSL, starts the Laravel server (WSL, port 8000) if it is not
# answering, builds the React frontend if needed, then prints the URL.
#   powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1            # app at http://localhost:8000
#   powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1 -Dev       # + Vite dev server with hot reload on :5173
#   powershell -ExecutionPolicy Bypass -File exercice4\tools\start.ps1 -Build     # force a frontend rebuild
param([switch]$Dev, [switch]$Build)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$wslBackend = '/mnt/c/Users/DELL/Downloads/powerBiProject/exercice4/backend'
$node = 'C:\Users\DELL\tools\node-v22.23.5-win-x64\node.exe'

$mysql = (wsl.exe -e bash -lc 'systemctl is-active mysql') -join ''
if ($mysql -notmatch 'active') { throw "MySQL is not running in WSL. Start it with:  wsl -e sudo service mysql start" }
'MySQL: running'

function Test-Api { try { (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 http://localhost:8000/api/health).StatusCode -eq 200 } catch { $false } }
if (-not (Test-Api)) {
    wsl.exe -e bash -lc "cd $wslBackend && (nohup php artisan serve --host=0.0.0.0 --port=8000 > /tmp/mc-serve.log 2>&1 &)" | Out-Null
    for ($i = 0; $i -lt 30 -and -not (Test-Api); $i++) { Start-Sleep -Milliseconds 500 }
    if (-not (Test-Api)) { throw 'The Laravel server did not start. See /tmp/mc-serve.log in WSL.' }
}
'API:   http://localhost:8000/api/health OK'

$built = Test-Path (Join-Path $root 'backend\public\app\index.html')
if ($Build -or -not $built) {
    Push-Location (Join-Path $root 'frontend')
    try { & $node node_modules\vite\bin\vite.js build | Select-Object -Last 2 } finally { Pop-Location }
}
if ($Dev) {
    Start-Process -FilePath $node -ArgumentList 'node_modules\vite\bin\vite.js' -WorkingDirectory (Join-Path $root 'frontend') -WindowStyle Minimized
    'Dev:   http://localhost:5173/app/  (hot reload, /api proxied to :8000)'
}
''
'Open:  http://localhost:8000   (sign in or create an account)'
