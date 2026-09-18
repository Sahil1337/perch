// The moment between pressing Connect and seeing the workspace. Everything else unmounts, leaving
// the app's one picture at full size: opening a database is the only ceremony perch has — no
// account, no import, no sync — so it is worth showing rather than hiding behind a spinner.
//
// The stages are real work in the order it happens: socket, handshake, introspection, then the
// workspace mounting. A progress list that invents steps is a lie the first slow connection exposes.
//
// Motion is all SVG: the wire draws itself with `pathLength` and the packets ride it with
// `offsetPath`, so they follow the curve rather than being tweened across a straight line.

import type { Dialect } from "@perch/protocol";
import { CheckIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import * as React from "react";
import { useFade } from "../lib/motion";
import { cn } from "../lib/utils";
import { Wire } from "./connecting-wire";
import { DIALECT_LABEL } from "./dialect-mark";

/** The first run: a socket, a handshake, introspection, then the workspace mounting. */
export const CONNECT_STAGES = [
  "Reaching the server",
  "Checking credentials",
  "Reading the schema",
  "Opening your workspace",
] as const;

/**
 * Switching, once already connected. Shorter because it genuinely is: the socket and the handshake
 * are already paid for, and claiming otherwise would be the invented-step version of this list.
 */
export const SWITCH_STAGES = [
  "Switching database",
  "Reading the schema",
  "Reloading your workspace",
] as const;

/** Long enough to watch, short enough that nobody reaches for the tab. */
export const CONNECT_MS = 4600;
/** A switch happens often enough that the first run's pace would turn into a toll. */
export const SWITCH_MS = 2600;

export function ConnectingScreen({
  dialect,
  name,
  title,
  stages = CONNECT_STAGES,
  durationMs = CONNECT_MS,
  onDone,
}: {
  dialect: Dialect;
  /** The connection's own name, so the screen says which database it is opening. */
  name?: string;
  /** Overrides the heading — "Switching to demov2" rather than "Connecting to …". */
  title?: string;
  stages?: readonly string[];
  durationMs?: number;
  onDone: () => void;
}): React.ReactElement {
  const reduced = useReducedMotion();
  const fade = useFade();
  const [stage, setStage] = React.useState(0);
  const count = stages.length;

  // In a ref, so a caller rebuilding the callback cannot restart the sequence half way through.
  const done = React.useRef(onDone);
  done.current = onDone;

  React.useEffect(() => {
    // Nobody who asked not to be moved wants to be held here to watch something they cannot see.
    if (reduced) {
      const skip = setTimeout(() => done.current(), 400);
      return () => clearTimeout(skip);
    }

    const step = durationMs / (count + 1);
    const ticks = Array.from({ length: count }, (_, index) =>
      setTimeout(() => setStage(index + 1), Math.round(step * (index + 1))),
    );
    const leave = setTimeout(() => done.current(), durationMs);

    return () => {
      for (const tick of ticks) clearTimeout(tick);
      clearTimeout(leave);
    };
    // `count`, not `stages`: an inline array is a new identity every render, and a restart here
    // strands the user on this screen.
  }, [count, durationMs, reduced]);

  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="flex h-svh w-full flex-col items-center justify-center gap-10 bg-background p-6"
      initial={{ opacity: 0 }}
      role="status"
      transition={fade}
    >
      <Wire dialect={dialect} reduced={Boolean(reduced)} />

      <div className="flex flex-col items-center gap-5 text-center">
        <div className="flex flex-col gap-1">
          <h2 className="font-medium text-base">
            {title ?? `Connecting${name ? ` to ${name}` : ""}`}
          </h2>
          <p className="text-muted-foreground text-sm">{DIALECT_LABEL[dialect]}</p>
        </div>

        <ol className="flex flex-col items-start gap-2">
          {stages.map((label, index) => (
            <Stage
              done={index < stage}
              key={label}
              label={label}
              // Only one stage is ever live, and nothing is live once they are all done.
              live={index === stage && stage < count}
            />
          ))}
        </ol>
      </div>
    </motion.div>
  );
}


function Stage({
  label,
  done,
  live,
}: {
  label: string;
  done: boolean;
  live: boolean;
}): React.ReactElement {
  return (
    <li className="flex items-center gap-2.5 text-sm">
      <span className="flex size-4 shrink-0 items-center justify-center">
        <AnimatePresence initial={false} mode="wait">
          {done ? (
            <motion.span
              animate={{ scale: 1, opacity: 1 }}
              className="flex size-4 items-center justify-center rounded-full bg-success/16 text-success"
              initial={{ scale: 0.6, opacity: 0 }}
              key="done"
              transition={{ type: "spring", stiffness: 520, damping: 26 }}
            >
              <CheckIcon className="size-2.5" />
            </motion.span>
          ) : live ? (
            // A breathing dot, not a spinner: this is one line in a list, and the drawing above
            // is the screen's job.
            <motion.span
              animate={{ opacity: [0.35, 1, 0.35] }}
              className="size-1.5 rounded-full bg-primary"
              key="live"
              transition={{ duration: 1.2, ease: "easeInOut", repeat: Infinity }}
            />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/30" key="idle" />
          )}
        </AnimatePresence>
      </span>
      <span
        className={cn(
          "transition-colors",
          done || live ? "text-foreground" : "text-muted-foreground/60",
        )}
      >
        {label}
      </span>
    </li>
  );
}
