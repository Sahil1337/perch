; Per-user installer for Perch on Windows. scripts/installer.sh passes the version and every
; input path as defines, so nothing here depends on the directory makensis runs from.
;
; Writes only %LOCALAPPDATA%\Programs\Perch, the per-user Start menu and desktop, and
; HKCU\...\Uninstall\Perch. ~/.perch (or PERCH_HOME) belongs to the user and is never touched,
; so connections, queries and history survive an uninstall.

Unicode true
ManifestDPIAware true
SetCompressor /SOLID lzma
RequestExecutionLevel user

!ifndef VERSION
  !error "define VERSION, e.g. -DVERSION=0.2.0"
!endif
!ifndef VERSION_QUAD
  !error "define VERSION_QUAD, e.g. -DVERSION_QUAD=0.2.0.0"
!endif
!ifndef PERCH_EXE
  !error "define PERCH_EXE, the path to perch-windows-amd64.exe"
!endif
!ifndef LAUNCHER_EXE
  !error "define LAUNCHER_EXE, the path to PerchLauncher.exe"
!endif
!ifndef LICENSE_FILE
  !error "define LICENSE_FILE"
!endif
!ifndef OUTFILE
  !error "define OUTFILE"
!endif

!define APP_NAME "Perch — SQL Client"
!define DESCRIPTION "SQL client for Postgres and MySQL databases"
!define PUBLISHER "Sahil1337"
!define HOMEPAGE "https://github.com/Sahil1337/perch"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\Perch"
!define WEBVIEW2_CLIENT "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
!define WEBVIEW2_URL "https://go.microsoft.com/fwlink/p/?LinkId=2124703"

Name "${APP_NAME}"
OutFile "${OUTFILE}"
InstallDir "$LOCALAPPDATA\Programs\Perch"
InstallDirRegKey HKCU "${UNINSTALL_KEY}" "InstallLocation"
BrandingText "Perch ${VERSION}"

VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${VERSION}"
VIAddVersionKey "FileVersion" "${VERSION}"
VIAddVersionKey "FileDescription" "${APP_NAME} Setup"
VIAddVersionKey "CompanyName" "${PUBLISHER}"
VIAddVersionKey "LegalCopyright" "MIT License"

!include MUI2.nsh
!include LogicLib.nsh
!include FileFunc.nsh
!include x64.nsh

!ifdef ICON
  !define MUI_ICON "${ICON}"
  !define MUI_UNICON "${ICON}"
!endif
!define MUI_ABORTWARNING

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\PerchLauncher.exe"
!define MUI_FINISHPAGE_RUN_TEXT "Launch Perch"
; The "show readme" checkbox is the stock way to put a second, checked-by-default option on the
; finish page; it creates the desktop shortcut instead of opening a file.
!define MUI_FINISHPAGE_SHOWREADME ""
!define MUI_FINISHPAGE_SHOWREADME_TEXT "Create a desktop shortcut"
!define MUI_FINISHPAGE_SHOWREADME_FUNCTION CreateDesktopShortcut
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Var Upgrade

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_ICONSTOP "Perch needs 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
FunctionEnd

Function CreateDesktopShortcut
  CreateShortCut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\PerchLauncher.exe" "" \
    "$INSTDIR\PerchLauncher.exe" 0 SW_SHOWNORMAL "" "${DESCRIPTION}"
FunctionEnd

; Windows lets a running exe be renamed but not overwritten. perch stop has usually let the
; server go by now, but the launcher window may still be open, and either process can take a
; moment to exit; moving the old file aside means the copy never waits on them. This is the
; same .old convention `perch update` uses, so either one cleans up after the other.
!macro MoveAside path
  Delete "${path}.old"
  ${If} ${FileExists} "${path}"
    Rename "${path}" "${path}.old"
  ${EndIf}
!macroend

; Leaves the runtime's version in $0, or "" when it is missing. The 32-bit registry view of HKLM
; is SOFTWARE\WOW6432Node on 64-bit Windows, which is where a per-machine runtime registers;
; HKCU holds a per-user one. "0.0.0.0" is what an uninstalled runtime leaves behind.
!macro ReadWebView2Version
  SetRegView 32
  ReadRegStr $0 HKLM "SOFTWARE\${WEBVIEW2_CLIENT}" "pv"
  ${If} $0 == ""
  ${OrIf} $0 == "0.0.0.0"
    ReadRegStr $0 HKCU "Software\${WEBVIEW2_CLIENT}" "pv"
  ${EndIf}
  ${If} $0 == "0.0.0.0"
    StrCpy $0 ""
  ${EndIf}
!macroend

; The launcher window is WebView2. Windows 11 always has the runtime and most Windows 10
; machines get it with Edge, so it is fetched only when missing rather than bundled.
; NSISdl, the only downloader in the stock nsis package, speaks plain http and the bootstrapper
; is https-only, so the download goes through Windows' own PowerShell (present on every
; supported Windows), with curl.exe (Windows 10 1803+) as the fallback.
Function EnsureWebView2
  !insertmacro ReadWebView2Version
  ${If} $0 != ""
    DetailPrint "Microsoft Edge WebView2 Runtime $0 is installed"
    Return
  ${EndIf}

  InitPluginsDir
  StrCpy $1 "$PLUGINSDIR\MicrosoftEdgeWebview2Setup.exe"
  DetailPrint "Downloading the Microsoft Edge WebView2 Runtime..."
  ; PowerShell 5.1 still defaults to TLS 1.0 on older .NET, and its progress bar slows
  ; Invoke-WebRequest by an order of magnitude.
  nsExec::ExecToLog `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "$$ProgressPreference = 'SilentlyContinue'; [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '${WEBVIEW2_URL}' -OutFile '$1'"`
  Pop $2
  ${IfNot} ${FileExists} "$1"
  ${AndIf} ${FileExists} "$SYSDIR\curl.exe"
    nsExec::ExecToLog `"$SYSDIR\curl.exe" -fsSL -o "$1" "${WEBVIEW2_URL}"`
    Pop $2
  ${EndIf}

  ${If} ${FileExists} "$1"
    DetailPrint "Installing the Microsoft Edge WebView2 Runtime..."
    ExecWait `"$1" /silent /install` $2
    DetailPrint "WebView2 setup exited with $2"
  ${EndIf}

  !insertmacro ReadWebView2Version
  ${If} $0 == ""
    ; Perch itself is installed and works from a terminal; only the window needs the runtime.
    DetailPrint "The Microsoft Edge WebView2 Runtime could not be installed"
    MessageBox MB_ICONEXCLAMATION "Perch is installed, but the Microsoft Edge WebView2 Runtime it needs for its window could not be installed.$\r$\n$\r$\nInstall it from ${WEBVIEW2_URL} and then open Perch again." /SD IDOK
  ${EndIf}
FunctionEnd

Section "-Perch"
  SetShellVarContext current
  SetOutPath "$INSTDIR"

  StrCpy $Upgrade 0
  ${If} ${FileExists} "$INSTDIR\perch.exe"
    StrCpy $Upgrade 1
    DetailPrint "Stopping Perch..."
    nsExec::ExecToLog `"$INSTDIR\perch.exe" stop`
    Pop $0
  ${EndIf}
  !insertmacro MoveAside "$INSTDIR\perch.exe"
  !insertmacro MoveAside "$INSTDIR\PerchLauncher.exe"

  File "/oname=perch.exe" "${PERCH_EXE}"
  File "/oname=PerchLauncher.exe" "${LAUNCHER_EXE}"
  File "/oname=LICENSE" "${LICENSE_FILE}"
  ; Fails quietly while a moved-aside copy is still running; the next install or update
  ; removes it.
  Delete "$INSTDIR\perch.exe.old"
  Delete "$INSTDIR\PerchLauncher.exe.old"

  WriteUninstaller "$INSTDIR\uninstall.exe"

  ; Straight in Programs, not a subfolder: Start search matches words in the shortcut's own
  ; name, which is how "sql" finds it.
  CreateShortCut "$SMPROGRAMS\${APP_NAME}.lnk" "$INSTDIR\PerchLauncher.exe" "" \
    "$INSTDIR\PerchLauncher.exe" 0 SW_SHOWNORMAL "" "${DESCRIPTION}"
  ; A silent install has no finish page, so it takes the checkbox's default, except that an
  ; upgrade does not bring back a desktop shortcut the user deleted.
  ${If} ${Silent}
    ${If} $Upgrade == 0
    ${OrIf} ${FileExists} "$DESKTOP\${APP_NAME}.lnk"
      Call CreateDesktopShortcut
    ${EndIf}
  ${EndIf}

  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\PerchLauncher.exe,0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "URLInfoAbout" "${HOMEPAGE}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" `"$INSTDIR\uninstall.exe"`
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" `"$INSTDIR\uninstall.exe" /S`
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  IntFmt $0 "0x%08X" $0
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" "$0"

  Call EnsureWebView2
SectionEnd

; Waits for an exe to stop running (a running image cannot be opened for writing), then asks
; the user to close it. A silent uninstall gives up instead, leaving everything in place.
Function un.WaitUntilFree
  Exch $R0
  Push $R1
  Push $R2
  StrCpy $R1 0
  ${Do}
    ${IfNot} ${FileExists} "$R0"
      ${Break}
    ${EndIf}
    ClearErrors
    FileOpen $R2 "$R0" a
    ${IfNot} ${Errors}
      FileClose $R2
      ${Break}
    ${EndIf}
    IntOp $R1 $R1 + 1
    ${If} $R1 >= 40
      MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "Perch is still running. Close the Perch window, then press Retry." /SD IDCANCEL IDRETRY retry
      Abort
      retry:
      StrCpy $R1 0
    ${EndIf}
    Sleep 250
  ${Loop}
  Pop $R2
  Pop $R1
  Pop $R0
FunctionEnd

Section "Uninstall"
  SetShellVarContext current

  ${If} ${FileExists} "$INSTDIR\perch.exe"
    DetailPrint "Stopping Perch..."
    nsExec::ExecToLog `"$INSTDIR\perch.exe" stop`
    Pop $0
  ${EndIf}
  Push "$INSTDIR\perch.exe"
  Call un.WaitUntilFree
  Push "$INSTDIR\PerchLauncher.exe"
  Call un.WaitUntilFree

  Delete "$INSTDIR\perch.exe"
  Delete "$INSTDIR\perch.exe.old"
  Delete "$INSTDIR\PerchLauncher.exe"
  Delete "$INSTDIR\PerchLauncher.exe.old"
  Delete "$INSTDIR\LICENSE"
  Delete "$INSTDIR\uninstall.exe"
  ; Not /r: anything the user put in the folder stays, and so does the folder.
  RMDir "$INSTDIR"

  Delete "$SMPROGRAMS\${APP_NAME}.lnk"
  Delete "$DESKTOP\${APP_NAME}.lnk"
  DeleteRegKey HKCU "${UNINSTALL_KEY}"

  ; The launcher's WebView2 cache, never user data. The launcher has exited by now (waited on
  ; above), and its browser processes go with it.
  RMDir /r "$LOCALAPPDATA\Perch\WebView2"
  RMDir "$LOCALAPPDATA\Perch"
SectionEnd
