#!/usr/bin/env bash
# Builds the Windows installer around the two exes the build scripts already produce.
#
#   scripts/installer.sh   -> dist/perch-<version>-windows-amd64-setup.exe
#
# Run these first:
#   apps/server/scripts/build.sh --all   -> apps/server/dist/perch-windows-amd64.exe
#   apps/launcher/scripts/build.sh       -> apps/launcher/dist/PerchLauncher.exe
# PERCH_EXE overrides the first path, for a build that only made the host binary.
#
# Needs makensis: `apt-get install nsis` on Linux, `choco install nsis` on Windows.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
LAUNCHER="$(dirname "$HERE")"
REPO="$(cd -- "$LAUNCHER/../.." && pwd)"

VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO/apps/server/package.json" | head -1)"
[ -n "$VERSION" ] || { echo "apps/server/package.json declares no version" >&2; exit 1; }
# The exe's version resource takes exactly four numbers, so a pre-release suffix is dropped there;
# the file name and the Add/Remove Programs entry keep the full version.
CORE="${VERSION%%[-+]*}"
[[ "$CORE" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "unexpected version: $VERSION" >&2; exit 1; }

PERCH_EXE="${PERCH_EXE:-$REPO/apps/server/dist/perch-windows-amd64.exe}"
LAUNCHER_EXE="$LAUNCHER/dist/PerchLauncher.exe"
LICENSE_FILE="$REPO/LICENSE"
OUTFILE="$LAUNCHER/dist/perch-$VERSION-windows-amd64-setup.exe"

for input in "$PERCH_EXE" "$LAUNCHER_EXE" "$LICENSE_FILE"; do
  [ -f "$input" ] || { echo "missing $input — build it first (see the top of this script)" >&2; exit 1; }
done
command -v makensis >/dev/null || { echo "makensis not found: apt-get install nsis, or choco install nsis" >&2; exit 1; }

# makensis on Windows is a native program and cannot read Git Bash's /c/... paths.
native() { if command -v cygpath >/dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

ICON_ARG=()
for ico in "$LAUNCHER"/winres/*.ico; do
  [ -f "$ico" ] && ICON_ARG=("-DICON=$(native "$ico")")
  break
done

mkdir -p "$LAUNCHER/dist"
# The script is UTF-8 without a BOM (the em dash in the app name), which makensis would
# otherwise read in the system code page.
makensis -V2 -INPUTCHARSET UTF8 \
  "-DVERSION=$VERSION" \
  "-DVERSION_QUAD=$CORE.0" \
  "-DPERCH_EXE=$(native "$PERCH_EXE")" \
  "-DLAUNCHER_EXE=$(native "$LAUNCHER_EXE")" \
  "-DLICENSE_FILE=$(native "$LICENSE_FILE")" \
  "-DOUTFILE=$(native "$OUTFILE")" \
  ${ICON_ARG[@]+"${ICON_ARG[@]}"} \
  "$(native "$LAUNCHER/installer/perch.nsi")"

ls -l "$OUTFILE" | awk '{printf "  %s %5.1f MB\n", $NF, $5/1048576}'
