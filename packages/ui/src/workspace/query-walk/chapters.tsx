"use client";

// The chapter strip: the program's sections in order, above the station rail that walks whichever
// one is open. A section is a place in the query, not a detour — so this reads like a table of
// contents and every entry stays one click away, which is the whole reason the breadcrumb stack it
// replaced could go.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import type { SubqueryPredicateKind } from "./clauses";
import { Spinner } from "../../ui/spinner";
import type { SectionRun, SectionStatus } from "./use-walk";
import { useT } from "./walk-motion";

/**
 * `not exists` → `a NOT EXISTS`, `in` → `an IN`, `scalar` → `a scalar`.
 *
 * The article is chosen from the phrase as it will be read, not from the kind: `exists` takes "an"
 * but the `not exists` that contains it takes "a", so a fixed article is wrong for four of the five
 * kinds. The SQL keywords are upper-cased because that is what they are; `scalar` is our word for
 * the shape rather than anything the user typed, so it stays prose.
 */
function predicatePhrase(kind: SubqueryPredicateKind): string {
  const name = kind === "scalar" ? "scalar" : kind.toUpperCase();
  return `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
}

/** What a status means to someone reading the strip, for the accessible name and the tooltip. */
function note(run: SectionRun): string {
  switch (run.status) {
    case "pending":
      return "waiting";
    case "running":
      return "running";
    case "done":
      return "done";
    case "per-row":
      return "runs once per row of the section above it";
    case "held":
      return "runs per row, and needs its parent's row bound first";
    case "unwalkable":
      return "combines the branches";
    case "writes":
      return run.section.result?.kind === "writes"
        ? "changes the database, so it is shown but not run"
        : "reads a step that changes the database, so it was not run either";
  }
}

/**
 * What the open section IS, in the query the user wrote.
 *
 * The station rail below says FROM, JOIN, WHERE — but a CTE's FROM and the final query's FROM look
 * identical on it, and the SQL in the narrator is the section's own text with its WITH prefix
 * already spliced away. So without this line there is nothing on screen that answers "am I looking
 * at the CTE or at the query that reads it", which is the first thing anyone asks.
 */
function describe(run: SectionRun, sections: readonly SectionRun[]): string {
  const { origin, binding } = run.section;
  const outer =
    binding.kind === "bound"
      ? (sections.find((entry) => entry.section.id === binding.outer)?.section.label ??
        "the query above it")
      : null;
  // What it IS comes before where it sits: a CTE that is a VALUES list or a DELETE is a CTE either
  // way, but "computed once before anything that reads it" is not the sentence a reader needs when
  // the chapter in front of them has one card instead of a rail.
  const result = run.section.result;
  if (result !== null) {
    switch (result.kind) {
      case "values":
        return "a table written out in the query itself, so there are no clauses to step through.";
      case "no-from":
        return "a SELECT with no FROM: it computes its expressions once, over no rows at all.";
      case "writes":
        return "changes the database, so the walk shows it and never runs it.";
    }
  }
  if (run.section.unsafeToProbe) {
    return "reads a WITH step that changes the database, so the walk did not run it either.";
  }
  switch (origin.kind) {
    case "cte":
      return "declared by WITH, and computed once before anything that reads it.";
    case "derived":
      return "a subquery in FROM, computed before the query around it.";
    case "predicate":
      return outer
        ? `${predicatePhrase(origin.predicate.kind)} subquery, re-run for every row of ${outer}.`
        : `${predicatePhrase(origin.predicate.kind)} subquery. Nothing in it depends on the outer row, so it is computed once.`;
    case "branch":
      return `branch ${origin.index + 1} of the set operation.`;
    case "main":
      return "the query's final result.";
  }
}

/** A section the parse could not prove runs exactly once has to say so somewhere. This is it. */
function caveat(run: SectionRun): string | null {
  const { binding } = run.section;
  return binding.kind === "standalone" && !binding.certain
    ? "reading the SQL could not rule out that this depends on the outer row"
    : null;
}

export function Chapters({
  sections,
  active,
  onJump,
  writtenOrder,
}: {
  sections: readonly SectionRun[];
  active: number;
  onJump: (index: number) => void;
  /**
   * The statement's top level is a set operation. The strip then shows the branches in the order
   * they were WRITTEN, which is not the order they combine — see the caption below.
   */
  writtenOrder: boolean;
}): React.ReactElement {
  const t = useT();
  /** The chapter the rail below is walking, which the caption under the strip describes. */
  const open = sections[active];
  return (
    <div className="flex min-w-0 flex-col gap-1">
      {/* The padding is load-bearing for the same reason it is on the station rail: `overflow-x-auto`
          clips vertically too, and without it the scroll box shaves the focus ring off every pill. */}
      <nav aria-label="Sections" className="min-w-0 overflow-x-auto px-0.5 py-1">
        <ol className="flex min-w-max items-center gap-0.5">
          {sections.map((run, i) => {
            const isActive = i === active;
            const why = caveat(run);
            return (
              <li key={run.section.id}>
                <button
                  aria-current={isActive ? "step" : undefined}
                  aria-label={`${run.section.label}, ${note(run)}${why ? `, ${why}` : ""}`}
                  className={cn(
                    "flex max-w-56 cursor-pointer items-center gap-1.5 rounded-full px-2.5 py-1 text-xs outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                    isActive
                      ? "bg-info/10 font-medium text-info-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                  onClick={() => onJump(i)}
                  title={`${run.section.label} — ${note(run)}${why ? `. Note: ${why}.` : ""}`}
                  type="button"
                >
                  <Dot status={run.status} />
                  <span className="min-w-0 truncate font-mono">{run.section.label}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>
      {/* Which chapter is open, and what it is. Keyed on the section so it crossfades on a jump
          rather than swapping text under the reader's eye mid-sentence. */}
      <AnimatePresence initial={false} mode="wait">
        {open && (
          <motion.p
            animate={{ opacity: 1 }}
            className="px-1 text-muted-foreground text-xs"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={open.section.id}
            transition={t.fade}
          >
            <span className="font-mono text-foreground">{open.section.label}</span>
            <span className="tabular-nums">
              {" "}
              · {active + 1} of {sections.length}
            </span>{" "}
            — {describe(open, sections)}
          </motion.p>
        )}
      </AnimatePresence>
      {/* Wave 1's rule, and the one place this screen could actively mislead: the branch list is
          flat and SQL binds INTERSECT tighter than UNION and EXCEPT, so a left-to-right reading of
          the strip is simply wrong. Saying so costs one line. */}
      {writtenOrder && (
        <motion.p
          animate={{ opacity: 1 }}
          className="px-1 text-muted-foreground text-xs"
          initial={{ opacity: 0 }}
          transition={t.fade}
        >
          Branches are listed in the order they are written, not the order they combine:{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground">INTERSECT</code>{" "}
          binds tighter than{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground">UNION</code> and{" "}
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground">EXCEPT</code>.
        </motion.p>
      )}
    </div>
  );
}

/**
 * The mark in front of a chapter. Filled once the section has its rows, hollow while it waits, and
 * dashed when it does not run as one piece — the same vocabulary the station rail uses, so the two
 * rows of dots mean the same thing.
 *
 * A `per-row` section gets the dash in the accent colour rather than the muted one: it is dashed
 * because it has no single result, not because it is inert, and since wave 4 it really does run —
 * once for every row of the section it is bound to.
 */
function Dot({ status }: { status: SectionStatus }): React.ReactElement {
  if (status === "running") return <Spinner className="size-2.5 shrink-0" />;
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full border transition-colors duration-200",
        status === "done"
          ? "border-info bg-info"
          : status === "pending"
            ? "border-border bg-card"
            : status === "per-row"
              ? "border-dashed border-info bg-card"
              : "border-dashed border-muted-foreground/60 bg-card",
      )}
    />
  );
}
