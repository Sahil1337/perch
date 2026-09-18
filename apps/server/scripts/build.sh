#!/usr/bin/env bash
# Builds the perch binary with the web UI embedded.
#
#   scripts/build.sh          this machine          -> dist/perch
#   scripts/build.sh --all    every release target  -> dist/perch-<os>-<arch>
#
# The UI comes from apps/server/ui, which `bun run --filter @perch/web build` writes. Building
# without it produces a working API that serves a "UI is not built" notice at /.
set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GO_DIR="$(dirname "$HERE")"
REPO="$(cd -- "$GO_DIR/../.." && pwd)"
cd "$GO_DIR"

UI_SRC="$REPO/apps/server/ui"
UI_DEST="$GO_DIR/webui/static"
VERSION="${PERCH_VERSION:-$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$REPO/apps/server/package.json" | head -1)}"
LDFLAGS="-s -w -X main.Version=${VERSION:-0.0.0}"

# Replace the embedded bundle wholesale: a stale asset from a previous build would otherwise be
# carried into the binary alongside the new ones, and the filenames are hashed so it would never
# be overwritten.
find "$UI_DEST" -mindepth 1 ! -name .gitkeep -delete 2>/dev/null || true
if [ -d "$UI_SRC" ] && [ -f "$UI_SRC/index.html" ]; then
  cp -R "$UI_SRC/." "$UI_DEST/"
  echo "ui: $(find "$UI_DEST" -type f ! -name .gitkeep | wc -l | tr -d ' ') file(s) from apps/server/ui"
else
  echo "ui: none found at apps/server/ui — building an API-only binary"
  echo "    run 'bun run --filter @perch/web build' first to embed the UI"
fi

build() { # build <goos> <goarch> <output>
  echo "  building $3"
  CGO_ENABLED=0 GOOS="$1" GOARCH="$2" go build -trimpath -ldflags="$LDFLAGS" -o "$3" .
}

size() { ls -l "$1" | awk -v n="$1" '{printf "  %-34s %5.1f MB\n", n, $5/1048576}'; }

mkdir -p dist
if [ "${1:-}" = "--all" ]; then
  # CGO is off and every dependency is pure Go, so one machine produces every target.
  printf '%s\n' "darwin arm64" "darwin amd64" "linux amd64" "linux arm64" "windows amd64" |
    while read -r goos goarch; do
      out="dist/perch-$goos-$goarch"
      [ "$goos" = windows ] && out="$out.exe"
      build "$goos" "$goarch" "$out"
      size "$out"
    done
else
  build "$(go env GOOS)" "$(go env GOARCH)" dist/perch
  size dist/perch
fi

echo "perch v$VERSION"
