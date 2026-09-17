"use client";

// The right half of a per-row ledger for the two kinds whose answer is not a table.
//
// IN is a MEMBERSHIP test, so its card is the set: the outer row's value on top, the values the
// subquery returned below it, and the one they match lit in the same tint so the eye pairs the
// needle with the hay without being told to. Drawn as a table it would read as rows to be scanned
// down a column, which is the wrong question — the question is whether one value is in there at all.
//
// A scalar is ONE COMPARISON, so its card is that comparison laid out as it is written: value,
// operator, value, verdict. The two ways it can go wrong are the two things people get bitten by
// and neither is visible in a table of one cell — more than one row is an error the database
// raises, and no row at all makes the value null and the comparison unknown rather than false.
//
// Motion here means one thing: the binding moved, so the values changed. The chips and the two
// values cross-fade on their own contents; nothing else moves.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Crossfade } from "./crossfade";
import type { AnswerView } from "./scenes";
import { VerdictMark } from "./verdict-mark";
import { WalkCard, WalkCardHeader } from "./walk-card";
import { useT } from "./walk-motion";

export function AnswerCard({ view }: { readonly view: AnswerView }): React.ReactElement {
  return (
    <WalkCard ariaLabel={view.title} className="w-max min-w-56 max-w-xs" role="group">
      <WalkCardHeader>
        <span className="truncate">{view.title}</span>
        {view.kind === "values" && (
          <span className="ms-auto shrink-0 whitespace-nowrap font-mono text-muted-foreground text-xs tabular-nums">
            {view.values.length} {view.values.length === 1 ? "value" : "values"}
          </span>
        )}
      </WalkCardHeader>
      {view.error ? (
        <p className="max-w-xs p-3 font-mono text-destructive-foreground text-xs">{view.error}</p>
      ) : view.kind === "values" ? (
        <ValueList view={view} />
      ) : (
        <Equation view={view} />
      )}
    </WalkCard>
  );
}

function ValueList({
  view,
}: {
  readonly view: Extract<AnswerView, { kind: "values" }>;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="flex flex-col">
      {/* The needle, above the hay and in the same tint the match wears, so the pairing is a colour
          match rather than a sentence the reader has to hold in their head. */}
      <div className="flex items-center gap-2 border-b bg-info/10 px-2.5 py-1.5">
        <span className="min-w-0 truncate font-mono text-info-foreground text-xs">
          {view.needleLabel}
        </span>
        <Crossfade
          className="relative ms-auto inline-grid"
          textClassName="block whitespace-nowrap font-mono font-medium text-info-foreground text-xs"
          value={view.needle}
        />
        <VerdictMark delayMs={0} settled verdict={view.verdict} />
      </div>
      {view.values.length === 0 ? (
        <p className="px-3 py-6 text-center text-muted-foreground text-xs leading-relaxed">
          {view.empty}
        </p>
      ) : (
        <div className="flex max-h-116 flex-wrap gap-1 overflow-y-auto p-2.5">
          <AnimatePresence initial={false}>
            {view.values.map((chip) => (
              <motion.span
                animate={{ opacity: 1, scale: 1 }}
                className={cn(
                  "rounded-md border px-1.5 py-0.5 font-mono text-xs leading-5",
                  chip.poison
                    ? "border-destructive/40 bg-destructive/8 text-destructive-foreground"
                    : chip.match
                      ? "border-info bg-info/10 font-medium text-info-foreground"
                      : "border-transparent bg-muted text-muted-foreground",
                )}
                exit={{ opacity: 0, scale: 0.94 }}
                initial={{ opacity: 0, scale: 0.94 }}
                key={chip.key}
                layout="position"
                title={
                  chip.poison
                    ? "a null in the set: every row fails NOT IN because of it"
                    : undefined
                }
                transition={{ layout: t.spring, default: t.fade }}
              >
                {chip.text}
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
      {view.truncated && view.total !== null && (
        <p className="border-t px-2.5 py-1.5 font-mono text-muted-foreground text-xs tabular-nums">
          {view.total} values in all · showing {view.values.length}
        </p>
      )}
    </div>
  );
}

function Equation({
  view,
}: {
  readonly view: Extract<AnswerView, { kind: "equation" }>;
}): React.ReactElement {
  return (
    <div className="flex flex-col gap-2 p-2.5">
      <div className="flex items-center gap-1.5">
        <Value label={view.leftLabel} lit text={view.left} />
        <span className="shrink-0 font-mono text-muted-foreground text-sm">{view.operator}</span>
        <Value label="the subquery" lit={false} text={view.right} />
        <VerdictMark delayMs={0} settled verdict={view.verdict} />
      </div>
      {/* The two failure modes a table would hide. Both are about the promise a scalar subquery
          makes — exactly one row — and both are the database's behaviour rather than an error here. */}
      {view.many !== null && (
        <p className="rounded-md border border-destructive/30 bg-destructive/8 p-2 text-destructive-foreground text-xs leading-relaxed">
          The subquery came back with {view.many} rows. A scalar comparison is promised exactly one,
          and more than one is an error the database raises rather than a value it picks from.
        </p>
      )}
      {view.missing && (
        <p className="rounded-md border bg-muted/40 p-2 text-muted-foreground text-xs leading-relaxed">
          No row came back, so the value is null and the comparison is unknown rather than false.
          The row is dropped either way, which is why an empty scalar subquery is so easy to miss.
        </p>
      )}
    </div>
  );
}

function Value({
  label,
  text,
  lit,
}: {
  readonly label: string;
  readonly text: string;
  readonly lit: boolean;
}): React.ReactElement {
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
      <span className="truncate font-mono text-muted-foreground text-xs">{label}</span>
      <Crossfade
        textClassName={cn(
          "block truncate rounded-md px-1.5 py-0.5 font-mono text-sm",
          lit ? "bg-info/10 text-info-foreground" : "bg-muted text-foreground",
        )}
        value={text}
      />
    </span>
  );
}
