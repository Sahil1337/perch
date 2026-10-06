// Which tabs hold a transaction open, read off the runs rather than kept beside them. A run with a
// session key says what the key holds once it finished (`RunRecord.transaction`); the server says
// when one ended without a run (a `transaction` event), which marks that run closed.

import type { RunRecord, TransactionState } from "@perch/protocol";

export type HeldTransaction = {
  readonly sessionKey: string;
  readonly connectionId: string;
  readonly database: string;
  readonly state: TransactionState;
  /** When the run that opened it started. */
  readonly since: string;
};

/** Where the server keeps a key's transaction: one per connection and database. */
export const heldSlot = (connectionId: string, database: string, sessionKey: string): string =>
  `${connectionId}\u0000${database}\u0000${sessionKey}`;

/**
 * What each key holds, where. Per slot the run that finished last decides: runs with one key take
 * turns on the server, and one turned away as busy finishes before the run it waited on. Runs still
 * waiting for their answer (`inFlight`) have no say yet.
 */
export function heldTransactions(
  runs: readonly RunRecord[],
  keyOf: ReadonlyMap<string, string>,
  inFlight: ReadonlySet<string>,
  closed: ReadonlySet<string>,
): readonly HeldTransaction[] {
  const bySlot = new Map<string, { sessionKey: string; runs: RunRecord[] }>();
  for (const run of runs) {
    const sessionKey = keyOf.get(run.id);
    if (sessionKey === undefined || inFlight.has(run.id) || !run.finishedAt) continue;
    const slot = heldSlot(run.connectionId, run.database, sessionKey);
    const entry = bySlot.get(slot) ?? { sessionKey, runs: [] };
    entry.runs.push(run);
    bySlot.set(slot, entry);
  }

  const held: HeldTransaction[] = [];
  for (const { sessionKey, runs: finished } of bySlot.values()) {
    finished.sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));
    const [latest] = finished;
    if (!latest?.transaction || closed.has(latest.id)) continue;
    // Back through the runs that found it open, to the one that opened it.
    let since = latest.startedAt;
    for (const run of finished) {
      if (!run.transaction || closed.has(run.id)) break;
      since = run.startedAt;
    }
    held.push({
      sessionKey,
      connectionId: latest.connectionId,
      database: latest.database,
      state: latest.transaction,
      since,
    });
  }
  return held;
}

/** The run a `transaction` event is about: the last one to finish in that slot. */
export function latestInSlot(
  runs: readonly RunRecord[],
  keyOf: ReadonlyMap<string, string>,
  inFlight: ReadonlySet<string>,
  slot: string,
): RunRecord | undefined {
  let latest: RunRecord | undefined;
  for (const run of runs) {
    const sessionKey = keyOf.get(run.id);
    if (sessionKey === undefined || inFlight.has(run.id) || !run.finishedAt) continue;
    if (heldSlot(run.connectionId, run.database, sessionKey) !== slot) continue;
    if (!latest || run.finishedAt > (latest.finishedAt ?? "")) latest = run;
  }
  return latest;
}
