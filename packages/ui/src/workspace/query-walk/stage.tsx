"use client";

// The animated scene: the tables a station shows, and the rows moving through them. Column widths
// and stagger delays reach CSS as custom properties, so the layout stays in utility classes.

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowDownIcon, ArrowUpIcon, CornerUpRightIcon, TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import type { Cell as CellValue } from "@perch/protocol";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { formatCell } from "../results-grid";
import { AnswerCard } from "./answer-card";
import { BucketsScene } from "./buckets";
import type { SourceRef } from "./clauses";
import { GridCard } from "./grid-card";
import { STAGGER_MS } from "./narration";
import type { Col, Row as RowView, Scene, TableView } from "./scenes";
import { TerminusCard } from "./terminus-card";
import { TickNumber } from "./tick-number";
import type { StationState } from "./use-walk";
import { VerdictMark } from "./verdict-mark";
import { collapseAfter, useSpeed, useT } from "./walk-motion";

/**
 * Where a FROM source came from, when it became a section of its own: the section's name, and a way
 * to open it. Null for a plain table, and for a subquery the slicer never sliced.
 */
export type SourceLink = { readonly label: string; readonly onJump: () => void };

export function Stage({
  scene,
  state,
  sourceLink,
  sceneKey,
}: {
  scene: Scene;
  state: StationState;
  sourceLink: (source: SourceRef) => SourceLink | null;
  /**
   * Identifies the chapter on stage. Changing it remounts the scene instead of animating into it.
   *
   * Rows are keyed by their contents so a row can be carried from one station to the next, which is
   * the whole point within a chapter. Across chapters it is a lie: two chapters are different
   * queries, and a row leaving one has not been rejected by the other — it was never a candidate.
   * Letting the exit animation run there strikes rows out in front of a reader who only clicked a
   * different chapter.
   */
  sceneKey: string;
}): React.ReactElement {
  const t = useT();
  const box = React.useRef<HTMLDivElement>(null);
  const edges = useEdges(box);
  return (
    <section
      aria-label="Stage"
      className="relative min-h-96 min-w-0 flex-1 overflow-hidden rounded-xl border bg-muted/40"
    >
      {/* A wide join runs past the stage, so the edge with more to show fades out: the only honest
          way to say "there is more this way" without stealing a row of height for a legend. */}
      <div
        className={cn(
          "size-full overflow-auto",
          edges.left && edges.right
            ? "mask-x-from-92%"
            : edges.right
              ? "mask-r-from-92%"
              : edges.left
                ? "mask-l-from-92%"
                : null,
        )}
        ref={box}
      >
        {/* `items-center-safe`, so a scene taller than the stage scrolls from its top edge rather
            than having it centred out of reach. `max-w-full` lets a wrapping scene use the width. */}
        <div className="flex min-h-full items-center-safe p-4 md:p-6">
          <div className="mx-auto w-max max-w-full">
            <LayoutGroup key={sceneKey}>
              {/* A station that failed or is not in the query has no scene: whatever the builder
                  could still make of it is a half-built card, and the message below would print
                  straight on top of it. */}
              {state === "failed" || state === "absent" ? null : scene.kind === "buckets" ? (
                <BucketsScene scene={scene} />
              ) : (
                <TablesScene scene={scene} sourceLink={sourceLink} />
              )}
            </LayoutGroup>
          </div>
        </div>
      </div>
      <AnimatePresence>
        {state === "loading" && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center gap-2 bg-background/60 text-muted-foreground text-sm backdrop-blur-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="loading"
            transition={t.fade}
          >
            <Spinner className="size-4" /> Running this step…
          </motion.div>
        )}
        {state === "failed" && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center gap-2 p-6 text-center text-muted-foreground text-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="failed"
            transition={t.fade}
          >
            <TriangleAlertIcon className="size-4 shrink-0 text-destructive-foreground" />
            Nothing to show: this step did not run.
          </motion.div>
        )}
        {state === "absent" && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center p-6 text-center text-muted-foreground text-sm"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="absent"
            transition={t.fade}
          >
            Not in this query.
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/**
 * Which sides of a scroll box still have content behind them. The scene's own width is not
 * observable — the cards overflow a wrapper that never changes size — so the measurement is taken
 * after every render (a new station or phase) and again once that scene's motion has settled.
 */
function useEdges(ref: React.RefObject<HTMLDivElement | null>): { left: boolean; right: boolean } {
  const [edges, setEdges] = React.useState({ left: false, right: false });
  const measure = React.useCallback((): void => {
    const box = ref.current;
    if (!box) return;
    const left = box.scrollLeft > 2;
    const right = box.scrollWidth - box.clientWidth - box.scrollLeft > 2;
    setEdges((previous) =>
      previous.left === left && previous.right === right ? previous : { left, right },
    );
  }, [ref]);

  // No dependency array on purpose: every render is a scene that may be a different width. The
  // state setter returns the same object when nothing moved, so this settles after one pass.
  React.useEffect(() => {
    measure();
    const settle = [setTimeout(measure, 400), setTimeout(measure, 1000)];
    return () => settle.forEach(clearTimeout);
  });

  React.useEffect(() => {
    const box = ref.current;
    if (!box) return;
    box.addEventListener("scroll", measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => {
      box.removeEventListener("scroll", measure);
      observer.disconnect();
    };
  }, [ref, measure]);

  return edges;
}

/**
 * The cards of a scene in a row, with the grid — when there is one — first and widest.
 *
 * The terminus is the one card that is NOT in that row: it belongs under the result it explains,
 * because it is a second thought about the same rows rather than a step beside them, so the whole
 * arrangement becomes a column when there is one.
 */
function TablesScene({
  scene,
  sourceLink,
}: {
  scene: Extract<Scene, { kind: "tables" | "grid" }>;
  sourceLink: (source: SourceRef) => SourceLink | null;
}): React.ReactElement {
  const t = useT();
  const terminus = scene.kind === "tables" ? scene.terminus : undefined;
  const answer = scene.kind === "tables" ? scene.answer : undefined;
  return (
    <motion.div className="flex flex-col items-start gap-3" layout transition={t.spring}>
      <motion.div
        className={cn(
          "relative flex items-start",
          scene.kind === "grid" ? "gap-6" : scene.tight ? "gap-3" : "gap-12",
        )}
        layout
        transition={t.spring}
      >
        <AnimatePresence initial={false} mode="popLayout">
          {scene.kind === "grid" && <GridCard grid={scene.grid} key={scene.grid.key} />}
          {scene.tables.map((view) => (
            <Table key={view.key} sourceLink={sourceLink} view={view} />
          ))}
          {answer && <AnswerCard key={answer.key} view={answer} />}
        </AnimatePresence>
      </motion.div>
      {terminus && <TerminusCard key={terminus.key} view={terminus} />}
    </motion.div>
  );
}

type Item = { kind: "row"; row: RowView; index: number } | { kind: "cut"; label: string };

function Table({
  view,
  sourceLink,
}: {
  view: TableView;
  sourceLink: (source: SourceRef) => SourceLink | null;
}): React.ReactElement {
  const t = useT();
  const items: Item[] = [];
  view.rows.forEach((row, index) => {
    items.push({ kind: "row", row, index });
    if (view.cut && view.cut.after === index + 1) items.push({ kind: "cut", label: view.cut.label });
  });
  const shown = view.rows.length;
  const total = view.total ?? null;
  const hidden = view.hidden ?? [];
  // A source that became its own section is a REFERENCE, not a detour: the rows on this card were
  // computed there and the chapter is still on the strip. A source that did not become one — a
  // plain table, or a subquery the slicer refused — offers nothing here; there is nowhere to go,
  // and an unsliced subquery is already accounted for in the skipped note under the strip.
  const link = view.source ? sourceLink(view.source) : null;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="shrink-0 overflow-hidden rounded-lg border bg-card shadow-sm/5"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      layout
      transition={{ layout: t.spring, default: t.fade }}
    >
      <div className="flex h-8 items-center gap-2 border-b bg-muted/60 px-2.5 font-medium text-xs">
        <span className="relative">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ opacity: 1, y: 0 }}
              className="block whitespace-nowrap"
              exit={{ opacity: 0, y: -4 }}
              initial={{ opacity: 0, y: 4 }}
              key={view.title}
              transition={t.fade}
            >
              {view.title}
            </motion.span>
          </AnimatePresence>
        </span>
        {link && (
          <Button
            aria-label={`Computed in ${link.label}, go to it`}
            className="ms-1"
            onClick={link.onJump}
            size="xs"
            variant="outline"
          >
            <CornerUpRightIcon /> {link.label}
          </Button>
        )}
        <span className="ms-auto whitespace-nowrap font-mono text-muted-foreground text-xs tabular-nums">
          {total !== null && total !== shown ? (
            <>
              <TickNumber value={total} /> rows · showing {shown}
            </>
          ) : (
            <>
              <TickNumber value={shown} /> {shown === 1 ? "row" : "rows"}
            </>
          )}
        </span>
      </div>
      {view.error ? (
        <p className="max-w-xs p-3 font-mono text-destructive-foreground text-xs">{view.error}</p>
      ) : (
        <>
          <div className="flex h-7 items-stretch border-b">
            <div className="w-5.5 shrink-0" />
            <AnimatePresence initial={false}>
              {view.cols.map((col) => (
                <HeaderCell col={col} key={col.id} />
              ))}
            </AnimatePresence>
            {hidden.length > 0 && (
              <div
                className="flex h-7 w-12 shrink-0 items-center justify-center font-mono text-muted-foreground text-xs"
                title={`${hidden.length} more columns: ${hidden.join(", ")}`}
              >
                +{hidden.length}
              </div>
            )}
          </div>
          {/* The rows scroll under the header rather than growing the card past the stage: a
              25-row sample is three screens tall, and the card's title has to stay in sight. The
              cap is 16 rows: `h-7` plus each row's own bottom border, so no row is cut in half. */}
          <div className="max-h-116 overflow-y-auto">
            {items.length === 0 && (
              <p className="px-3 py-6 text-center text-muted-foreground text-xs">
                {view.empty ?? "No rows."}
              </p>
            )}
            <AnimatePresence initial={false}>
              {items.map((item) =>
                item.kind === "cut" ? (
                  <CutLine key="cut" label={item.label} />
                ) : (
                  <Row
                    cols={view.cols}
                    folded={hidden.length > 0}
                    index={item.index}
                    key={item.row.key}
                    row={item.row}
                    settled={view.settled === true}
                  />
                ),
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}

function HeaderCell({ col }: { col: Col }): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ width: col.width, opacity: 1 }}
      className="shrink-0 overflow-hidden"
      exit={{ width: 0, opacity: 0 }}
      initial={{ width: 0, opacity: 0 }}
      transition={t.collapse}
    >
      <div
        className={cn(
          "flex h-7 w-(--w) items-center gap-1 whitespace-nowrap px-2 font-mono text-xs transition-colors duration-200",
          col.num && "justify-end",
          col.hl ? "bg-info/10 text-info-foreground" : "text-muted-foreground",
        )}
        style={{ "--w": `${col.width}px` } as React.CSSProperties}
      >
        <span className="relative inline-grid">
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              animate={{ opacity: 1, y: 0 }}
              className="block truncate"
              exit={{ opacity: 0, y: -5 }}
              initial={{ opacity: 0, y: 5 }}
              key={col.label}
              transition={t.fade}
            >
              {col.label}
            </motion.span>
          </AnimatePresence>
        </span>
        <AnimatePresence initial={false}>
          {col.sort && (
            <motion.span
              animate={{ opacity: 1, y: 0 }}
              aria-label={col.sort === "desc" ? "descending" : "ascending"}
              className="flex"
              exit={{ opacity: 0 }}
              initial={{ opacity: 0, y: -4 }}
              key="sort"
              transition={t.fade}
            >
              {col.sort === "desc" ? (
                <ArrowDownIcon className="size-2.5" />
              ) : (
                <ArrowUpIcon className="size-2.5" />
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}

function Row({
  row,
  cols,
  index,
  folded,
  settled,
}: {
  row: RowView;
  cols: readonly Col[];
  index: number;
  /** The card folded some columns away: this row needs the same placeholder its header has. */
  folded: boolean;
  /** The card arrived with its verdicts already decided: nothing here is a test happening now. */
  settled: boolean;
}): React.ReactElement {
  const t = useT();
  const speed = useSpeed();
  const verdict = row.verdict;
  const testDelay = ((row.testIndex ?? 0) * STAGGER_MS) / speed;
  const delayMs = t.reduced || settled ? 0 : verdict ? testDelay : (index * 70) / speed;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      // `aria-current` rather than colour alone: the ring says "this is the row bound right now" to
      // a sighted reader, and nothing at all to anyone using a screen reader without it.
      aria-current={row.current ? "true" : undefined}
      className={cn(
        "relative flex overflow-hidden border-b border-border/70 transition-colors delay-(--d) duration-200 last:border-b-0",
        verdict === "fail" && "bg-destructive/8",
        row.current && "z-10 ring-1 ring-info ring-inset",
      )}
      exit={{ height: 0, opacity: 0, transition: collapseAfter(t, index * 0.045) }}
      initial={{ opacity: 0 }}
      layout="position"
      layoutId={row.key}
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
      transition={{ layout: t.spring, default: t.fade }}
    >
      {verdict === "pass" && !settled && (
        <motion.span
          animate={{ opacity: [0, 1, 0] }}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-success/16"
          transition={{ duration: t.reduced ? 0 : 0.9, delay: delayMs / 1000, times: [0, 0.25, 1] }}
        />
      )}
      <div className="flex w-5.5 shrink-0 items-center justify-center">
        <VerdictMark delayMs={delayMs} settled={settled} verdict={verdict} />
      </div>
      <AnimatePresence initial={false}>
        {cols.map((col) => (
          <Cell
            col={col}
            delayMs={delayMs}
            fail={verdict === "fail"}
            hl={Boolean(col.hl) || Boolean(row.hl?.includes(col.id))}
            key={col.id}
            value={row.cells[col.id] ?? null}
          />
        ))}
      </AnimatePresence>
      {folded && (
        <span
          aria-hidden
          className="flex h-7 w-12 shrink-0 items-center justify-center font-mono text-muted-foreground/50 text-xs"
        >
          ⋯
        </span>
      )}
    </motion.div>
  );
}

function Cell({
  col,
  value,
  hl,
  fail,
  delayMs,
}: {
  col: Col;
  value: CellValue;
  hl: boolean;
  fail: boolean;
  delayMs: number;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ width: col.width, opacity: 1 }}
      className="shrink-0 overflow-hidden"
      exit={{ width: 0, opacity: 0 }}
      initial={{ width: 0, opacity: 0 }}
      transition={t.collapse}
    >
      <div
        className={cn(
          "flex h-7 w-(--w) items-center truncate whitespace-nowrap px-2 font-mono text-xs tabular-nums line-through decoration-transparent transition-colors delay-(--d) duration-200",
          col.num && "justify-end",
          value === null && "text-muted-foreground italic",
          hl && !fail && "bg-info/10 text-info-foreground",
          fail && "text-destructive-foreground decoration-destructive/70",
        )}
        style={{ "--w": `${col.width}px`, "--d": `${delayMs}ms` } as React.CSSProperties}
      >
        {formatCell(value)}
      </div>
    </motion.div>
  );
}

function CutLine({ label }: { label: string }): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="relative z-10 flex h-5 items-center justify-end border-t border-destructive border-dashed bg-destructive/8 px-2"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0, y: -10 }}
      transition={{ ...t.spring, opacity: t.fade }}
    >
      <span className="font-mono text-destructive-foreground text-xs leading-none">{label}</span>
    </motion.div>
  );
}
