"use client";

// The picture the connecting screen stands on: a socket drawing itself, then carrying a stream of
// packets while the stages beside it tick off. Split out from the screen because it is a complete,
// self-contained visual — like `connection-beam.tsx` — that never touches the screen's own timing
// state.
//
// Motion is all SVG: the wire draws itself with `pathLength` and the packets ride it with
// `offsetPath`, so they follow the curve rather than being tweened across a straight line.

import type { Dialect } from "@perch/protocol";
import { motion } from "motion/react";
import type React from "react";
import { PerchMark } from "../brand/logo";
import { cn } from "../lib/utils";
import { DialectMark } from "./dialect-mark";

/** The curve the packets ride, in the SVG's own coordinates. Shared by the path and the dots. */
const WIRE = "M 58 60 C 110 60, 110 24, 160 24 C 210 24, 210 60, 262 60";

/** One packet's trip, and the offsets that turn three of them into a stream. */
const PACKET_S = 1.8;
const PACKET_DELAYS = [0.9, 1.5, 2.1] as const;

export function Wire({ dialect, reduced }: { dialect: Dialect; reduced: boolean }): React.ReactElement {
  return (
    <div className="relative">
      <svg
        aria-hidden
        className="h-30 w-80 overflow-visible"
        fill="none"
        viewBox="0 0 320 120"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* The wire, drawn once on entry. `pathLength` normalises the curve to 0..1 so the dash
            maths is the same whatever the path's real length is. */}
        <motion.path
          animate={{ pathLength: 1 }}
          className="stroke-border"
          d={WIRE}
          initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
          strokeLinecap="round"
          strokeWidth="1.5"
          transition={{ duration: reduced ? 0 : 0.9, ease: "easeInOut" }}
        />

        {/* And again in the accent, chasing the first — the line "filling" after it is drawn. */}
        <motion.path
          animate={{ pathLength: 1, opacity: 1 }}
          className="stroke-primary"
          d={WIRE}
          initial={reduced ? { pathLength: 1, opacity: 0.4 } : { pathLength: 0, opacity: 0 }}
          strokeLinecap="round"
          strokeWidth="1.5"
          transition={{ duration: reduced ? 0 : 1.4, delay: reduced ? 0 : 0.5, ease: "easeInOut" }}
        />

        {/* Packets, riding the same curve the wire is drawn from — three of them, staggered, so
            it reads as carrying a stream rather than ferrying one dot back and forth.

            SMIL rather than `offsetPath`: following a path is exactly what `animateMotion` is for,
            it takes the `d` string directly instead of needing it smuggled through an inline style,
            and it keeps the motion inside the SVG where the rest of this drawing lives. */}
        {!reduced &&
          PACKET_DELAYS.map((delay) => (
            <circle className="fill-primary" key={delay} r="3">
              <animateMotion
                begin={`${delay}s`}
                dur={`${PACKET_S}s`}
                path={WIRE}
                repeatCount="indefinite"
              />
              {/* Fades at both ends so a packet appears to enter and leave the wire rather than
                  popping into existence on top of the node. */}
              <animate
                attributeName="opacity"
                begin={`${delay}s`}
                dur={`${PACKET_S}s`}
                keyTimes="0;0.15;0.85;1"
                repeatCount="indefinite"
                values="0;1;1;0"
              />
            </circle>
          ))}
      </svg>

      {/* The two ends sit over the drawing rather than inside it, so they are real DOM and keep
          the app's own card styling instead of being redrawn as SVG rectangles. */}
      <Node className="left-0">
        <PerchMark className="size-6" />
      </Node>
      <Node className="right-0" pulsing={!reduced}>
        <DialectMark className="size-6" dialect={dialect} />
      </Node>
    </div>
  );
}

function Node({
  className,
  pulsing = false,
  children,
}: {
  className?: string;
  /** The far end gets the ripple: it is the thing being reached, not the thing reaching. */
  pulsing?: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className={cn("-translate-y-1/2 absolute top-15", className)}>
      <div className="relative flex size-14 items-center justify-center rounded-2xl border border-border bg-card text-foreground shadow-sm/5">
        {pulsing &&
          [0, 1].map((ring) => (
            <motion.span
              animate={{ scale: 1.5, opacity: 0 }}
              className="absolute inset-0 rounded-2xl border border-primary"
              initial={{ scale: 1, opacity: 0.5 }}
              key={ring}
              transition={{ duration: 2, delay: ring, ease: "easeOut", repeat: Infinity }}
            />
          ))}
        {children}
      </div>
    </div>
  );
}
