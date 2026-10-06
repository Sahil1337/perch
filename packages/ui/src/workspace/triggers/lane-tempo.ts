// The lane's clock: how long each step holds before the next one plays.
//
// These are a rhythm, not timeouts. The steps that carry the lesson — a trigger running, a trigger
// being passed over, and why — hold longest; the punctuation between them (a row starting, the
// statement ending) holds shortest. Nothing but `use-lane-playback.ts` and the pulse read them.

import type { StepKind } from "./lane-playback";

/**
 * A trigger running. The longest beat, because it is the event the lane exists to show: long
 * enough to find the lit card, read its name, and see the same name land in "What ran".
 */
export const FIRE_MS = 640;

/**
 * A trigger passed over. Nearly as long as a fire, because the reason on the card ("status not
 * set", "off") is the part people get wrong, but a little shorter, because nothing ran.
 */
export const SKIP_MS = 560;

/**
 * Postgres writing the row. The hinge between before and after, but the only thing to read is a
 * chip saying which row, so it does not need a fire's length.
 */
export const WRITE_MS = 480;

/** A row starting, the statement starting or ending: punctuation. */
export const STEP_MS = 420;

/**
 * How long the pulse takes to travel from one column to the next.
 *
 * Must stay under `STEP_MS`, the shortest beat: the pulse moves when a step lands, so a travel that
 * outlasts the step is interrupted by the next one and reads as a stutter rather than as a move.
 * Shorten `STEP_MS` below this and the pulse starts getting cut off.
 */
export const PULSE_MS = 380;

/**
 * Every step under reduced motion. With no pulse and no fades a step is a cut, so each one holds
 * the same, and long enough to find what changed without a gesture drawing the eye to it.
 */
export const REDUCED_STEP_MS = 700;

/**
 * Two rows is the fewest that shows the point: each row's BEFORE ROW triggers run just before it is
 * written, but the AFTER ROW triggers wait until every row is. One row cannot show the wait.
 */
export const DEFAULT_ROWS = 2;

/** The rows picker offers 1 to this. Past three, more rows repeat the lesson without adding to it. */
export const MAX_ROWS = 3;

/**
 * The pause between the view opening and playback starting on its own. Long enough for the
 * dialog's 200ms entrance and a glance at the lane at rest, so the motion reads as the statement
 * running rather than as the view still arriving.
 */
export const AUTOPLAY_DELAY_MS = 700;

export function stepMs(kind: StepKind, reduced: boolean): number {
  if (reduced) return REDUCED_STEP_MS;
  switch (kind) {
    case "fire":
    case "defer":
      return FIRE_MS;
    case "skip":
    case "unhandled":
      return SKIP_MS;
    case "write":
      return WRITE_MS;
    default:
      return STEP_MS;
  }
}
