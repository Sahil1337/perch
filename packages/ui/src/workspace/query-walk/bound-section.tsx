"use client";

// A section that runs once for every row of another one, actually running.
//
// Until this existed the screen said "correlated, so it has no one answer" and stopped there, which
// is true and useless: the relational-division query returns no rows at all, so the final result
// teaches nothing, and the only thing that explains it is the per-row view — Zhang is missing 3 of
// the 5 required courses, Shankar 1, Brandt all 5, and nobody is missing none. That is why the
// answer is empty, and it is visible nowhere else in the walk.
//
// So: the outer rows on the left with their verdicts, the subquery's own rows for the bound one on
// the right, and playback walking down the outer rows on its own. Taking hold of the scrubber pauses
// it, because a reader who has found the row they care about should not be dragged off it.

import { motion } from "motion/react";
import * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";
import { boundPlan, type BoundPlan } from "./bound";
import { BoundPanel } from "./bound-panel";
import { BoundScrubber } from "./bound-scrubber";
import { bindingText, boundPhases, ROW_HOLD_MS } from "./narration";
import type { Program, Section, SectionId } from "./program";
import { boundScene, type Scene } from "./scenes";
import { Stage } from "./stage";
import { useBoundRun } from "./use-bound";
import type { Probe, StationState } from "./use-walk";
import { useSpeed, useT } from "./walk-motion";

/** A bound section has no FROM cards, so nothing on its stage can offer to walk into a source. */
const NO_LINK = (): null => null;

/** What the stage holds before the outer probe lands: two empty slots, not a half-built card. */
const NOTHING_YET: Scene = { kind: "tables", tables: [], tight: false, count: null };

export function BoundSection({
  program,
  section,
  probe,
  playing,
  onPause,
  onDone,
  onOpenSection,
}: {
  readonly program: Program;
  readonly section: Section;
  readonly probe: Probe;
  /** Playback is running, so the view steps through outer rows on its own. */
  readonly playing: boolean;
  /** The reader took the scrubber; playback stops where it is. */
  readonly onPause: () => void;
  /** The last outer row has had its turn, so the walk may move on to the next chapter. */
  readonly onDone: () => void;
  readonly onOpenSection: (id: SectionId) => void;
}): React.ReactElement {
  const plan = React.useMemo(() => boundPlan(program, section), [program, section]);
  return plan.kind === "plan" ? (
    <BoundWalk
      onDone={onDone}
      onOpenSection={onOpenSection}
      onPause={onPause}
      plan={plan}
      playing={playing}
      probe={probe}
    />
  ) : (
    <BoundHold reason={plan.reason} section={section} />
  );
}

function BoundWalk({
  plan,
  probe,
  playing,
  onPause,
  onDone,
  onOpenSection,
}: {
  readonly plan: BoundPlan;
  readonly probe: Probe;
  readonly playing: boolean;
  readonly onPause: () => void;
  readonly onDone: () => void;
  readonly onOpenSection: (id: SectionId) => void;
}): React.ReactElement {
  const run = useBoundRun(plan, probe);
  const speed = useSpeed();
  const { current, rows, inner, bind } = run;
  const row = rows[current] ?? null;
  const waiting = inner === undefined;

  // One beat per outer row, on the same clock as every other schedule in the walk. It holds while
  // the row's probe is still out: advancing on a timer the database has not caught up with would
  // show the next row's title over the last row's answer, which is the one thing worse than waiting.
  React.useEffect(() => {
    if (!playing || rows.length === 0 || waiting) return;
    const lastRow = current >= rows.length - 1;
    const id = setTimeout(
      () => (lastRow ? onDone() : bind(current + 1)),
      ROW_HOLD_MS / speed,
    );
    return () => clearTimeout(id);
  }, [bind, current, onDone, playing, rows.length, speed, waiting]);

  const phases = React.useMemo(() => boundPhases(rows), [rows]);
  const title = row ? bindingText(plan, row) : plan.section.label;
  const scene = React.useMemo(
    () =>
      run.outer
        ? boundScene({
            plan,
            outer: run.outer,
            rows,
            current,
            title,
            inner: inner?.ok ? inner.result : null,
            innerError: inner && !inner.ok ? inner.error : null,
          })
        : null,
    [current, inner, plan, rows, run.outer, title],
  );

  const state: StationState = run.outerError
    ? "failed"
    : run.loadingOuter || waiting
      ? "loading"
      : "ready";
  const caption = run.loadingOuter
    ? `running ${plan.outer.label} once, for every row's answer at once`
    : rows.length === 0
      ? `${plan.outer.label} came back with no rows, so there is nothing to bind`
      : waiting
        ? `binding row ${current + 1} of ${rows.length}…`
        : (phases[current]?.label ?? "");

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-3">
        <div className="flex min-h-0 min-w-0 flex-col md:col-span-2">
          <Stage
            scene={scene ?? NOTHING_YET}
            sourceLink={NO_LINK}
            state={state}
          />
        </div>
        <BoundPanel
          caption={caption}
          durationMs={inner?.ok ? inner.result.durationMs : null}
          innerError={inner && !inner.ok ? inner.error : null}
          innerSql={run.innerSql}
          onOpenOuter={() => onOpenSection(plan.outer.id)}
          plan={plan}
          row={row}
        />
      </div>
      {rows.length > 0 && (
        <BoundScrubber
          current={current}
          label={title}
          onBind={bind}
          onGrab={onPause}
          rows={rows}
        />
      )}
      {run.outerError && (
        <p className="shrink-0 whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/8 p-3 font-mono text-destructive-foreground text-xs leading-5">
          {run.outerError}
        </p>
      )}
    </div>
  );
}

/**
 * A bound section the walk will not pretend to run, and the reason in full.
 *
 * The one that matters is nesting. In the relational-division query the inner `not exists takes` is
 * bound to a section that is itself bound, so there is no settled table of outer rows to scrub: its
 * outer rows only exist once a row of ITS outer section has been picked. Saying so plainly is worth
 * more than a two-level scrubber that nobody could follow — and far more than binding one level and
 * leaving the reader to assume the other was handled.
 */
function BoundHold({
  section,
  reason,
}: {
  readonly section: Section;
  readonly reason: string;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.section
      animate={{ opacity: 1 }}
      aria-label="Section"
      className="flex min-h-96 min-w-0 flex-1 flex-col items-center justify-center gap-3 overflow-auto rounded-xl border border-dashed bg-muted/40 p-6 text-center"
      initial={{ opacity: 0 }}
      transition={t.fade}
    >
      <h2 className="font-medium text-sm">This subquery runs once per row, and cannot be bound here</h2>
      <p className="max-w-prose text-muted-foreground text-sm leading-relaxed">{reason}</p>
      <pre className="max-w-full overflow-x-auto whitespace-pre-wrap rounded-md bg-card p-3 text-start font-mono text-xs leading-5">
        {highlightSql(section.parsed.text)}
      </pre>
    </motion.section>
  );
}
