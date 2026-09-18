#!/bin/sh
# Installs the latest perch release.
#
#   curl -fsSL https://raw.githubusercontent.com/Sahil1337/perch/main/install.sh | sh
#
# Environment:
#   PERCH_VERSION       install this tag instead of the latest (e.g. v0.1.0)
#   PERCH_INSTALL_DIR   install here instead of the first writable default
#   PERCH_DOWNLOAD_BASE fetch assets from here instead of GitHub (testing, mirrors)
set -eu

REPO="Sahil1337/perch"
BIN="perch"

say() { printf '%s\n' "$*"; }
err() { printf 'error: %s\n' "$*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || err "$1 is required but not installed"; }

need uname
need tar

# curl or wget, whichever is here.
if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL "$1"; }
  fetch_to() { curl -fsSL "$1" -o "$2"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -qO- "$1"; }
  fetch_to() { wget -qO "$2" "$1"; }
else
  err "curl or wget is required"
fi

detect_target() {
  os=$(uname -s)
  arch=$(uname -m)
  case "$os" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    MINGW* | MSYS* | CYGWIN*)
      err "Windows is not supported by this script — download perch-<version>-windows-amd64.exe from https://github.com/$REPO/releases/latest" ;;
    *) err "unsupported operating system: $os" ;;
  esac
  case "$arch" in
    x86_64 | amd64) arch=amd64 ;;
    arm64 | aarch64) arch=arm64 ;;
    *) err "unsupported architecture: $arch" ;;
  esac
  printf '%s-%s\n' "$os" "$arch"
}

latest_tag() {
  # Parsed with sed rather than jq, which is not installed everywhere.
  tag=$(fetch "https://api.github.com/repos/$REPO/releases/latest" \
    | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
  [ -n "$tag" ] || err "could not find a published release for $REPO — a draft release is not visible here; publish it, or set PERCH_VERSION"
  printf '%s\n' "$tag"
}

# The first writable candidate wins; ~/.local/bin is created if that is where we land.
choose_dir() {
  if [ -n "${PERCH_INSTALL_DIR:-}" ]; then
    printf '%s\n' "$PERCH_INSTALL_DIR"
    return
  fi
  for dir in /usr/local/bin "$HOME/.local/bin"; do
    if [ -d "$dir" ] && [ -w "$dir" ]; then
      printf '%s\n' "$dir"
      return
    fi
  done
  printf '%s\n' "$HOME/.local/bin"
}

verify_checksum() {
  archive=$1
  sums=$2
  if command -v sha256sum >/dev/null 2>&1; then
    checker="sha256sum -c"
  elif command -v shasum >/dev/null 2>&1; then
    checker="shasum -a 256 -c"
  else
    say "  ! neither sha256sum nor shasum found — skipping checksum verification"
    return 0
  fi
  # checksums.txt lists every asset; check only the one we downloaded.
  if ! grep " [ *]\{0,1\}$archive\$" "$sums" | $checker - >/dev/null 2>&1; then
    err "checksum mismatch for $archive — refusing to install"
  fi
  say "  checksum ok"
}

main() {
  target=$(detect_target)
  tag=${PERCH_VERSION:-$(latest_tag)}
  version=${tag#v}
  archive="$BIN-$version-$target.tar.gz"
  base=${PERCH_DOWNLOAD_BASE:-"https://github.com/$REPO/releases/download/$tag"}

  say "perch $tag ($target)"

  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT INT TERM

  say "  downloading $archive"
  fetch_to "$base/$archive" "$tmp/$archive" || err "no asset $archive in release $tag"

  if fetch_to "$base/checksums.txt" "$tmp/checksums.txt" 2>/dev/null; then
    (cd "$tmp" && verify_checksum "$archive" checksums.txt)
  else
    say "  ! no checksums.txt in this release — skipping verification"
  fi

  tar -xzf "$tmp/$archive" -C "$tmp"
  [ -f "$tmp/$BIN" ] || err "archive did not contain a $BIN binary"
  chmod +x "$tmp/$BIN"

  dir=$(choose_dir)
  mkdir -p "$dir" 2>/dev/null || err "cannot create $dir"
  if [ ! -w "$dir" ]; then
    err "$dir is not writable — re-run with PERCH_INSTALL_DIR=\$HOME/.local/bin, or use sudo"
  fi
  mv "$tmp/$BIN" "$dir/$BIN"

  say "  installed $dir/$BIN"
  case ":$PATH:" in
    *":$dir:"*) say "" ; say "Run: $BIN" ;;
    *)
      say ""
      say "$dir is not on your PATH. Add it:"
      say "  echo 'export PATH=\"$dir:\$PATH\"' >> ~/.zshrc && exec zsh"
      say ""
      say "Or run it directly: $dir/$BIN"
      ;;
  esac
}

main "$@"
