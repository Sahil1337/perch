// The in-memory record of recent runs, so /api/runs/:id and the exports can serve rows the
// on-disk history deliberately drops. Bounded: the oldest run falls out once the cap is reached.

import type { RunRecord } from "@perch/protocol";

export const DEFAULT_MAX_RUNS = 50;

/** A copy of the record whose statement results carry counts but no row data. */
export function stripRows(record: RunRecord): RunRecord {
  if (!record.results) return { ...record };
  return { ...record, results: record.results.map((result) => ({ ...result, rows: [] })) };
}

export class RunLog {
  readonly maxRuns: number;
  private readonly runs = new Map<string, RunRecord>();

  constructor(maxRuns: number = DEFAULT_MAX_RUNS) {
    this.maxRuns = maxRuns;
  }

  /**
   * Remembers a run and evicts the oldest ones. Runs are remembered in the order they start, and
   * `Map` preserves insertion order, so the first key is always the oldest run — no scan needed.
   */
  remember(record: RunRecord): void {
    this.runs.set(record.id, record);
    while (this.runs.size > this.maxRuns) {
      const oldest = this.runs.keys().next().value;
      if (oldest === undefined || oldest === record.id) break;
      this.runs.delete(oldest);
    }
  }

  get(runId: string): RunRecord | undefined {
    return this.runs.get(runId);
  }

  /** Newest first, without result rows (rows come from `get`). */
  list(): RunRecord[] {
    return [...this.runs.values()]
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
      .map(stripRows);
  }
}
