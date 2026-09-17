// `perch run <conn> (<file.sql> | -e "<sql>" | -)` — no HTTP server involved, but the run itself
// goes through the same QueryRunner the API uses, so history, truncation and the settings defaults
// mean one thing in both. This file owns only the printing: each statement's result as it arrives,
// a caret under an error's position, and exit 1 when the run did not finish clean.

import { readFile } from "node:fs/promises";
import type { QueryError, RunEvent, RunRecord, StatementResult } from "@perch/protocol";
import { createServices } from "../../server/services/create-services.js";
import { format, footer, type OutputFormat } from "../output/format.js";
import { defineCommand, die, dim, readStdin, red, requireConnection } from "../util/index.js";

const RUN_HELP = `usage: perch run <conn> <file.sql>          run a .sql file
       perch run <conn> -e "<sql>"          run an inline statement
       perch run <conn> -                   run sql piped on stdin

options:
  --database <db>     database to run against (default: the connection's configured database)
  --format <fmt>       table (default) | json | csv | ndjson
  --max-rows <n>       rows to keep per statement before truncating (default 1000)
  --timeout <ms>       server-side statement timeout in ms (0 = none)
`;

function isFormat(s: string): s is OutputFormat {
  return s === "table" || s === "json" || s === "csv" || s === "ndjson";
}

function printCaret(sql: string, position: number): void {
  let idx = 0;
  for (const line of sql.split("\n")) {
    const lineLen = line.length + 1; // account for the stripped "\n"
    if (position < idx + lineLen) {
      const col = Math.max(0, position - idx);
      console.error(line);
      console.error(`${" ".repeat(col)}^`);
      return;
    }
    idx += lineLen;
  }
}

function printError(error: QueryError, sql?: string): void {
  console.error(red(`error: ${error.message}`));
  if (error.code) console.error(dim(`  code: ${error.code}`));
  if (error.detail) console.error(dim(`  detail: ${error.detail}`));
  if (error.hint) console.error(dim(`  hint: ${error.hint}`));
  if (sql !== undefined && error.position !== undefined) printCaret(sql, error.position);
}

function printResult(result: StatementResult, fmt: OutputFormat): void {
  const isData = result.columns.length > 0;
  if (!isData) {
    const affected = result.affectedRows ?? 0;
    console.log(
      `${result.command ?? "OK"}  ${dim(`(${affected} row${affected === 1 ? "" : "s"} affected · ${result.durationMs} ms)`)}`,
    );
  } else {
    console.log(format(fmt, result.columns, result.rows));
    if (fmt === "table")
      console.log(dim(footer(result.rowCount, result.durationMs, result.truncated)));
  }
  for (const notice of result.notices) console.error(dim(`NOTICE: ${notice}`));
}

export const cmdRun = defineCommand(
  {
    usage: RUN_HELP,
    positionals: ["conn"],
    options: {
      execute: { type: "string", short: "e" },
      database: { type: "string" },
      format: { type: "string" },
      "max-rows": { type: "string" },
      timeout: { type: "string" },
    },
  },
  async ({ values, positionals }) => {
    let sql: string;
    if (values.execute !== undefined) {
      sql = values.execute;
    } else {
      const source = positionals[1];
      if (!source) die(RUN_HELP.trimEnd());
      sql = source === "-" ? await readStdin() : await readFile(source, "utf8");
    }

    const fmtRaw = values.format ?? "table";
    if (!isFormat(fmtRaw)) die(`--format must be one of table|json|csv|ndjson (got "${fmtRaw}")`);
    const fmt = fmtRaw;
    const maxRows = values["max-rows"] !== undefined ? Number(values["max-rows"]) : undefined;
    const timeoutMs = values.timeout !== undefined ? Number(values.timeout) : undefined;

    const conn = await requireConnection(positionals[0]!);
    const statementSql = new Map<number, string>();
    const emit = (ev: RunEvent): void => {
      switch (ev.type) {
        case "statement":
          statementSql.set(ev.index, ev.sql);
          break;
        case "result":
          printResult(ev.result, fmt);
          break;
        case "error":
          printError(ev.error, statementSql.get(ev.index));
          break;
        default:
          break;
      }
    };

    // A throwaway set of services: the pool holds the one driver this run needs, and shutting it
    // down afterwards is what closes the connection.
    const { pool, runner } = createServices();
    let record: RunRecord;
    try {
      record = await runner.startRun(
        {
          connectionId: conn.id,
          sql,
          database: values.database,
          maxRows,
          timeoutMs,
          source: "cli",
        },
        emit,
      );
    } finally {
      await pool.shutdown();
    }

    if (record.status === "error" || record.status === "cancelled") process.exitCode = 1;
  },
);
