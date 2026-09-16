"use client";

// The pulse runs FK → PK, the direction a lookup goes. It runs on every wire, all the time, at a
// pace slow enough to read as travel; selecting a table dims everything that does not touch it.

import { motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import type { Wire } from "./wires";

/** How long one pulse takes to cross a wire, in seconds. */
const TRAVEL_S = 2.4;
/** Fraction of a wire the pulse covers. */
const PULSE_LEN = 0.14;

/**
 * `idle` is the resting picture. Hovering a table lights its wires and mutes the rest; selecting one
 * hides the rest outright and stops their pulses, so what is left is only what joins to it.
 */
export type WireState = "idle" | "lit" | "muted" | "hidden";

export function WirePath({
  animate,
  index,
  state,
  wire,
}: {
  animate: boolean;
  index: number;
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
          cycle so exactly one pulse is on the wire at a time. Staggered by index so the picture
          does not blink in unison. */}
      {animate && (
        <motion.path
          animate={{ pathOffset: [-(1 + PULSE_LEN), 0] }}
          className={cn("transition-colors", lit ? "stroke-info" : "stroke-info/70")}
          d={d}
          fill="none"
          initial={{ pathLength: PULSE_LEN, pathSpacing: 1, pathOffset: -(1 + PULSE_LEN) }}
          strokeLinecap="round"
          strokeWidth={2}
          transition={{
            duration: TRAVEL_S,
            ease: "linear",
            repeat: Infinity,
            delay: (index % 6) * (TRAVEL_S / 6),
          }}
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
