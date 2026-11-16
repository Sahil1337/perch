# Drives the installed launcher window the way a person would: a click on the bird launches
# Perch, minimise and restore must leave it running, and closing the window must stop it. Saves a
# screenshot of the window at each step for someone to look at.
#
#   drive-window.ps1 -Dir "$env:LOCALAPPDATA\Programs\Perch" -Shots .\launcher-window
#
# Point PERCH_HOME at a throwaway folder first; the launcher and the server both use it.
param(
  [Parameter(Mandatory)] [string] $Dir,
  [Parameter(Mandatory)] [string] $Shots
)
$ErrorActionPreference = 'Stop'

function Fail($msg) {
  Save-Shot 'failure'
  if ($env:GITHUB_ACTIONS) { Write-Output "::error::$msg" } else { Write-Host "FAIL: $msg" -ForegroundColor Red }
  Get-Process PerchLauncher -ErrorAction SilentlyContinue | Stop-Process -Force
  exit 1
}

Add-Type -AssemblyName System.Drawing
Add-Type -Namespace Perch -Name Win -MemberDefinition @'
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
'@

New-Item -ItemType Directory -Force $Shots | Out-Null
$perch = Join-Path $Dir 'perch.exe'
$script:hwnd = [IntPtr]::Zero

# The window's client area on screen: everything below the title bar.
function Get-Client {
  $r = New-Object Perch.Win+RECT
  [Perch.Win]::GetClientRect($script:hwnd, [ref]$r) | Out-Null
  $p = New-Object Perch.Win+POINT
  [Perch.Win]::ClientToScreen($script:hwnd, [ref]$p) | Out-Null
  @{ X = $p.X; Y = $p.Y; W = $r.Right; H = $r.Bottom }
}

function Save-Shot($name) {
  if ($script:hwnd -eq [IntPtr]::Zero) { return }
  $c = Get-Client
  if ($c.W -le 0 -or $c.H -le 0) { return }
  $bmp = New-Object System.Drawing.Bitmap $c.W, $c.H
  [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($c.X, $c.Y, 0, 0, $bmp.Size)
  $bmp.Save((Join-Path $Shots "$name.png"))
}

# A real left click at a point given as fractions of the client area.
function Click($fx, $fy) {
  $c = Get-Client
  [Perch.Win]::SetForegroundWindow($script:hwnd) | Out-Null
  [Perch.Win]::SetCursorPos($c.X + [int]($c.W * $fx), $c.Y + [int]($c.H * $fy)) | Out-Null
  [Perch.Win]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero)
  [Perch.Win]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
}

function Get-Status { & $perch status --json | ConvertFrom-Json }

function Wait-For($what, $seconds, [scriptblock] $test) {
  for ($i = 0; $i -lt $seconds * 4; $i++) {
    if (& $test) { return }
    Start-Sleep -Milliseconds 250
  }
  Fail "timed out waiting for $what"
}

$launcher = Start-Process (Join-Path $Dir 'PerchLauncher.exe') -PassThru
Wait-For 'the launcher window' 20 { $launcher.Refresh(); $launcher.MainWindowHandle -ne [IntPtr]::Zero }
$script:hwnd = $launcher.MainWindowHandle
Start-Sleep -Seconds 3   # the page paints after the window appears
Save-Shot '1-ready'
if (Get-Status) { Fail 'a server was running before the launcher was asked to start one' }

# The bird is the launcher's primary action: it sits just above the middle of the window. A first
# click on a window that was just brought forward can be spent on focus, so it gets a few tries.
for ($try = 0; $try -lt 3 -and -not (Get-Status); $try++) {
  Click 0.5 0.4
  for ($i = 0; $i -lt 32 -and -not (Get-Status); $i++) { Start-Sleep -Milliseconds 250 }
}
Wait-For 'the server to start after a click on the bird' 20 { Get-Status }
$server = (Get-Status).pid
Start-Sleep -Seconds 2   # let the page show Running
Save-Shot '2-running'

[Perch.Win]::ShowWindow($script:hwnd, 6) | Out-Null   # SW_MINIMIZE
Start-Sleep -Seconds 3
[Perch.Win]::ShowWindow($script:hwnd, 9) | Out-Null   # SW_RESTORE
Start-Sleep -Seconds 2
if ($launcher.HasExited) { Fail 'the launcher exited while minimised' }
if (-not (Get-Status)) { Fail 'the server stopped while the launcher was minimised' }
Save-Shot '3-restored'

$launcher.CloseMainWindow() | Out-Null
Wait-For 'the launcher to exit after its window closed' 20 { $launcher.HasExited }
if (Get-Status) { Fail 'closing the launcher left the server running' }
if (Get-Process -Id $server -ErrorAction SilentlyContinue) { Fail "closing the launcher left server pid $server alive" }
Write-Host 'window: ok'
