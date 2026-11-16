# Checks a Perch Windows installer end to end: silent install, the files, shortcuts and uninstall
# key it writes, that `perch stop` really stops a server, then a reinstall over a running server
# and a silent uninstall that must leave the user's data alone.
#
#   check-install.ps1 -Setup .\perch-0.3.0-windows-amd64-setup.exe            # everything
#   check-install.ps1 -Setup ... -Step install                                  # CI runs the two
#   check-install.ps1 -Setup ... -Step uninstall                                # halves around the
#                                                                               # window check
# PERCH_HOME defaults to a fresh temp folder, so a run never reads or writes the real ~/.perch.
# It installs to and removes %LOCALAPPDATA%\Programs\Perch, so it refuses to start over an
# existing install unless given -Force.
param(
  [Parameter(Mandatory)] [string] $Setup,
  [ValidateSet('all', 'install', 'uninstall')] [string] $Step = 'all',
  [switch] $Force
)
$ErrorActionPreference = 'Stop'

function Fail($msg) {
  if ($env:GITHUB_ACTIONS) { Write-Output "::error::$msg" } else { Write-Host "FAIL: $msg" -ForegroundColor Red }
  exit 1
}

$Setup = (Resolve-Path $Setup).Path
if ((Split-Path $Setup -Leaf) -notmatch '^perch-(.+)-windows-amd64-setup\.exe$') { Fail "$Setup is not a perch setup.exe" }
$version = $Matches[1]
if (-not $env:PERCH_HOME) { $env:PERCH_HOME = Join-Path ([IO.Path]::GetTempPath()) 'perch-check-home' }
$scratch = Join-Path ([IO.Path]::GetTempPath()) 'perch-check'
New-Item -ItemType Directory -Force $env:PERCH_HOME, $scratch | Out-Null

$dir = Join-Path $env:LOCALAPPDATA 'Programs\Perch'
# Built from the code point so the check does not depend on how this script is decoded.
$name = "Perch $([char]0x2014) SQL Client"
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Perch'
$info = Join-Path $env:PERCH_HOME 'server.json'

function Start-Perch {
  $p = Start-Process "$dir\perch.exe" -ArgumentList 'serve', '--no-open' -PassThru -NoNewWindow `
    -RedirectStandardOutput "$scratch\serve.out" -RedirectStandardError "$scratch\serve.err"
  for ($i = 0; $i -lt 60 -and -not (Test-Path $info); $i++) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Path $info)) { Get-Content "$scratch\serve.out", "$scratch\serve.err"; Fail 'perch serve never wrote server.json' }
  $p
}

function Install-Silently($what) {
  $p = Start-Process $Setup -ArgumentList '/S' -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail "$what exited $($p.ExitCode)" }
}

function Test-Install {
  if ((Test-Path $dir) -and -not $Force -and -not $env:GITHUB_ACTIONS) {
    Fail "Perch is already installed in $dir; this check reinstalls and then removes it. Rerun with -Force."
  }
  Install-Silently 'setup /S'
  foreach ($file in 'perch.exe', 'PerchLauncher.exe', 'LICENSE', 'uninstall.exe') {
    if (-not (Test-Path (Join-Path $dir $file))) { Fail "missing $dir\$file" }
  }

  $shell = New-Object -ComObject WScript.Shell
  foreach ($folder in 'Programs', 'Desktop') {
    $lnk = Join-Path ([Environment]::GetFolderPath($folder)) "$name.lnk"
    if (-not (Test-Path -LiteralPath $lnk)) { Fail "no shortcut at $lnk" }
    $shortcut = $shell.CreateShortcut($lnk)
    if ($shortcut.TargetPath -ne (Join-Path $dir 'PerchLauncher.exe')) { Fail "$lnk points at $($shortcut.TargetPath)" }
    if ($shortcut.Description -cne 'SQL client for Postgres and MySQL databases') { Fail "$lnk says $($shortcut.Description)" }
  }

  $reg = Get-ItemProperty $key
  if ($reg.DisplayName -cne $name) { Fail "DisplayName is $($reg.DisplayName)" }
  if ($reg.DisplayVersion -ne $version) { Fail "DisplayVersion is $($reg.DisplayVersion)" }
  if ($reg.QuietUninstallString -ne "`"$dir\uninstall.exe`" /S") { Fail "QuietUninstallString is $($reg.QuietUninstallString)" }
  foreach ($value in 'Publisher', 'DisplayIcon', 'UninstallString', 'EstimatedSize', 'NoModify', 'NoRepair') {
    if ($null -eq $reg.$value) { Fail "the uninstall key has no $value" }
  }

  # The uninstall half checks this survives: PERCH_HOME is the user's data.
  Set-Content (Join-Path $env:PERCH_HOME 'marker.txt') 'left by the install check'

  $serve = Start-Perch
  & "$dir\perch.exe" stop
  if (-not $serve.WaitForExit(15000)) { Fail 'perch stop left the server running' }
  if (Test-Path $info) { Fail 'perch stop left server.json behind' }
  Write-Host 'install: ok'
}

function Test-Uninstall {
  $serve = Start-Perch
  Install-Silently 'setup /S over an install'
  if (-not $serve.WaitForExit(15000)) { Fail 'reinstalling left the running server up' }

  $serve = Start-Perch
  $before = Get-ChildItem -Recurse -File $env:PERCH_HOME | Where-Object Name -ne 'server.json' | ForEach-Object FullName
  Start-Process "$dir\uninstall.exe" -ArgumentList '/S' -Wait
  # The uninstaller hands off to a copy of itself in %TEMP% and returns at once, so this waits on
  # the effect rather than the process.
  for ($i = 0; $i -lt 120 -and ((Test-Path $dir) -or (Test-Path $key)); $i++) { Start-Sleep -Milliseconds 500 }
  if (Test-Path $dir) { Get-ChildItem $dir; Fail "uninstall left $dir behind" }
  if (Test-Path $key) { Fail 'uninstall left the registry key behind' }
  foreach ($folder in 'Programs', 'Desktop') {
    $lnk = Join-Path ([Environment]::GetFolderPath($folder)) "$name.lnk"
    if (Test-Path -LiteralPath $lnk) { Fail "uninstall left $lnk behind" }
  }
  if (-not $serve.WaitForExit(5000)) { Fail 'uninstall left the server running' }

  $missing = $before | Where-Object { -not (Test-Path -LiteralPath $_) }
  if ($missing) { Fail "uninstall removed user data: $($missing -join ', ')" }
  $marker = Join-Path $env:PERCH_HOME 'marker.txt'
  if (-not (Test-Path $marker) -or (Get-Content $marker) -ne 'left by the install check') { Fail 'uninstall changed PERCH_HOME' }
  Write-Host 'uninstall: ok'
}

if ($Step -in 'all', 'install') { Test-Install }
if ($Step -in 'all', 'uninstall') { Test-Uninstall }
