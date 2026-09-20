// The only picture in the app: a client on your machine, and your database over there. The screen
// underneath asks for a host and a port because perch neither is a database nor ships one, so the
// picture has to make "two things, joined" the obvious reading before the form is read at all.
//
// Drawn, not branded — see `dialect-mark.tsx` for why perch ships no vendor logos.
//
// The beam travels perch → database, the direction the connection is made in, and only while there
// is nothing to report. Once a server is found the link goes solid, agreeing with the row below it.

import type { Dialect } from "@perch/protocol";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type React from "react";
import { PerchMark } from "../brand/logo";
import { cn } from "../lib/utils";
import { DIALECT_LABEL, DialectMark } from "./dialect-mark";
import { useSpring } from "../lib/motion";

/** How long one pulse takes to cross, in seconds. Slow enough to read as travel, not as a blink. */
const TRAVEL_S = 2.2;

export function ConnectionBeam({
  dialect,
  linked = false,
  className,
}: {
  /** Whose mark sits on the right. Defaults to Postgres, the commoner first database. */
  dialect?: Dialect;
  /** A server has been found: the wire itself lights, but the pulse keeps running either way. */
  linked?: boolean;
  className?: string;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const target: Dialect = dialect ?? "postgres";

  return (
    <div
      aria-label={`Perch, connecting to ${DIALECT_LABEL[target]}`}
      className={cn("flex items-start justify-center gap-3", className)}
      role="img"
    >
      <Node label="Perch">
        <PerchMark />
      </Node>

      {/* The wire. A hairline the pulse runs along, so the motion is the only thing that moves.
          The pulse runs whether or not a server has been found — a live link that sits perfectly
          still reads as a broken image, which is what a solid white bar was doing here. Finding
          one lights the wire underneath instead, so the state shows without stopping the motion. */}
      <div
        className={cn(
          // Aligned to the mark's centre, not the column's: the column includes the name
          // underneath, so centring against it hangs the wire below the two cards it joins.
          "relative mt-5 h-px w-20 overflow-hidden rounded-full",
          linked ? "bg-primary/24" : "bg-border",
        )}
      >
        {!reduced && (
          <motion.div
            animate={{ x: ["-120%", "220%"] }}
            // Feathered: a hard-edged block on a 1px rule reads as a loading bar, a gradient as
            // something moving through the wire.
            className="absolute inset-y-0 w-2/3 bg-gradient-to-r from-transparent via-primary to-transparent"
            transition={{ duration: TRAVEL_S, ease: "linear", repeat: Infinity }}
          />
        )}
      </div>

      {/* Keyed by dialect, so picking the other one in the form below swaps both the mark and its
          name here rather than mutating them in place. */}
      <Node label={DIALECT_LABEL[target]} swapKey={target}>
        <DialectMark className="size-5" dialect={target} />
      </Node>
    </div>
  );
}

/**
 * One end of the link: the mark in a card, named underneath. With a `swapKey` the contents ride out
 * upwards and the replacement arrives from below, clipped by the card, so the card is the fixed
 * thing and its contents are what changed — rather than two marks dissolving into one smear. The
 * label travels with it: "Postgres" under a MySQL mark for 200ms is worse than either.
 */
function Node({
  label,
  swapKey,
  children,
}: {
  label: string;
  /** Identity of the contents. Omitted for an end that never changes, like perch's own. */
  swapKey?: string;
  children: React.ReactNode;
}): React.ReactElement {
  const spring = useSpring();

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative flex size-10 items-center justify-center overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-sm/5">
        {swapKey === undefined ? (
          children
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ y: 0, opacity: 1 }}
              className="flex items-center justify-center"
              exit={{ y: -24, opacity: 0 }}
              initial={{ y: 24, opacity: 0 }}
              key={swapKey}
              transition={spring}
            >
              {children}
            </motion.span>
          </AnimatePresence>
        )}
      </div>

      <span className="relative h-4 overflow-hidden text-muted-foreground text-xs">
        {swapKey === undefined ? (
          label
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ y: 0, opacity: 1 }}
              className="block"
              exit={{ y: -16, opacity: 0 }}
              initial={{ y: 16, opacity: 0 }}
              key={swapKey}
              transition={spring}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        )}
      </span>
    </div>
  );
}
