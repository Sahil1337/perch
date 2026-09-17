"use client";

// The pulse runs FK → PK, the direction a lookup goes. It runs on every wire on screen, all the
// time, at a pace slow enough to read as travel; selecting a table dims everything that does not
// touch it.

import type * as React from "react";
import { cn } from "../../lib/utils";
import type { Wire } from "./wires";

/** How long one pulse takes to cross a wire, in seconds. Matches `--animate-wire-pulse`. */
const TRAVEL_S = 2.4;
/** Pulses are staggered across this many phases so the picture does not blink in unison. */
const PULSE_PHASES = 6;
/** Fraction of a wire the pulse covers. The keyframe's starting offset is `1 + PULSE_LEN`. */
const PULSE_LEN = 0.14;

/**
 * `idle` is the resting picture. Hovering a table lights its wires and mutes the rest; selecting one
 * hides the rest outright and stops their pulses, so what is left is only what joins to it.
 */
export type WireState = "idle" | "lit" | "muted" | "hidden";

export function WirePath({
  animate,
  index,
  paused,
  state,
  wire,
}: {
  animate: boolean;
  index: number;
  /** Hold the pulse where it is. Paused rather than removed, so the wire does not lose its phase
   *  — and so a gesture neither starts nor ends with every pulse on screen jumping. */
  paused: boolean;
  state: WireState;
  wire: Wire;
}): React.ReactElement {
  const { edge, d, start, startDir, end, endDir } = wire;
  const label = `${edge.from}.${edge.fk.columns.join(", ")} → ${edge.to}.${edge.fk.refColumns.join(", ")}`;
  const lit = state === "lit";

  return (
    <g
      className={cn(
        "transition-opacity duration-200",
        state === "muted" && "opacity-25",
        state === "hidden" && "opacity-0",
      )}
    >
      <title>{label}</title>
      {/* The wire itself. */}
      <path
        className={cn("transition-colors", lit ? "stroke-foreground/60" : "stroke-border")}
        d={d}
        fill="none"
        strokeWidth={1.5}
      />
      {/* The pulse: a dash one PULSE_LEN long on a path normalised to 1, walked one period per
          cycle by the `wire-pulse` keyframe in styles.css, so exactly one pulse is on the wire at
          a time. A CSS animation per wire, nothing on the main thread; the negative delay staggers
          the phases and means no wire starts empty. */}
      {animate && (
        <path
          className={cn(
            "animate-wire-pulse transition-colors",
            // `paused` sets `animation-play-state: paused` and comes from tw-animate-css, which
            // styles.css imports; the linter cannot see it because this package has no Tailwind
            // entry point of its own. Same false positive as `transition-width` in
            // `resizable-sidebar.tsx`.
            // eslint-disable-next-line shadcn/no-unknown-classes
            paused && "paused",
            lit ? "stroke-info" : "stroke-info/70",
          )}
          d={d}
          fill="none"
          pathLength={1}
          strokeDasharray={`${PULSE_LEN} 1`}
          strokeLinecap="round"
          strokeWidth={2}
          style={
            {
              "--wire-delay": `${-((index % PULSE_PHASES) * (TRAVEL_S / PULSE_PHASES))}s`,
            } as React.CSSProperties
          }
        />
      )}
      {/* Crow's foot at the referencing end: many rows can hold the same key. */}
      <path
        className={cn("transition-colors", lit ? "stroke-foreground/60" : "stroke-border")}
        d={`M ${start.x + startDir * 9} ${start.y} L ${start.x} ${start.y - 5} M ${start.x + startDir * 9} ${start.y} L ${start.x} ${start.y + 5}`}
        fill="none"
        strokeWidth={1.5}
      />
      {/* A bar at the referenced end: one row is the key. */}
      <path
        className={cn("transition-colors", lit ? "stroke-foreground/60" : "stroke-border")}
        d={`M ${end.x + endDir * 7} ${end.y - 5} L ${end.x + endDir * 7} ${end.y + 5}`}
        fill="none"
        strokeWidth={1.5}
      />
    </g>
  );
}
