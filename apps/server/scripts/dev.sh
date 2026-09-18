#!/usr/bin/env bash
# Runs the Go server from source, allow-listing the vite dev server's origin so the UI on :5173
# can call the API. Mirrors apps/server's `dev` script.
set -euo pipefail

cd -- "$(dirname -- "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)")"

exec go run . serve \
  --no-open \
  --port "${PERCH_DEV_PORT:-4600}" \
  --allow-origin http://localhost:5173 \
  --allow-origin http://127.0.0.1:5173 \
  "$@"
