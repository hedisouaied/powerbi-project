# Builds the raw and the edited demo videos from the two real screen recordings (no speed changes, no effects).
$ErrorActionPreference = 'Stop'
$demo = 'c:\Users\DELL\Downloads\powerBiProject\powerbi-demo'
$ff = "C:\Users\DELL\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"
$work = "$demo\tmp\clips"; New-Item -ItemType Directory -Force $work | Out-Null
Get-ChildItem $work -File | Remove-Item
$utf8 = New-Object System.Text.UTF8Encoding($false)
$enc = @('-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '30', '-an')
$font = 'C\:/Windows/Fonts/segoeuib.ttf'
$fontLight = 'C\:/Windows/Fonts/segoeui.ttf'

# ---------- Raw: segment 1 up to 17:32:50 (later frames show the user's own screen), then segment 2 ----------
& $ff -hide_banner -loglevel error -y -i "$demo\tmp\raw-fixed.mkv" -t 220 @enc "$work\raw1.mp4"
& $ff -hide_banner -loglevel error -y -i "$demo\tmp\raw2-fixed.mkv" @enc "$work\raw2.mp4"
[IO.File]::WriteAllText("$work\raw-list.txt", "file 'raw1.mp4'`nfile 'raw2.mp4'`n", $utf8)
& $ff -hide_banner -loglevel error -y -f concat -safe 0 -i "$work\raw-list.txt" -c copy -movflags +faststart "$demo\video\powerbi-demo-raw.mp4"

# ---------- Edited: real clips (source, start s, end s, caption) ----------
$clips = @(
    @('raw-fixed', 44, 54.5, 'Sales Overview - saved filters, then Clear all restores 3,498.60 TND'),
    @('raw-fixed', 73.5, 78, 'Glass tooltips on every chart'),
    @('raw-fixed', 98, 103.5, 'Store filter - every KPI and chart recalculates'),
    @('raw-fixed', 113.5, 123, 'Click a month or a status to filter the page'),
    @('raw-fixed', 155, 162.5, 'Product table - sort by header, live search'),
    @('raw2-fixed', 10.5, 16.5, 'Product Performance'),
    @('raw2-fixed', 25.5, 34.5, 'Tooltip, then click a category to filter'),
    @('raw2-fixed', 47.5, 54, 'Order Analysis'),
    @('raw2-fixed', 77, 80.5, 'Order Line Detail - dropdown filter per column'),
    @('raw2-fixed', 86.5, 91, 'Status = Cancelled: 2 of 33 lines'),
    @('raw2-fixed', 92, 100, 'Click a line to filter the whole page to its order'),
    @('raw2-fixed', 120.5, 126, 'Price Analysis - selling price equals list price'),
    @('raw2-fixed', 166, 171, 'Date Trends'),
    @('raw2-fixed', 184, 192.5, 'Daily peak tooltip, then filter to March'),
    @('raw2-fixed', 204, 210.5, 'Monthly detail - totals match 3,498.60'),
    @('raw2-fixed', 212.5, 218.5, 'Data Quality - exceptions kept visible, not hidden'),
    @('raw2-fixed', 242.5, 251.5, 'Filter payments by flag; master data with UNKNOWN members')
)
$list = New-Object System.Collections.Generic.List[string]

function Card([string]$name, [string]$title, [string]$sub, [double]$seconds) {
    [IO.File]::WriteAllText("$work\$name-t.txt", $title, $utf8); [IO.File]::WriteAllText("$work\$name-s.txt", $sub, $utf8)
    $vf = "drawtext=fontfile='$font':textfile='$($work.Replace('\','/').Replace(':','\:'))/$name-t.txt':fontsize=76:fontcolor=0xEEF2FF:x=(w-text_w)/2:y=h/2-90," +
          "drawtext=fontfile='$fontLight':textfile='$($work.Replace('\','/').Replace(':','\:'))/$name-s.txt':fontsize=34:fontcolor=0x22D3EE:x=(w-text_w)/2:y=h/2+20," +
          "fade=t=in:st=0:d=0.4,fade=t=out:st=$($seconds-0.4):d=0.4"
    & $ff -hide_banner -loglevel error -y -f lavfi -i "color=c=0x060818:s=1920x1080:r=30:d=$seconds" -vf $vf @enc "$work\$name.mp4"
    $list.Add("file '$name.mp4'")
}

Card 'title' 'Retail Sales Report - Power BI' 'Six pages, each one TypeScript custom visual  |  amounts in TND' 3.5
$i = 0
foreach ($c in $clips) {
    $i++; $name = 'c{0:D2}' -f $i; $dur = $c[2] - $c[1]
    [IO.File]::WriteAllText("$work\$name.txt", $c[3], $utf8)
    $tf = "$($work.Replace('\','/').Replace(':','\:'))/$name.txt"
    $vf = "drawtext=fontfile='$font':textfile='$tf':fontsize=34:fontcolor=0xEEF2FF:box=1:boxcolor=0x060818CC:boxborderw=18:x=60:y=h-110," +
          "fade=t=in:st=0:d=0.25,fade=t=out:st=$($dur-0.25):d=0.25"
    & $ff -hide_banner -loglevel error -y -ss $c[1] -i "$demo\tmp\$($c[0]).mkv" -t $dur -vf $vf @enc "$work\$name.mp4"
    $list.Add("file '$name.mp4'")
}
Card 'end' 'Recorded live in Power BI Desktop' 'Every interaction shown is real - no edits beyond cuts' 3.5
[IO.File]::WriteAllText("$work\final-list.txt", ($list -join "`n") + "`n", $utf8)
& $ff -hide_banner -loglevel error -y -f concat -safe 0 -i "$work\final-list.txt" -c copy -movflags +faststart "$demo\video\powerbi-demo-final.mp4"
'done'
