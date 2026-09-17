"use client";

// The animated scene: the tables a station shows, and the rows moving through them. Column widths
// and stagger delays reach CSS as custom properties, so the layout stays in utility classes.

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowDownIcon, ArrowUpIcon, CornerUpRightIcon, TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import type { Cell as CellValue } from "@perch/protocol";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { ScrollArea } from "../../ui/scroll-area";
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
import { collapseAfter, staggerDelay, useRowsMove, useSpeed, useT } from "./walk-motion";

/**
 * Where a FROM source came from, when it became a section of its own: the section's name, and a way
 * to open it. Null for a plain table, and for a subquery the slicer never sliced.
 */
export type SourceLink = {
  readonly label: string;
  readonly onJump: () => void;
};

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
  return (
    <section
      aria-label="Stage"
      className="relative min-h-96 min-w-0 flex-1 overflow-hidden rounded-xl border bg-muted/40"
    >
      {/* A wide join runs past the stage, so the edge with more to show fades out: the only honest
          way to say "there is more this way" without stealing a row of height for a legend.

          `ScrollArea` is where that lives, the same as every other scroll box in the app. It was
          hand-rolled here once — a hook measuring `scrollWidth` on a frame, a mask toggled by React
          state, and a memo to stop that state re-rendering the scene — three moving parts to
          reproduce what `scrollFade` does declaratively off Base UI's own overflow variables. It
          also fades IN PROPORTION to what is left over the edge rather than snapping on at the ends,
          which is what the hand-rolled one could never do.

          `clampContentMinWidth={false}` because a wide join is exactly the content that has to be
          allowed past the viewport's width, and `fill` so the scene can still centre itself against
          the full height of the stage. */}
      <ScrollArea
        clampContentMinWidth={false}
        fill
        scrollFade
        // The scrollport has to be a motion element: layout animations happen inside it, and without
        // `layoutScroll` every rectangle measured in here is out by the scroll offset the moment a
        // wide join has been scrolled, so rows animate in from somewhere they never were.
        viewportRender={<motion.div layoutScroll />}
      >
        {/* `items-center-safe`, so a scene taller than the stage scrolls from its top edge rather
            than having it centred out of reach. `max-w-full` lets a wrapping scene use the width. */}
        <div className="flex min-h-full items-center-safe">
          {/* The padding rides on the scene rather than on the scroll box. A scene wider than the
              stage overflows a padded box, and overflow runs past padding: the left gutter holds
              because the content starts after it, the right one is simply not in the scroll range,
              so the widest card ends flush against the edge. On `w-max` it is part of the scene's
              own width and both edges scroll into view. */}
          <div className="mx-auto w-max max-w-full p-4 md:p-6">
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
      </ScrollArea>
      <AnimatePresence>
        {state === "loading" && (
          <motion.div
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center gap-2 bg-background/85 text-muted-foreground text-sm"
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
    <motion.div className="flex flex-col items-start gap-3" layout="position" transition={t.spring}>
      <motion.div
        className={cn(
          "relative flex items-start",
          scene.kind === "grid" ? "gap-6" : scene.tight ? "gap-3" : "gap-12",
        )}
        layout="position"
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
  /** The reference already says what the title says, so the title is the one to drop. */
  const named = link !== null && link.label === view.title;
  // The gutter down the left edge belongs to the verdict marks. A card that never stamps one — a
  // result, a plain source — would otherwise carry 22px of dead space that reads as the first
  // column being indented, against the `px-2` its last column gets on the other edge.
  const marks = view.rows.some((row) => row.verdict !== undefined);
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className="shrink-0 overflow-hidden rounded-lg border bg-card shadow-sm/5"
      exit={{ opacity: 0 }}
      initial={{ opacity: 0 }}
      // POSITION, not size. A bare `layout` animates a card's width and height by SCALING it and
      // then un-scaling every projection node inside, which is both the most expensive thing on this
      // stage — a correction written to every child, every frame — and a second animation of a
      // height that is already moving, because the rows inside are collapsing out on their own clock.
      // Two springs on one height is exactly the stutter this looked like. The card now follows its
      // content the way any other element does, and only its POSITION, when a neighbour resizes, is
      // animated. Nothing inside it is scaled, so nothing inside it has to be corrected.
      layout="position"
      transition={{ layout: t.spring, default: t.fade }}
    >
      <div className="flex h-8 items-center gap-2 border-b bg-muted/60 px-2.5 font-medium text-xs">
        {/* A source read under its section's own name says that name twice — a title reading
            `advisor_teaches` beside a button reading `advisor_teaches`. The repetition is not just
            noise: a card is as wide as its header and its columns are laid out at fixed pixel
            widths, so the doubled name stretches the card well past its own table and leaves a
            band of empty space down the right of the rows. The button carries the name in that
            case, because it is the half that also goes somewhere. */}
        {!named && (
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
        )}
        {link && (
          <Button
            aria-label={`Computed in ${link.label}, go to it`}
            className={cn(!named && "ms-1")}
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
          <div className="flex h-7 items-stretch justify-center border-b">
            {marks && <div className="w-5.5 shrink-0" />}
            {view.cols.map((col) => (
              <HeaderCell col={col} key={col.id} />
            ))}
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
          <motion.div className="max-h-116 overflow-y-auto" layoutScroll>
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
                    count={view.rows.length}
                    folded={hidden.length > 0}
                    index={item.index}
                    key={item.row.key}
                    marks={marks}
                    row={item.row}
                    settled={view.settled === true}
                  />
                ),
              )}
            </AnimatePresence>
          </motion.div>
        </>
      )}
    </motion.div>
  );
}

/**
 * A column header. The width is a plain custom property, not an animated one: see `Cell`.
 *
 * The label still crossfades and the sort arrow still arrives — that is one node per column, at most
 * nine per card, and it is the part a reader actually watches.
 */
function HeaderCell({ col }: { col: Col }): React.ReactElement {
  const t = useT();
  return (
    // `--w` is the width, and the slack a card has over its table falls OUTSIDE the columns. A card
    // is as wide as the widest thing in it, which is regularly its own title bar rather than its
    // table — `result · 9 rows · showing 1` over one `count` column. Stretching the columns to close
    // that gap moved the emptiness inside them, which reads worst in exactly the narrowest case: a
    // right-aligned number ends up on the card's edge, a lone digit an inch from the label it
    // belongs to. The header and the rows centre their columns instead, and carry the same width
    // and the same centring, which is what keeps a label over its own values.
    <div className="w-(--w) shrink-0 overflow-hidden" style={{ "--w": `${col.width}px` } as React.CSSProperties}>
      <div
        className={cn(
          "flex h-7 w-full items-center gap-1 whitespace-nowrap px-2 font-mono text-xs transition-colors duration-200",
          col.num && "justify-end",
          col.hl
            ? "bg-info/10 text-info-foreground"
            : col.drop
              ? "text-muted-foreground/50 line-through"
              : "text-muted-foreground",
        )}
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
    </div>
  );
}

function Row({
  row,
  cols,
  index,
  count,
  folded,
  marks,
  settled,
}: {
  row: RowView;
  cols: readonly Col[];
  index: number;
  /** How many rows are moving together, which is what bounds the stagger. See `staggerDelay`. */
  count: number;
  /** The card folded some columns away: this row needs the same placeholder its header has. */
  folded: boolean;
  /** Some row on this card carries a verdict, so every row keeps the gutter the marks sit in. */
  marks: boolean;
  /** The card arrived with its verdicts already decided: nothing here is a test happening now. */
  settled: boolean;
}): React.ReactElement {
  const t = useT();
  const speed = useSpeed();
  /**
   * The station moves rows, so this one is a shared element: it may be the same row a station
   * earlier, on this card or on the one beside it, and the layout animation carries it there.
   *
   * Off everywhere else, and that costs nothing to look at. A station that REBUILDS its rows gives
   * them new cells, a row's key is the hash of its cells, so the row remounts and fades whatever the
   * projection system is told — all `layoutId` bought there was a measurement of every row on stage
   * on every frame of every transition.
   */
  const moves = useRowsMove();
  const verdict = row.verdict;
  const testDelay = ((row.testIndex ?? 0) * STAGGER_MS) / speed;
  /**
   * When this row's turn comes, in seconds: rows ARRIVE one after another rather than all at once.
   *
   * This is what a station's beat is actually spent on. Without it every row of a card faded in
   * together over 220ms and then the scene sat still until the next station — a flash followed by a
   * wait, which is what "too fast" means here even when the beat itself is long. Lengthening the
   * beat only lengthens the wait; the fix is to give the reader something arriving THROUGH it.
   *
   * A settled card is exempt on purpose: it arrived with everything already decided, and dealing its
   * rows out one by one would perform an event that did not happen. See `settled`.
   */
  // 75ms apart, not 45: a card of a dozen rows is the common case, and at 45 they arrived close
  // enough together to read as one block appearing rather than as rows being dealt out. Past eight
  // rows `staggerDelay` compresses this into `STAGGER_WINDOW_S` anyway, so the number sets the pace
  // of the small cards and the window still bounds the big ones.
  const arrive = t.reduced || settled ? 0 : staggerDelay(index, count, 0.075) / speed;
  // The tint and the verdict mark ride the same wave, bounded the same way. A verdict keeps the
  // test's own clock, which the WHERE and HAVING phases already budget for (`n * STAGGER_MS + 700`).
  const delayMs = t.reduced || settled ? 0 : verdict ? testDelay : arrive * 1000;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      // `aria-current` rather than colour alone: the ring says "this is the row bound right now" to
      // a sighted reader, and nothing at all to anyone using a screen reader without it.
      aria-current={row.current ? "true" : undefined}
      className={cn(
        "relative flex justify-center overflow-hidden border-b border-border/70 transition-colors delay-(--d) duration-200 last:border-b-0",
        verdict === "fail" && "bg-destructive/8",
        row.current && "z-10 ring-1 ring-info ring-inset",
      )}
      exit={{
        height: 0,
        opacity: 0,
        transition: collapseAfter(t, staggerDelay(index, count, 0.045) / speed),
      }}
      initial={{ opacity: 0 }}
      layout={moves ? "position" : undefined}
      layoutId={moves ? row.key : undefined}
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
      transition={{ layout: t.spring, default: { ...t.fade, delay: arrive } }}
    >
      {verdict === "pass" && !settled && (
        <motion.span
          animate={{ opacity: [0, 1, 0] }}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-success/16"
          transition={{ duration: t.reduced ? 0 : 0.9, delay: delayMs / 1000, times: [0, 0.25, 1] }}
        />
      )}
      {marks && (
        <div className="flex w-5.5 shrink-0 items-center justify-center">
          <VerdictMark delayMs={delayMs} settled={settled} verdict={verdict} />
        </div>
      )}
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

/**
 * One cell. A plain div sized by a custom property — the pattern the grid card already uses.
 *
 * This used to be a `motion.div` folding its own width in and out, which is the most expensive thing
 * this file ever did: `width` is not a transform, so each of them wrote a layout property every
 * frame, and a join scene carries three cards of twenty-five rows by eight columns — six hundred
 * JavaScript-driven animations, each invalidating the layout of a card that was ALSO being measured
 * by the projection nodes above it. The fold it paid for was mostly invisible anyway: a row's key is
 * the hash of its cells, so a card whose columns changed has already remounted every row.
 */
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
  return (
    // Same width as the header above it: see `HeaderCell`.
    <div className="w-(--w) shrink-0 overflow-hidden" style={{ "--w": `${col.width}px` } as React.CSSProperties}>
      <div
        className={cn(
          "flex h-7 w-full items-center truncate whitespace-nowrap px-2 font-mono text-xs tabular-nums line-through decoration-transparent transition-colors delay-(--d) duration-200",
          col.num && "justify-end",
          value === null && "text-muted-foreground italic",
          hl && !fail && "bg-info/10 text-info-foreground",
          // On its way out of the query: dimmed, so the columns that survive read as the card's
          // subject and these as what is leaving it.
          col.drop && !fail && "text-muted-foreground/45",
          fail && "text-destructive-foreground decoration-destructive/70",
        )}
        style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
      >
        {formatCell(value)}
      </div>
    </div>
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
