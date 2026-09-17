// The walk's clock: how long each phase of a station holds, and how many phases a station has.
//
// The numbers here are a rhythm rather than a set of timeouts, and the comments are the record of
// what each one was tuned against. Nothing below is read by anything but the player.

import type { BoundRow } from "../bound";
import { windowFunctions } from "../steps";
import type { StationState, WalkData } from "../use-walk";

export type Phase = { readonly ms: number; readonly label: string };

/**
 * Gap between one row's test and the next, in WHERE and HAVING.
 *
 * This is the walk's most-watched gesture — a row being measured against the predicate, one after
 * another — so it is paced to be followed rather than to be got through. At 110ms a twelve-row card
 * was over in 1.3 seconds, which is long enough to see THAT rows were tested and too short to see
 * WHICH ones failed.
 */
export const STAGGER_MS = 150;
/**
 * Rest on a station's settled state before playback moves on.
 *
 * Dead time by definition: nothing moves during it, it exists so a settled card can be read before
 * it is replaced. It used to be a full second, and a second of stillness after every station is
 * most of what made the walk feel like it was waiting rather than explaining — so it is roughly
 * halved, and the time goes to the gestures in `walk-motion.ts` instead. The rest of the pause a
 * reader feels is inside the phases themselves, and shortening those is what `BEAT` must not do.
 */
export const HOLD_MS = 560;

/**
 * The walk's tempo: what turns every phase length below into wall-clock time.
 *
 * The numbers in `phasesFor` are a RHYTHM — 700ms for a glance, 1.7s for the step that earns the
 * most attention — and this is the one place that decides how fast that rhythm is played, so the
 * proportions between stations survive a change of pace.
 *
 * Above 1 because a beat has to outlast the motion inside it. Rows stagger in or out across
 * `STAGGER_WINDOW_S` and then fade or fold, and the shortest phases here are 700ms: at a tempo of 1
 * the next scene arrived while the last gesture was still finishing, so motion interrupted it. What
 * that looks like is not "fast", it is "broken".
 *
 * Raising this ALONE does not make the walk feel slower, which is worth knowing before reaching for
 * it: it lengthens the pause between gestures, not the gestures, so a station that flashed its rows
 * in and then waited just waits longer. The pace a reader actually feels is set by the stagger —
 * see `staggerDelay` — and this number exists to keep the beat long enough to hold it.
 *
 * Which is why it did NOT change when the walk was slowed down to be studied. The gestures grew
 * instead (`walk-motion.ts`), so they now fill about 0.93s of this 1.015s beat where they used to
 * fill 0.67s — the motion got longer and the dead tail at the end of every phase got shorter, from
 * the same number. Lower this to close the gap further and the gestures get cut off instead; the
 * pause that is actually safe to shorten is `HOLD_MS`.
 */
export const BEAT = 1.45;

/**
 * One outer row's turn before playback binds the next.
 *
 * `HOLD_MS` is the rest every station takes on its settled state, and two row staggers is how long
 * the inner card's rows take to finish arriving, so a row holds for exactly as long as it takes to
 * look at. The speed control divides it the same way it divides every other schedule here.
 */
export const ROW_HOLD_MS = HOLD_MS + STAGGER_MS * 2;

/** Each phase of a station: how long it holds before the next (ms, at 1x) and a short label. */
export function phasesFor(index: number, walk: WalkData, state: StationState): Phase[] {
  const station = walk.stations[index]!;
  if (state === "absent") return [{ ms: 800, label: "skipped" }];
  if (state === "loading") return [{ ms: 800, label: "loading" }];
  if (state === "failed") return [{ ms: 800, label: "failed" }];
  const result = walk.results[index];
  const rows = (id: string): number => {
    const outcome = result?.queries[id];
    return outcome?.ok ? outcome.result.rows.length : 0;
  };
  switch (station.id) {
    // One phase, because there is one thing to see. A result-only section has no before and after
    // to cut between: the rows arrive whole or not at all.
    case "result":
      return [{ ms: 1600, label: "the rows it produces" }];
    // The two sides, then the regions they share, then what the operator kept. An `ALL` station
    // asks for no regions — see `buildSetStations` — so it simply does not get that beat.
    case "combine":
      return station.batches.length > 1
        ? [
            { ms: 1200, label: "the two results" },
            { ms: 1600, label: "what they share" },
            { ms: 1400, label: "what the operator kept" },
          ]
        : [
            { ms: 1200, label: "the two results" },
            { ms: 1400, label: "what the operator kept" },
          ];
    case "from":
      return [{ ms: 700, label: "raw tables" }];
    case "join": {
      const kind = station.join?.kind ?? "inner";
      const settled =
        kind === "inner"
          ? "unmatched rows dropped"
          : kind === "cross"
            ? "every pair kept"
            : "unmatched rows kept";
      return [
        { ms: 1200, label: "matching keys" },
        { ms: 1000, label: "rows paired" },
        { ms: 800, label: settled },
      ];
    }
    case "where": {
      const n = rows("verdict") || rows("sample");
      return [
        { ms: n * STAGGER_MS + 700, label: `testing ${n} rows` },
        { ms: 900, label: "failing rows removed" },
      ];
    }
    case "group": {
      const keys = walk.parsed?.groupKeys.join(", ") ?? "";
      return [
        { ms: 1000, label: `sorting by ${keys}` },
        { ms: 1300, label: "gathering into buckets" },
        { ms: 1700, label: "one row per bucket" },
      ];
    }
    case "having": {
      const n = rows("verdict") || rows("sample");
      return [
        { ms: n * STAGGER_MS + 700, label: `testing ${n} groups` },
        { ms: 900, label: "failing groups removed" },
      ];
    }
    case "window": {
      const fn = walk.parsed ? windowFunctions(walk.parsed)[0] : undefined;
      const keys = fn?.partition.join(", ") ?? "";
      return [
        { ms: 1300, label: keys ? `panes by ${keys}` : "one pane, every row" },
        { ms: 1600, label: "a value for every row" },
      ];
    }
    case "select": {
      const phases: Phase[] = [
        { ms: 900, label: "dropping unused columns" },
        { ms: 900, label: "naming the output" },
      ];
      // The branch phase is only worth playing when the probe that knows which branch won came
      // back; without it the stage would hold on the phase before it and say nothing new.
      if (result?.queries.case?.ok) phases.push({ ms: 1500, label: "which branch won" });
      return phases;
    }
    case "distinct":
      return [
        { ms: 900, label: "finding duplicates" },
        { ms: 900, label: "duplicates merged" },
      ];
    case "order":
      return [
        { ms: 900, label: "sort key" },
        { ms: 1000, label: "sorted" },
      ];
    case "limit":
      return [
        { ms: 900, label: "cut line" },
        { ms: 900, label: "rest dropped" },
      ];
  }
}

/** One beat per outer row, labelled the way the phase caption above a station's sentence is. */
export function boundPhases(rows: readonly BoundRow[]): Phase[] {
  return rows.map((row, index) => ({
    ms: ROW_HOLD_MS,
    label:
      row.matches === null
        ? `row ${index + 1} of ${rows.length} · ${row.pass ? "passes" : "fails"}`
        : `row ${index + 1} of ${rows.length} · ${row.matches} ${row.matches === 1 ? "match" : "matches"}`,
  }));
}
