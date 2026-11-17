# Desktop automation helpers for the Power BI demo: real mouse/keyboard input through the Windows API, plus screenshots.
# Coordinates are physical pixels (1920x1080); the process is made DPI-aware so scaling (125%) doesn't shift them.
Add-Type -AssemblyName System.Drawing, System.Windows.Forms
if (-not ('UI' -as [type])) {
Add-Type -ReferencedAssemblies System.Drawing @'
using System; using System.Runtime.InteropServices; using System.Threading;
public class UI {
    [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
    [DllImport("user32.dll")] public static extern void mouse_event(uint f, int x, int y, int d, IntPtr e);
    [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, uint f, IntPtr e);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    public struct POINT { public int X; public int Y; }
    public static void Move(int x, int y, int ms) {
        POINT p; GetCursorPos(out p); int steps = Math.Max(1, ms / 10);
        for (int i = 1; i <= steps; i++) {
            double t = (double)i / steps; t = t * t * (3 - 2 * t);   // ease in/out
            SetCursorPos((int)(p.X + (x - p.X) * t), (int)(p.Y + (y - p.Y) * t)); Thread.Sleep(10);
        }
    }
    public static void Click() { mouse_event(2, 0, 0, 0, IntPtr.Zero); Thread.Sleep(60); mouse_event(4, 0, 0, 0, IntPtr.Zero); }
    public static void Wheel(int d) { mouse_event(0x800, 0, 0, d, IntPtr.Zero); }
    public static void Key(byte k) { keybd_event(k, 0, 0, IntPtr.Zero); Thread.Sleep(30); keybd_event(k, 0, 2, IntPtr.Zero); }
    public static string Title() { var s = new System.Text.StringBuilder(512); GetWindowText(GetForegroundWindow(), s, 512); return s.ToString(); }
}
'@
}
[UI]::SetProcessDPIAware() | Out-Null
$Demo = 'c:\Users\DELL\Downloads\powerBiProject\powerbi-demo'

function Go([int]$x, [int]$y, [int]$ms = 600) { [UI]::Move($x, $y, $ms) }
function Tap([int]$x, [int]$y, [int]$ms = 600, [int]$after = 1200) { [UI]::Move($x, $y, $ms); Start-Sleep -Milliseconds 150; [UI]::Click(); Start-Sleep -Milliseconds $after }
function Hover([int]$x, [int]$y, [int]$ms = 600, [int]$after = 1500) { [UI]::Move($x, $y, $ms); Start-Sleep -Milliseconds $after }
function Esc { [UI]::Key(0x1B); Start-Sleep -Milliseconds 400 }
# Screenshot of the whole screen; optional crop region and downscale for quick inspection.
function Shot([string]$name, [string]$folder = 'screenshots') {
    $bmp = New-Object System.Drawing.Bitmap 1920, 1080
    $g = [System.Drawing.Graphics]::FromImage($bmp); $g.CopyFromScreen(0, 0, 0, 0, $bmp.Size)
    $path = Join-Path "$Demo\$folder" "$name.png"; $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png); $g.Dispose(); $bmp.Dispose(); $path
}
function Log([string]$text) { Add-Content "$Demo\tmp\actions.log" ("{0:HH:mm:ss.fff}  {1}" -f (Get-Date), $text) }
function Add-Result($id, $page, $feature, $action, $expected, $actual, $status, $shot) {
    [pscustomobject]@{ id = $id; page = $page; feature = $feature; action = $action; expected = $expected; actual = $actual; status = $status; shot = $shot } |
        ConvertTo-Json -Compress | Add-Content "$Demo\tmp\results.jsonl" -Encoding UTF8
}
