#!/usr/bin/env bash
# Builds dist/PerchLauncher.exe, the Windows launcher window, with its icon, version info and
# manifest embedded. Pure Go, so it cross-compiles from any machine.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
DIR="$(dirname "$HERE")"
REPO="$(cd -- "$DIR/../.." && pwd)"
cd "$DIR"

# The launcher ships beside perch.exe and carries the same version, from the one place it lives.
VERSION="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO/apps/server/package.json" | head -1)"
[ -n "$VERSION" ] || { echo "apps/server/package.json declares no version" >&2; exit 1; }

# go-winres is pinned and run, not added to go.mod: it is a build tool, not a dependency of the exe.
go run github.com/tc-hib/go-winres@v0.3.3 make --in winres/winres.json --arch amd64 --out rsrc \
  --product-version "$VERSION" --file-version "$VERSION"

mkdir -p dist
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath \
  -ldflags="-s -w -H windowsgui -X main.Version=$VERSION" -o dist/PerchLauncher.exe .
rm -f rsrc_windows_amd64.syso

ls -l dist/PerchLauncher.exe | awk '{printf "  dist/PerchLauncher.exe %5.2f MB\n", $5/1048576}'
echo "PerchLauncher v$VERSION"
