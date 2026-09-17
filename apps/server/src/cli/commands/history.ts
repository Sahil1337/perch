// `perch history [--limit 20] [--conn name]`

import { readHistory } from "../../storage/index.js";
import { defineCommand, dim, oneLine, printJson, requireConnection } from "../util/index.js";

const HISTORY_HELP = "usage: perch history [--limit 20] [--conn <name>] [--json]";

export const cmdHistory = defineCommand(
  {
    usage: HISTORY_HELP,
    options: { limit: { type: "string" }, conn: { type: "string" } },
  },
  async ({ values, json }) => {
    const connectionId = values.conn ? (await requireConnection(values.conn)).id : undefined;
    const limit = values.limit !== undefined ? Number(values.limit) : 20;

    const records = await readHistory(limit, connectionId);
    if (json) {
      printJson(records);
      return;
    }
    if (records.length === 0) {
      console.log("no history yet");
      return;
    }
    for (const r of records) {
      const rows = r.results?.reduce((n, res) => n + res.rowCount, 0) ?? 0;
      const dur = r.durationMs !== undefined ? `${r.durationMs} ms` : "?";
      console.log(
        `${r.startedAt}  ${r.status.padEnd(9)}  ${dur.padStart(8)}  ${String(rows).padStart(6)} rows  ${dim(oneLine(r.sql))}`,
      );
    }
  },
);
