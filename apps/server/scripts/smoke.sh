#!/usr/bin/env bash
# End-to-end smoke test against a local Postgres. This is the only automated exercise of the CLI
# and the HTTP API, so every step asserts its answer: a wrong status code or a missing field fails
# the run. Usage: bash scripts/smoke.sh   (override the database with PERCH_SMOKE_PG=<url>)
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

export PERCH_HOME="$(mktemp -d)"
PG_URL="${PERCH_SMOKE_PG:-postgres://sahil@localhost:5432/sqe_demo}"
PG_DB="${PG_URL##*/}"; PG_DB="${PG_DB%%\?*}"
PORT="${PERCH_SMOKE_PORT:-4699}"
CLI="node dist/cli/main.js"
B="http://127.0.0.1:$PORT/api"
FAILED=0
SERVER_PID=""

pass() { echo "  ok   $1"; }
fail() { echo "  FAIL $1"; FAILED=$((FAILED + 1)); }
# expect <label> <expected> <actual>: exact match.
expect() { if [ "$2" = "$3" ]; then pass "$1"; else fail "$1 — expected [$2], got [$3]"; fi; }
# expect_has <label> <needle> <haystack>: substring match.
expect_has() { case "$3" in *"$2"*) pass "$1" ;; *) fail "$1 — missing [$2] in: ${3:0:200}" ;; esac; }
json() { node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(eval(process.argv[1]))})" "$1"; }
cleanup() {
  if [ -n "$SERVER_PID" ]; then $CLI stop >/dev/null 2>&1 || kill "$SERVER_PID" 2>/dev/null || true; wait "$SERVER_PID" 2>/dev/null || true; fi
  rm -f "$PWD/smoke-tmp.sql"
}
trap cleanup EXIT

echo "== CLI (perch home: $PERCH_HOME)"
expect "version prints a semver" "$($CLI --version | grep -cE '^[0-9]+\.[0-9]+\.[0-9]+$')" "1"
expect_has "conn add --test reaches the server" "ok ·" "$($CLI conn add demo "$PG_URL" --test)"
expect_has "conn ls lists it" "demo" "$($CLI conn ls)"
expect_has "conn dbs sees the target db" "$PG_DB" "$($CLI conn dbs demo)"
expect_has "schema lists orders" "orders" "$($CLI schema demo)"
expect_has "schema --table shows a pk" "pk" "$($CLI schema demo --table public.orders)"
expect_has "run table format has a footer" "rows ·" "$($CLI run demo -e "select status, count(*) as n from orders group by 1")"
expect "run json format returns 3 rows" "$($CLI run demo -e "select id from orders limit 3" --format json | json 'j.length')" "3"
expect "run csv format has the header" "$($CLI run demo -e "select id, status from orders limit 1" --format csv | head -1 | tr -d '\r')" "id,status"
set +e; ERR_OUT=$($CLI run demo -e "select * from order o" 2>&1); ERR_CODE=$?; set -e
expect "run exits 1 on a SQL error" "$ERR_CODE" "1"
expect_has "run prints the error" "syntax error" "$ERR_OUT"
expect_has "history records the runs" "select" "$($CLI history --limit 3)"

echo "== server"
$CLI serve --port "$PORT" --no-open --dir "$PWD" > "$PERCH_HOME/serve.log" 2>&1 &
SERVER_PID=$!
for _ in $(seq 1 40); do curl -sf "$B/health" >/dev/null && break; sleep 0.5; done
J="content-type: application/json"

expect "health names the server" "$(curl -s "$B/health" | json 'j.name')" "perch"
CID=$(curl -s "$B/connections" | json 'j[0].id')
expect "connections lists demo without its password" "$(curl -s "$B/connections" | json 'j[0].name + ":" + String("password" in j[0])')" "demo:false"
expect "connect → connected" "$(curl -s -X POST "$B/connections/$CID/connect" | json 'j.status')" "connected"
expect "schema has orders with 5 columns" "$(curl -s "$B/connections/$CID/schema" | json 'j.schemas[0].tables.find(t=>t.name==="orders").columns.length')" "5"
STREAM=$(curl -s -N -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"select id from orders limit 5; select count(*) from customers\"}" "$B/query")
expect "stream starts with 2 statements" "$(echo "$STREAM" | head -1 | json 'j.statements')" "2"
expect "stream ends done" "$(echo "$STREAM" | tail -1 | json 'j.status')" "done"
expect "stream carried 5 rows for statement 0" "$(echo "$STREAM" | grep '"type":"result"' | head -1 | json 'j.result.rowCount')" "5"
expect "sync error carries the pg code" "$(curl -s -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"select * from order o\"}" "$B/query/sync" | json 'j.status + ":" + j.error.code')" "error:42601"
(curl -s -N -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"select pg_sleep(10)\",\"runId\":\"r-cancel\"}" "$B/query" > "$PERCH_HOME/cancel.out" &)
sleep 1
expect "cancel is acknowledged" "$(curl -s -X POST "$B/runs/r-cancel/cancel" | json 'j.cancelled')" "true"
sleep 1
expect "cancelled run ends with status cancelled" "$(tail -1 "$PERCH_HOME/cancel.out" | json 'j.status')" "cancelled"
curl -s -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"select id, total_cents from orders limit 3\",\"runId\":\"r-exp\"}" "$B/query/sync" >/dev/null
expect "csv export header" "$(curl -s "$B/runs/r-exp/export?format=csv" | head -1 | tr -d '\r')" "id,total_cents"
expect "csv export has 3 data rows" "$(curl -s "$B/runs/r-exp/export?format=csv" | tail -n +2 | grep -c .)" "3"
expect "discover finds a local postgres" "$(curl -s "$B/discover?rescan=1" | json 'String(j.servers.filter(s=>s.dialect==="postgres").length >= 1)')" "true"
expect "files outside the roots → 403" "$(curl -s -o /dev/null -w '%{http_code}' "$B/files?dir=/etc")" "403"
expect "files inside the root lists a directory" "$(curl -s "$B/files?dir=$PWD" | json 'Array.isArray(j)')" "true"
expect "create file → 201" "$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "$J" -d "{\"dir\":\"$PWD\",\"name\":\"smoke-tmp\"}" "$B/files")" "201"
MTIME=$(curl -s -X PUT -H "$J" -d "{\"path\":\"$PWD/smoke-tmp.sql\",\"content\":\"select 1;\"}" "$B/files/content" | json 'j.modifiedAt')
expect "read back what was written" "$(curl -s "$B/files/content?path=$PWD/smoke-tmp.sql" | json 'j.content')" "select 1;"
expect "stale save → 409" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$J" -d "{\"path\":\"$PWD/smoke-tmp.sql\",\"content\":\"x\",\"ifModifiedAt\":\"2000-01-01T00:00:00.000Z\"}" "$B/files/content")" "409"
expect "fresh save → 200" "$(curl -s -o /dev/null -w '%{http_code}' -X PUT -H "$J" -d "{\"path\":\"$PWD/smoke-tmp.sql\",\"content\":\"select 2;\",\"ifModifiedAt\":\"$MTIME\"}" "$B/files/content")" "200"
expect "delete file → ok" "$(curl -s -X DELETE "$B/files?path=$PWD/smoke-tmp.sql" | json 'j.ok')" "true"
curl -s -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"select id from orders limit 1\",\"runId\":\"r-probe\",\"record\":false}" "$B/query/sync" >/dev/null
expect "record:false run stays out of history" "$(curl -s "$B/history?limit=1000" | json 'String(j.some(r=>r.id==="r-probe"))')" "false"
expect "record:false run is still in the run log" "$(curl -s "$B/runs/r-probe" | json 'j.id')" "r-probe"
RO_STREAM=$(curl -s -N -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"insert into orders (status, total_cents) values ('smoke', 1)\",\"readOnly\":true}" "$B/query")
expect "readOnly:true insert yields one error event" "$(echo "$RO_STREAM" | grep -c '"type":"error"')" "1"
expect "readOnly:true insert is refused as read-only" "$(echo "$RO_STREAM" | grep '"type":"error"' | json 'j.error.code')" "25006"
RO_SYNC=$(curl -s -X POST -H "$J" -d "{\"connectionId\":\"$CID\",\"sql\":\"select id, status, id + 1 as n from orders limit 1\",\"readOnly\":true}" "$B/query/sync")
expect "readOnly:true select returns a row" "$(echo "$RO_SYNC" | json 'j.status + ":" + j.results[0].rowCount')" "done:1"
expect "plain column names its source, expression has none" "$(echo "$RO_SYNC" | json 'j.results[0].columns[1].source.table + "." + j.results[0].columns[1].source.column + ":" + typeof j.results[0].columns[2].source')" "orders.status:undefined"
expect "settings update persists" "$(curl -s -X PUT -H "$J" -d '{"maxRows":500}' "$B/settings" | json 'j.maxRows')" "500"
expect "history has the runs" "$(curl -s "$B/history?limit=2" | json 'j.length')" "2"
expect_has "status sees the server" "running" "$($CLI status)"

echo "== $FAILED failure(s)"
[ "$FAILED" -eq 0 ]
