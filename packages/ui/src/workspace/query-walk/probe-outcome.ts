// What came back from one probe, and the two readings of it every caller needs.
//
// `useProgram`, `useBoundRun` and `useGridRun` all send SQL and all have to answer the same two
// questions about what came back — what went wrong, and what the one statement returned — so the
// answers live here rather than three times over.

import type { RunRecord, StatementResult } from "@perch/protocol";

export type QueryOutcome =
  | { readonly ok: true; readonly result: StatementResult }
  | { readonly ok: false; readonly error: string; readonly skipped: boolean };

/**
 * What to show a reader when something threw.
 *
 * `String(error)` put `[object Object]` in front of people whenever a driver rejected with a plain
 * object, which is a message about our own plumbing rather than about their query. An `Error` has a
 * message, a string IS one, and anything else has nothing worth showing, so it gets the fallback.
 */
export function messageOf(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : fallback;
}

/** The first statement's result, or the reason there is none. */
export function only(record: RunRecord): QueryOutcome {
  const result = record.results?.[0];
  if (result) return { ok: true, result };
  return {
    ok: false,
    error: record.error?.message ?? "The database returned nothing.",
    skipped: false,
  };
}
