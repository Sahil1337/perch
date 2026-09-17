// Reading the step results: pulling a sample, an error or a count out of what a station's queries
// came back with, and the row counts a station starts from and leaves behind.

import type { StatementResult } from "@perch/protocol";
import type { KeyPair } from "../clauses";
import { countId, sampleId, type Station } from "../steps";

/** Defined in `steps.ts`, beside the builders that spell these ids; re-exported here because this is
 *  where every reader of a station's results looks for them. */
export { sampleId };
import type { StationResult, WalkData } from "../use-walk";

export function okResult(result: StationResult | undefined, id: string): StatementResult | null {
  const outcome = result?.queries[id];
  return outcome?.ok ? outcome.result : null;
}

export function errorOf(result: StationResult | undefined, id: string): string | null {
  const outcome = result?.queries[id];
  return outcome && !outcome.ok ? outcome.error : null;
}

/** The number a `select count(*)` came back with, or null when it failed or is not there yet. */
export function countValue(result: StationResult | undefined, id: string): number | null {
  const value = okResult(result, id)?.rows[0]?.[0];
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sampleOf(walk: WalkData, index: number): StatementResult | null {
  const station = walk.stations[index];
  return station ? okResult(walk.results[index], sampleId(station)) : null;
}

/**
 * The columns a join matches on: the pairs written in its ON or USING clause, or, for a NATURAL
 * JOIN, the ones it turns out to have found. Null while a natural join's two sides are still in
 * flight, which is not the same answer as "none" and must not be narrated as one.
 *
 * A natural join is the only join whose condition is absent from the query. It matches on every
 * column name the two sides share, so the condition depends on what the left side happens to be
 * CARRYING by the time the join runs — and the left side of a second join is the output of the
 * first. A column that arrives up there, from an earlier join or a widening `select *`, silently
 * joins these two tables on one more thing, and the query keeps running and answers wrongly. That
 * is the one fact this walk can show and the text cannot, so it is read off the samples.
 */
export function joinKeys(
  walk: WalkData,
  index: number,
  station: Station,
): readonly KeyPair[] | null {
  const join = station.join;
  if (!join) return [];
  if (!join.natural) return join.keys;
  const previous = previousIndex(walk, index);
  const left = previous === null ? null : sampleOf(walk, previous);
  // Every source is sampled once, by the FROM station at index 0 — `src0` is the first source and
  // `src{n+1}` is the one join n brings in. The join stations read theirs from there too.
  const right = okResult(walk.results[0], `src${station.joinIndex + 1}.sample`);
  if (!left || !right) return null;
  // By name, and only by name: that is the whole of the rule, types and tables included or not.
  const shared = new Set(right.columns.map((column) => column.name.toLowerCase()));
  const keys: KeyPair[] = [];
  for (const column of left.columns) {
    const name = column.name.toLowerCase();
    if (!shared.has(name)) continue;
    // A name the left side carries twice is ambiguous, and a database refuses the join outright
    // rather than picking one. Listing it twice here would be the walk disagreeing with the error.
    shared.delete(name);
    keys.push({ left: column.name, right: column.name });
  }
  return keys;
}

/** The nearest earlier station whose sample came back: what the rows looked like before this one. */
export function previousIndex(walk: WalkData, index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (walk.stations[i]!.present && sampleOf(walk, i)) return i;
  }
  return null;
}

/** The row count a station leaves behind. SELECT and ORDER BY inherit; LIMIT computes. */
export function countAt(walk: WalkData, index: number): number | null {
  const station = walk.stations[index];
  if (!station || !station.present) return null;
  switch (station.id) {
    case "select":
    case "order": {
      const previous = previousIndex(walk, index);
      return previous === null ? null : countAt(walk, previous);
    }
    case "limit": {
      const previous = previousIndex(walk, index);
      const input = previous === null ? null : countAt(walk, previous);
      const sample = sampleOf(walk, index);
      if (!sample) return null;
      if (!sample.truncated) return sample.rowCount;
      // Only a walk with clauses ever has a LIMIT station, so this is a guard on the type rather
      // than a case that happens.
      if (walk.parsed === null || input === null) return null;
      const { limitValue, offsetValue } = walk.parsed;
      const after = Math.max(0, input - (offsetValue ?? 0));
      return limitValue === null ? after : Math.min(limitValue, after);
    }
    default:
      return countValue(walk.results[index], countId(station));
  }
}

/** The row count the station starts from: what the station before it left behind. */
export function inputCount(walk: WalkData, index: number): number | null {
  const previous = previousIndex(walk, index);
  return previous === null ? null : countAt(walk, previous);
}
