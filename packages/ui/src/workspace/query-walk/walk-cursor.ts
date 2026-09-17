"use client";

// Where playback can BE, and where it goes next.
//
// None of this is about rendering: it is arithmetic over the program's sections and the state of
// each of their stations, and the only reason it used to live inside the player was that both of
// its inputs did. As seven chained `useCallback`s it was also seventy lines of dependency arrays
// that had to be right, over two values that change together — so the whole thing is rebuilt at
// once when they do, and nothing in between has a dependency to get wrong.

import { phasesFor } from "./narration";
import { runsPerRow, type SectionRun, type StationState } from "./use-walk";

export type Pos = { section: number; station: number; phase: number };

/**
 * A section with no station walk still gets a beat of playback. Skipping past it silently would say
 * it is not part of the query, which is the one thing the placeholder it shows exists to deny.
 *
 * A `per-row` section is the exception and is NOT on this clock: it has a timeline of its own, one
 * beat per outer row, and it says when it is finished by calling `onDone`. Marching past it after
 * 2.2 seconds would cut it off in the middle of the only thing it exists to show.
 */
export const HOLD_PHASE = [{ ms: 2200, label: "not run" }] as const;

const NO_STATES: readonly StationState[] = [];

/** The walk to step through, or null when the section holds a placeholder instead of running. */
export function walkOf(run: SectionRun | undefined): SectionRun["walk"] {
  return run && !runsPerRow(run.status) ? run.walk : null;
}

export class WalkCursor {
  constructor(
    private readonly sections: readonly SectionRun[],
    /** Every section's station states, not just the open one: stepping out of the end of a chapter
     *  has to know which station the next chapter starts on before it gets there. */
    private readonly states: readonly (readonly StationState[])[],
  ) {}

  statesAt(section: number): readonly StationState[] {
    return this.states[section] ?? NO_STATES;
  }

  runAt(section: number): SectionRun | undefined {
    return this.sections[section];
  }

  walkAt(section: number): SectionRun["walk"] {
    return walkOf(this.sections[section]);
  }

  phaseCount(section: number, station: number): number {
    const walk = this.walkAt(section);
    if (!walk || !walk.stations[station]) return HOLD_PHASE.length;
    return phasesFor(station, walk, this.states[section]?.[station] ?? "loading").length;
  }

  /** The position clamped to what actually exists: a section's walk can be shorter than the one
   *  before it, and a station's phase count changes the moment its results land. */
  clamp(pos: Pos): Pos {
    const section = Math.min(pos.section, this.sections.length - 1);
    const walk = this.walkAt(section);
    const station = Math.min(pos.station, Math.max(0, (walk?.stations.length ?? 0) - 1));
    const phase = Math.min(pos.phase, this.phaseCount(section, station) - 1);
    return { section, station, phase };
  }

  /** Where playback lands when it enters a chapter from either end. */
  enter(section: number, edge: "start" | "end"): Pos {
    if (edge === "start") {
      return { section, station: this.edgePlayable(section, "first") ?? 0, phase: 0 };
    }
    const station = this.edgePlayable(section, "last");
    if (station === null) return { section, station: 0, phase: 0 };
    return { section, station, phase: this.phaseCount(section, station) - 1 };
  }

  ahead(at: Pos): Pos | null {
    if (at.phase < this.phaseCount(at.section, at.station) - 1) {
      return { ...at, phase: at.phase + 1 };
    }
    const next = this.stepPlayable(at.section, at.station, 1);
    if (next !== null) return { section: at.section, station: next, phase: 0 };
    // The chapter is finished. This is the section boundary: the next one opens at its first
    // playable station, and the program's order guarantees its inputs already ran.
    return at.section + 1 < this.sections.length ? this.enter(at.section + 1, "start") : null;
  }

  behind(at: Pos): Pos | null {
    if (at.phase > 0) return { ...at, phase: at.phase - 1 };
    const prev = this.stepPlayable(at.section, at.station, -1);
    if (prev !== null) {
      return { section: at.section, station: prev, phase: this.phaseCount(at.section, prev) - 1 };
    }
    return at.section > 0 ? this.enter(at.section - 1, "end") : null;
  }

  private playable(section: number, station: number): boolean {
    const state = this.states[section]?.[station];
    return state === "ready" || state === "loading";
  }

  private edgePlayable(section: number, from: "first" | "last"): number | null {
    const n = this.states[section]?.length ?? 0;
    for (let k = 0; k < n; k++) {
      const i = from === "first" ? k : n - 1 - k;
      if (this.playable(section, i)) return i;
    }
    return null;
  }

  private stepPlayable(section: number, from: number, delta: 1 | -1): number | null {
    const n = this.states[section]?.length ?? 0;
    for (let k = from + delta; k >= 0 && k < n; k += delta) if (this.playable(section, k)) return k;
    return null;
  }
}
