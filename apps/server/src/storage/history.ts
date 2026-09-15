// history.jsonl — append-only run log, newest last. Rows are stripped before they hit the disk:
// history remembers the shape and the counts of a run, never its data.

import { promises as fs } from "node:fs";
import path from "node:path";
import { type RunRecord } from "@perch/protocol";
import { HISTORY_FILE, ensureDir } from "./paths.js";

export async function appendHistory(record: RunRecord): Promise<void> {
  const dir = await ensureDir();
  // Keep history light: no result rows on disk, only shape + counts.
  const slim: RunRecord = {
    ...record,
    results: record.results?.map((r) => ({ ...r, rows: [] })),
  };
  await fs.appendFile(path.join(dir, HISTORY_FILE), JSON.stringify(slim) + "\n", { mode: 0o600 });
}

export async function readHistory(limit = 100, connectionId?: string): Promise<RunRecord[]> {
  const dir = await ensureDir();
  let text: string;
  try {
    text = await fs.readFile(path.join(dir, HISTORY_FILE), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: RunRecord[] = [];
  const lines = text.split("\n").filter(Boolean);
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
    try {
      const rec = JSON.parse(lines[i]!) as RunRecord;
      if (!connectionId || rec.connectionId === connectionId) out.push(rec);
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}
