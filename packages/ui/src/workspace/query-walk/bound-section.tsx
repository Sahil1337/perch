"use client";

// A section that runs once for every row of another one, actually running.
//
// Until this existed the screen said "correlated, so it has no one answer" and stopped there, which
// is true and useless: the relational-division query returns no rows at all, so the final result
// teaches nothing, and the only thing that explains it is the per-row view — Zhang is missing 3 of
// the 5 required courses, Shankar 1, Brandt all 5, and nobody is missing none. That is why the
// answer is empty, and it is visible nowhere else in the walk.
//
// There are two pictures of that, and which one is right depends on the subquery. A plain
// correlated predicate has one answer per outer row, so it is a LEDGER: outer rows on the left,
// the bound row's own rows on the right. A DOUBLY correlated one — this subquery walks its own rows
// and asks a third table about each of them — has one answer per PAIR of rows, so it is a GRID, and
// the loop stops being the picture. The grid is a specialisation of the ledger and never a
// replacement that can fail: when it cannot be built, or its probe is refused, the ledger is what
// shows, whole and without a word about it.
//
// Either way the scrubber is the row cursor and taking hold of it pauses playback, because a reader
// who has found the row they care about should not be dragged off it.

import { motion } from "motion/react";
import * as React from "react";
import { highlightSql } from "../sql-editor/highlight-sql";
import { boundGrid, boundPlan, type BoundPlan, type BoundRow } from "./bound";
import { useReportEvidence } from "./bound-evidence";
import { BoundPanel } from "./bound-panel";
import { BoundScrubber } from "./bound-scrubber";
import { GridPickContext } from "./grid-card";
import { BEAT, boundInnerTitle, boundPhases, ROW_HOLD_MS } from "./narration";
import type { Program, Section, SectionId } from "./program";
import { answerView, boundScene, gridScene, innerCard, type Scene, type TableView } from "./scenes";
import { Stage } from "./stage";
import type { BoundEvidence } from "./terminus";
import { useBoundRun } from "./use-bound";
import { bindKey, useGridRun } from "./use-grid";
import type { Probe, StationState } from "./use-walk";
import { RowsMoveContext, useSpeed, useT } from "./walk-motion";

/** What the grid measured for one cell, or null when its probe never reached that pair. */
function answerFor(
  cells: ReadonlyMap<string, ReadonlyMap<string, boolean>>,
  row: BoundRow | undefined,
  column: string,
): boolean | null {
  if (!row) return null;
  return cells.get(bindKey([...row.literals.values()]))?.get(column) ?? null;
}

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
  const outcome = React.useMemo(() => boundGrid(plan), [plan]);
  // The grid, and — when there is none — the sentence saying which clause ruled it out. The ledger
  // below is a complete picture either way; what the reason prevents is a reader reading the
  // difference between this chapter and the last one as the walk quietly giving up.
  const build = outcome.kind === "grid" ? outcome.grid : null;
  // Only when a grid was genuinely on the table: see `GridRefusal.candidate`.
  const noGrid = outcome.kind === "none" && outcome.candidate ? outcome.reason : null;
  const speed = useSpeed();
  const t = useT();
  const { current, rows, inner, bind } = run;
  const grid = useGridRun(build, rows, probe);
  const row = rows[current] ?? null;
  const waiting = inner === undefined;
  // The grid shows only once its own probe has landed: a card of empty cells while the statement is
  // in the air says the subquery answered nothing, which is the opposite of what is happening.
  const showGrid = build !== null && !grid.failed && !grid.loading && grid.columns.length > 0;

  // One beat per outer row, on the same clock as every other schedule in the walk. It holds while
  // the row's probe is still out: advancing on a timer the database has not caught up with would
  // show the next row's title over the last row's answer, which is the one thing worse than waiting.
  React.useEffect(() => {
    if (!playing || rows.length === 0 || waiting) return;
    const lastRow = current >= rows.length - 1;
    const id = setTimeout(
      () => (lastRow ? onDone() : bind(current + 1)),
      (ROW_HOLD_MS * BEAT) / speed,
    );
    return () => clearTimeout(id);
  }, [bind, current, onDone, playing, rows.length, speed, waiting]);

  // Whether the rows are ARRIVING or already here, decided once, when the chapter opens. Playback
  // walking in is a first pass and every row it reaches is a test the reader watches happen; a
  // reader clicking the chapter is not a test, and the grid they land on has to be settled — marks
  // present, nothing staggering, nothing flashing. Under reduced motion it is always the latter.
  const [filling] = React.useState(() => playing && !t.reduced);
  const [reached, setReached] = React.useState(1);
  React.useEffect(() => {
    setReached((seen) => Math.max(seen, current + 1));
  }, [current]);
  const reveal = filling ? reached : null;

  const phases = React.useMemo(() => boundPhases(rows), [rows]);
  const title = row ? boundInnerTitle(plan, row) : plan.section.label;

  // What this chapter measured, put on the shelf the terminus reads. Nothing is fetched for it —
  // these are the same three results the view above is already drawing — and it is reported only
  // once the outer probe has landed, because a ledger with no rows has measured nothing yet.
  const evidence = React.useMemo(
    (): BoundEvidence | null =>
      run.outer === null || rows.length === 0
        ? null
        : {
            plan,
            rows,
            outer: run.outer,
            grid: showGrid ? build : null,
            columns: grid.columns,
            cells: grid.cells,
            answers: run.answers,
          },
    [build, grid.cells, grid.columns, plan, rows, run.answers, run.outer, showGrid],
  );
  useReportEvidence(plan.section.id, evidence);

  // Picking a cell binds its row as well: the cell belongs to that outer row, and leaving the
  // cursor somewhere else would put one row's SQL beside another row's ring.
  const pick = React.useCallback(
    (at: number, column: string) => {
      onPause();
      bind(at);
      grid.pick(grid.picked?.row === at && grid.picked.column === column ? null : { row: at, column });
    },
    [bind, grid, onPause],
  );

  // The same card the scene builds, so the panel's sentences and the card on stage are written from
  // one set of values rather than two that could drift.
  const answer = React.useMemo(
    () => answerView({ plan, row, inner: inner?.ok ? inner.result : null, error: inner && !inner.ok ? inner.error : null }),
    [inner, plan, row],
  );

  const column = grid.columns.find((entry) => entry.key === grid.picked?.column) ?? null;
  const cell = grid.cell;
  // The subquery's own rows for the bound outer row, and — once a cell is picked — the rows behind
  // that one cell. Both are cards beside the grid, and the second only exists when it was asked for.
  const tables = React.useMemo((): TableView[] => {
    const own = innerCard(title, inner?.ok ? inner.result : null, inner && !inner.ok ? inner.error : null);
    if (!column || !build) return [own];
    return [
      own,
      innerCard(
        `${build.innerSource} · ${column.label}`,
        cell?.ok ? cell.result : null,
        cell && !cell.ok ? cell.error : null,
        "cell",
      ),
    ];
  }, [build, cell, column, inner, title]);

  const scene = React.useMemo(
    () =>
      !run.outer
        ? null
        : showGrid && build
          ? gridScene({
              plan,
              grid: build,
              outer: run.outer,
              rows,
              columns: grid.columns,
              cells: grid.cells,
              current,
              picked: grid.picked,
              reveal,
              truncated: grid.truncated,
              covered: grid.covered,
              tables,
              count: inner?.ok ? inner.result.rowCount : null,
            })
          : boundScene({
              plan,
              outer: run.outer,
              rows,
              current,
              title,
              inner: inner?.ok ? inner.result : null,
              innerError: inner && !inner.ok ? inner.error : null,
            }),
    [
      build,
      current,
      grid.cells,
      grid.columns,
      grid.covered,
      grid.picked,
      grid.truncated,
      inner,
      plan,
      reveal,
      rows,
      run.outer,
      showGrid,
      tables,
      title,
    ],
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
    <GridPickContext.Provider value={pick}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-3">
          <div className="flex min-h-0 min-w-0 flex-col md:col-span-2">
            {/* Keyed by the section rather than by the bound row: stepping from one outer row to
                the next is exactly where the inner card should animate, because those rows are
                successive answers from the same subquery. */}
            {/* A row that answered for the last outer row and answers again for this one IS the
                same row, so it travels rather than being struck out and redrawn: the one place
                outside a filter where that is true, and these cards are a handful of rows. */}
            <RowsMoveContext.Provider value>
              <Stage
                scene={scene ?? NOTHING_YET}
                sceneKey={plan.section.id}
                sourceLink={NO_LINK}
                state={state}
              />
            </RowsMoveContext.Provider>
          </div>
          <BoundPanel
            answer={answer}
            caption={caption}
            cell={
              column && grid.picked
                ? {
                    column,
                    parts: grid.cellParts,
                    result: cell,
                    returned: answerFor(grid.cells, rows[grid.picked.row], column.key),
                  }
                : null
            }
            durationMs={inner?.ok ? inner.result.durationMs : null}
            grid={showGrid ? build : null}
            gridColumns={grid.columns.length}
            innerError={inner && !inner.ok ? inner.error : null}
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
        {/* Why this is a ledger and not a grid. It is not an error and nothing failed — the ledger
            answers the question completely — so it is a quiet line rather than a red box. */}
        {noGrid !== null && (
          <p className="shrink-0 rounded-md border border-dashed bg-muted/40 p-2 text-muted-foreground text-xs leading-5">
            Shown row by row rather than as a grid. {noGrid}
          </p>
        )}
        {run.outerError && (
          <p className="shrink-0 whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/8 p-3 font-mono text-destructive-foreground text-xs leading-5">
            {run.outerError}
          </p>
        )}
      </div>
    </GridPickContext.Provider>
  );
}

/**
 * A bound section the walk will not pretend to run, and the reason in full.
 *
 * The one that matters is nesting. A subquery bound to a section that is ITSELF bound has no settled
 * table of outer rows to scrub: its outer rows only exist once a row of its parent has been picked.
 * Since the grid, that parent is usually a grid and the note points at it — a cell there is what
 * would bind this — and where there is no grid it says the plain thing instead. Either way saying so
 * is worth more than a two-level scrubber nobody could follow, and far more than binding one level
 * and leaving the reader to assume the other was handled.
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
        {highlightSql(section.text)}
      </pre>
    </motion.section>
  );
}
