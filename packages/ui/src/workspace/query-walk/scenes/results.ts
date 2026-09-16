// Reading the step results: pulling a sample, an error or a count out of what a station's queries
// came back with, and the row counts a station starts from and leaves behind.

import type { StatementResult } from "@perch/protocol";
import type { Station } from "../steps";
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

export function sampleId(station: Station): string {
  return station.id === "from" ? "src0.sample" : "sample";
}
function countId(station: Station): string {
  return station.id === "from" ? "src0.count" : "count";
}

export function sampleOf(walk: WalkData, index: number): StatementResult | null {
  const station = walk.stations[index];
  return station ? okResult(walk.results[index], sampleId(station)) : null;
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
      const { limitValue, offsetValue } = walk.parsed;
      if (input === null) return null;
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
