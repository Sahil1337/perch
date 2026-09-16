"use client";

// The side of the walk that reads. Top to bottom it is one thought: which station this is, how far
// through it the playback has got, what the station does, and what it did to the row count. The two
// pieces of SQL — the user's query and the statements the walk actually sent — are reference, not
// narration, so they sit in tabs at the foot where they can be ignored.

import { AnimatePresence, motion } from "motion/react";
import { ArrowRightIcon } from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../../ui/tabs";
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
  onPhase,
}: {
  sql: string;
  station: Station;
  result: StationResult | undefined;
  sentence: string;
  input: number | null;
  count: number | null;
  phase: number;
  phases: readonly Phase[];
  onPhase: (index: number) => void;
}): React.ReactElement {
  const t = useT();
  const clause = station.clause;
  const delta = input === null || count === null ? 0 : count - input;
  const queries = station.batches.flat();
  const [tab, setTab] = React.useState("query");
  // A station with no clause ran no statements, so "SQL that ran" is empty and unselectable there.
  const active = queries.length === 0 ? "query" : tab;
  return (
    <aside
      aria-label="Narrator"
      className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="font-medium font-mono text-sm">{station.label}</h2>
        <PhaseDots active={phase} onPhase={onPhase} phases={phases} />
        <span className="font-mono text-muted-foreground text-xs tabular-nums">
          {phase + 1}/{phases.length}
        </span>
      </div>

      {/* The phase caption and the sentence swap on their own keys, so a station change crossfades
          both and the block animates its own height rather than jumping the counter below. */}
      <motion.div className="relative min-h-24" layout transition={{ layout: t.fold }}>
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={`${station.key}:${phase}`}
            transition={t.fade}
          >
            <p aria-live="polite" className="text-muted-foreground text-xs">
              {phases[phase]?.label}
            </p>
            <p className="mt-1.5 text-foreground text-sm leading-relaxed">
              <Sentence text={sentence} />
            </p>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <RowFlow count={count} delta={delta} input={input} />

      <Tabs
        className="min-h-0 flex-1"
        onValueChange={(next) => setTab(String(next))}
        value={active}
      >
        <TabsList size="sm">
          <TabsTab value="query">Your query</TabsTab>
          <TabsTab disabled={queries.length === 0} value="ran">
            SQL that ran
          </TabsTab>
        </TabsList>
        <TabsPanel className="min-h-0 overflow-auto" value="query">
          <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
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
        </TabsPanel>
        <TabsPanel className="min-h-0 overflow-auto" value="ran">
          <div className="flex flex-col gap-2">
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
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
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
        </TabsPanel>
      </Tabs>
    </aside>
  );
}

/** One segment per phase of the station, and a way back to any of them. */
function PhaseDots({
  phases,
  active,
  onPhase,
}: {
  phases: readonly Phase[];
  active: number;
  onPhase: (index: number) => void;
}): React.ReactElement {
  return (
    <div className="ms-auto flex items-center gap-1">
      {phases.map((item, i) => (
        <button
          aria-current={i === active ? "step" : undefined}
          aria-label={`Step ${i + 1}: ${item.label}`}
          className={cn(
            "h-1 w-5 cursor-pointer rounded-full outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
            i === active ? "bg-info" : i < active ? "bg-info/40" : "bg-border",
          )}
          key={i}
          onClick={() => onPhase(i)}
          title={item.label}
          type="button"
        />
      ))}
    </div>
  );
}

/** What the station did to the row count: what came in, what went out, and the difference. */
function RowFlow({
  input,
  count,
  delta,
}: {
  input: number | null;
  count: number | null;
  delta: number;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t pt-3">
      {input !== null && (
        <>
          <Count label="in" value={input} />
          <ArrowRightIcon className="size-3 shrink-0 text-muted-foreground" />
        </>
      )}
      <Count label="out" strong value={count} />
      <AnimatePresence initial={false}>
        {delta !== 0 && (
          <motion.span
            animate={{ opacity: 1, scale: 1 }}
            className={cn(
              "rounded-sm px-1.5 font-mono text-xs leading-5 tabular-nums",
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
  );
}

function Count({
  label,
  value,
  strong,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
}): React.ReactElement {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-muted-foreground text-xs uppercase">{label}</span>
      <span
        className={cn(
          "font-mono text-sm tabular-nums",
          strong ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        {value === null ? "?" : <TickNumber value={value} />} {value === 1 ? "row" : "rows"}
      </span>
    </span>
  );
}
