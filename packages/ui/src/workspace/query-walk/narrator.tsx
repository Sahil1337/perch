"use client";

// The side of the walk that reads: the user's SQL with the active clause lit, one sentence for the
// station, the phase readout, the row counter, and the exact SQL each step ran.

import { AnimatePresence, motion } from "motion/react";
import { ChevronRightIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../../ui/collapsible";
import { highlightSql } from "../sql-editor/highlight-sql";
import type { Phase } from "./narration";
import type { Station } from "./steps";
import { TickNumber } from "./tick-number";
import type { StationResult } from "./use-walk";
import { useT } from "./walk-motion";

function Sentence({ text }: { text: string }): React.ReactElement {
  return (
    <>
      {text.split("`").map((part, i) =>
        i % 2 === 1 ? (
          <code className="rounded-sm bg-muted px-1 font-mono text-info-foreground text-xs" key={i}>
            {part}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function Narrator({
  sql,
  station,
  result,
  sentence,
  input,
  count,
  phase,
  phases,
}: {
  sql: string;
  station: Station;
  result: StationResult | undefined;
  sentence: string;
  input: number | null;
  count: number | null;
  phase: number;
  phases: readonly Phase[];
}): React.ReactElement {
  const t = useT();
  const clause = station.clause;
  const delta = input === null || count === null ? 0 : count - input;
  const queries = station.batches.flat();
  return (
    <aside aria-label="Narrator" className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs leading-5">
        {clause ? (
          <>
            <span className="opacity-40">{highlightSql(sql.slice(0, clause.from))}</span>
            <mark className="rounded-sm bg-info/10 text-inherit">
              {highlightSql(sql.slice(clause.from, clause.to))}
            </mark>
            <span className="opacity-40">{highlightSql(sql.slice(clause.to))}</span>
          </>
        ) : (
          <span className="opacity-40">{highlightSql(sql)}</span>
        )}
      </pre>
      {/* `wait`, not `popLayout`: the outgoing sentence finishes fading before the next one starts,
          so a station change never shows two sentences on top of each other. The wrapper animates
          its own height on the fold timing, so the counter below slides rather than jumps. */}
      <motion.div
        className="relative min-h-15 text-foreground text-sm leading-relaxed"
        layout
        transition={{ layout: t.fold }}
      >
        <AnimatePresence initial={false} mode="wait">
          <motion.p
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={station.key}
            transition={t.fade}
          >
            <Sentence text={sentence} />
          </motion.p>
        </AnimatePresence>
      </motion.div>
      <p aria-live="polite" className="-mt-2 font-mono text-muted-foreground text-xs tabular-nums">
        step {phase + 1} of {phases.length} · {phases[phase]?.label}
      </p>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-t pt-3 font-mono text-sm tabular-nums">
        {input !== null && (
          <>
            <span className="text-muted-foreground">{input.toLocaleString()} rows</span>
            <span className="text-muted-foreground">→</span>
          </>
        )}
        <span className="font-medium text-foreground">
          {count === null ? "?" : <TickNumber value={count} />} {count === 1 ? "row" : "rows"}
        </span>
        <AnimatePresence initial={false}>
          {delta !== 0 && (
            <motion.span
              animate={{ opacity: 1, scale: 1 }}
              className={cn(
                "rounded-sm px-1.5 text-xs leading-4",
                delta < 0
                  ? "bg-destructive/8 text-destructive-foreground"
                  : "bg-success/16 text-success-foreground",
              )}
              exit={{ opacity: 0, scale: 0.9 }}
              initial={{ opacity: 0, scale: 0.9 }}
              key="delta"
              transition={t.fade}
            >
              {delta < 0 ? "−" : "+"}
              <TickNumber value={Math.abs(delta)} />
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {queries.length > 0 && (
        <div className="border-t pt-3">
          <Collapsible>
            <CollapsibleTrigger className="group cursor-pointer">
              <span className="flex items-center gap-1 text-muted-foreground text-xs hover:text-foreground">
                <ChevronRightIcon className="size-3 transition-transform group-data-panel-open:rotate-90" />
                SQL that ran
              </span>
            </CollapsibleTrigger>
            <CollapsiblePanel>
            <div className="flex flex-col gap-2 pt-2">
              {queries.map((query) => {
                const outcome = result?.queries[query.id];
                return (
                  <div className="min-w-0" key={query.id}>
                    <p className="mb-1 text-muted-foreground text-xs">
                      {query.label}
                      {outcome?.ok && (
                        <span className="opacity-70"> · {outcome.result.durationMs} ms</span>
                      )}
                    </p>
                    <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-xs leading-4">
                      {highlightSql(query.sql)}
                    </pre>
                    {outcome && !outcome.ok && (
                      <p className="mt-1 whitespace-pre-wrap font-mono text-destructive-foreground text-xs">
                        {outcome.error}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            </CollapsiblePanel>
          </Collapsible>
        </div>
      )}
    </aside>
  );
}
