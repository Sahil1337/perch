"use client";

import { AnimatePresence, motion } from "motion/react";
import { XIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Spinner } from "../../ui/spinner";
import type { Station } from "./steps";
import type { StationState } from "./use-walk";
import { useT } from "./walk-motion";

/** Pixels per station: `w-24` below. */
const ITEM_W = 96;

export function Rail({
  stations,
  states,
  active,
  onJump,
}: {
  stations: readonly Station[];
  states: readonly StationState[];
  active: number;
  onJump: (index: number) => void;
}): React.ReactElement {
  const t = useT();
  const n = stations.length;
  return (
    // The padding is load-bearing: `overflow-x-auto` also clips vertically, so without it the
    // scroll box cuts the top off every dot — the ring sits outside the 24px circle.
    <nav aria-label="Stations" className="min-w-0 overflow-x-auto px-1 py-1.5">
      <ol className="relative flex min-w-max">
        <div aria-hidden className="absolute top-3 right-12 left-12 h-px bg-border" />
        <motion.div
          aria-hidden
          animate={{ scaleX: n > 1 ? active / (n - 1) : 0 }}
          className="absolute top-3 left-12 h-px w-(--rail-w) origin-left bg-info"
          initial={false}
          style={{ "--rail-w": `${ITEM_W * Math.max(0, n - 1)}px` } as React.CSSProperties}
          transition={t.spring}
        />
        {stations.map((station, i) => {
          const state = states[i] ?? "loading";
          const present = state !== "absent";
          const done = i < active;
          const isActive = i === active;
          const note = !present
            ? "not in this query"
            : state === "failed"
              ? "failed"
              : state === "loading"
                ? "loading"
                : null;
          return (
            <li className="relative flex w-24 flex-col items-center gap-1.5" key={station.key}>
              <button
                aria-current={isActive ? "step" : undefined}
                aria-label={`${station.label}${note ? `, ${note}` : ""}`}
                className={cn(
                  "relative flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full font-mono text-xs tabular-nums outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                  !present
                    ? "border border-dashed bg-card text-muted-foreground/60"
                    : state === "failed"
                      ? "border border-destructive/40 bg-card text-destructive-foreground"
                      : done
                        ? "bg-info text-white"
                        : isActive
                          ? "bg-info/10 text-info-foreground ring-1 ring-info"
                          : "border bg-card text-muted-foreground hover:text-foreground",
                )}
                onClick={() => onJump(i)}
                title={note ?? station.label}
                type="button"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  {state === "loading" ? (
                    <motion.span
                      animate={{ opacity: 1 }}
                      className="flex"
                      exit={{ opacity: 0 }}
                      initial={{ opacity: 0 }}
                      key="spin"
                      transition={t.fade}
                    >
                      <Spinner className="size-3" />
                    </motion.span>
                  ) : state === "failed" ? (
                    <motion.span
                      animate={{ opacity: 1 }}
                      className="flex"
                      exit={{ opacity: 0 }}
                      initial={{ opacity: 0 }}
                      key="failed"
                      transition={t.fade}
                    >
                      <XIcon className="size-3" />
                    </motion.span>
                  ) : present && done ? (
                    <motion.svg
                      animate={{ scale: 1, opacity: 1 }}
                      exit={{ scale: 0, opacity: 0 }}
                      fill="none"
                      height="10"
                      initial={{ scale: 0, opacity: 0 }}
                      key="check"
                      stroke="currentColor"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth="1.8"
                      transition={t.spring}
                      viewBox="0 0 10 10"
                      width="10"
                    >
                      <path d="M2 5.2l2.2 2.2L8 3.2" />
                    </motion.svg>
                  ) : (
                    <motion.span
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      initial={{ opacity: 0 }}
                      key="n"
                      transition={t.fade}
                    >
                      {present ? i + 1 : "–"}
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
              <span
                className={cn(
                  "whitespace-nowrap font-mono text-xs transition-colors duration-200",
                  isActive
                    ? "font-medium text-info-foreground"
                    : done
                      ? "text-foreground"
                      : "text-muted-foreground",
                  !present && "text-muted-foreground/60",
                )}
              >
                {station.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
