// The grid: one row per outer row, one column per driving row, one cell per pair.
//
// MOTION. There is one rule here and everything obeys it: motion means "this row's state changed
// because a test just ran". So during playback's first pass a row's cells arrive left to right, then
// its row-sum ticks up from zero, then its verdict mark lands — in that order, because the verdict
// arriving AFTER the sum is the causation the reader is meant to see. A row that has not been tested
// yet shows nothing at all, and a settled grid arrives with everything on it and nothing moving.
// Cells never animate between positions: if the rows re-sort, whole rows move and cells go with them.

import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { CellFrame } from "./cells";
import { formatCell } from "../results-grid";
import { Sentence } from "./narrator";
import { STAGGER_MS } from "./narration";
import type { Col, GridCellView, GridRowView, GridView } from "./scenes";
import { TickNumber } from "./tick-number";
import { VerdictMark } from "./verdict-mark";
import { WalkCard, WalkCardHeader } from "./walk-card";
import { useSpeed, useT } from "./walk-motion";

/** Gap between one cell of a row and the next, which is half a row's stagger: a cell is a smaller
 *  event than a row, and twelve of them have to fit inside one row's beat. */
const CELL_MS = STAGGER_MS / 2;
/** The pause between the last cell of a row and the count that sums them. */
const SUM_MS = 160;

/** Picking a cell: which outer row, and which column of the grid. */
type GridPicker = (row: number, column: string) => void;

/**
 * How a cell reports a click.
 *
 * Through a context rather than a prop because the grid reaches the screen as a SCENE — the stage
 * takes one of those and knows nothing about per-row sections — and threading a callback through
 * the stage for the one scene kind that needs it would put it on every station's render path.
 */
export const GridPickContext = React.createContext<GridPicker>(() => undefined);

export function GridCard({ grid }: { readonly grid: GridView }): React.ReactElement {
  const columns = grid.group.columns;
  // One width for every cell column, so the header labels line up with the dots under them and a
  // long course code does not make one column twice the width of its neighbours.
  const width = Math.max(56, ...columns.map((column) => 16 + column.label.length * 7));
  return (
    <WalkCard>
      <WalkCardHeader>
        <span className="whitespace-nowrap">{grid.title}</span>
        <span className="ms-auto whitespace-nowrap font-mono text-muted-foreground text-xs tabular-nums">
          {grid.note}
        </span>
      </WalkCardHeader>

      {/* Above the rows rather than under them: the card is often taller than the stage, and a
          legend at the foot is the first thing to be scrolled out of sight — which is the one part
          of this card that cannot be guessed from looking at it. */}
      <ul className="flex max-w-prose flex-col gap-1 border-b bg-muted/30 px-2.5 py-2 text-muted-foreground text-xs leading-relaxed">
        {grid.legend.map((line) => (
          <li key={line}>
            <Sentence text={line} />
          </li>
        ))}
      </ul>

      <div className="max-h-116 overflow-y-auto">
        <Header countLabel={grid.countLabel} cols={grid.cols} group={grid.group} width={width} />
        {grid.rows.map((row, index) => (
          <GridRow
            cols={grid.cols}
            hidden={grid.group.hidden}
            index={index}
            key={row.key}
            row={row}
            settled={grid.settled}
            width={width}
          />
        ))}
        {grid.rows.length === 0 && (
          <p className="px-3 py-6 text-center text-muted-foreground text-xs">No rows.</p>
        )}
      </div>
    </WalkCard>
  );
}

/**
 * The two lines over the rows: the driving query's name spanning its columns, then the labels.
 *
 * `--w` is a FLOOR here, not a width. This card is as wide as the widest thing in it, which is
 * regularly the legend above rather than the table — a paragraph of prose over four short columns —
 * and columns that only ever measured themselves left the difference as dead space down the right of
 * every row. They share that slack instead, so the count column ends where the card ends. The gutter
 * and the two pinned columns at the right edge are not part of the bargain: they are the same width
 * whatever the card's is.
 */
function Header({
  cols,
  group,
  countLabel,
  width,
}: {
  readonly cols: readonly Col[];
  readonly group: GridView["group"];
  readonly countLabel: string;
  readonly width: number;
}): React.ReactElement {
  const span = group.columns.length * width;
  return (
    <div className="border-b">
      <GroupBand cols={cols} group={group} span={span} />
      <LabelRow cols={cols} countLabel={countLabel} group={group} width={width} />
    </div>
  );
}

/**
 * The driving query's name, spanning its columns.
 *
 * A header of bare course codes says nothing about where the codes came from. Every line of this
 * card — this one, the labels under it, and each row — is the same list of flex items in the same
 * order, so the three of them cannot drift apart. That takes more care here than anywhere else,
 * because this line is one element standing over many: the band grows by as many shares as it
 * covers columns, which is exactly what those columns take between them, so its edges stay on
 * theirs however much slack there is to share. The two spacers at the end are the fold marker and
 * the count, which this line has nothing to put in but must still leave room for — without them it
 * would have 128px more slack to hand out than the line below, and every column would sit right of
 * its own label.
 */
function GroupBand({
  cols,
  group,
  span,
}: {
  readonly cols: readonly Col[];
  readonly group: GridView["group"];
  readonly span: number;
}): React.ReactElement {
  return (
    <div className="flex h-6 items-stretch">
      <div className="w-5.5 shrink-0" />
        {cols.map((col) => (
          <CellFrame grow key={col.id} width={col.width} />
        ))}
        {group.columns.length > 0 && (
          <div
            className="flex h-6 shrink-0 grow-(--n) basis-(--w) items-center gap-1 whitespace-nowrap border-info/30 border-x bg-info/5 px-2 font-mono text-info-foreground text-xs"
            style={{ "--n": `${group.columns.length}`, "--w": `${span}px` } as React.CSSProperties}
          >
            <span className="truncate">{group.title}</span>
          </div>
        )}
      {group.hidden > 0 && <div className="w-12 shrink-0" />}
      <div className="w-20 shrink-0" />
    </div>
  );
}

/** The column labels, in the same order and on the same shares as the band above and the rows
 *  below. */
function LabelRow({
  cols,
  countLabel,
  group,
  width,
}: {
  readonly cols: readonly Col[];
  readonly countLabel: string;
  readonly group: GridView["group"];
  readonly width: number;
}): React.ReactElement {
  return (
    <div className="flex h-7 items-stretch">
      <div className="w-5.5 shrink-0" />
        {cols.map((col) => (
          <CellFrame
            className={cn(
              "flex h-7 items-center truncate whitespace-nowrap px-2 font-mono text-muted-foreground text-xs",
              col.num && "justify-end",
            )}
            grow
            key={col.id}
            width={col.width}
          >
            {col.label}
          </CellFrame>
        ))}
        {group.columns.map((column) => (
          <CellFrame
            className="flex h-7 items-center justify-center truncate whitespace-nowrap px-1 font-mono text-info-foreground text-xs"
            grow
            key={column.id}
            title={column.label}
            width={width}
          >
            {column.label}
          </CellFrame>
        ))}
        {group.hidden > 0 && (
          <div
            className="flex h-7 w-12 shrink-0 items-center justify-center font-mono text-muted-foreground text-xs"
            title={`${group.hidden} driving rows, folded into the count`}
          >
            +{group.hidden}
          </div>
        )}
      <div className="flex h-7 w-20 shrink-0 items-center justify-end whitespace-nowrap bg-info/10 px-2 font-mono text-info-foreground text-xs">
        {countLabel}
      </div>
    </div>
  );
}

function GridRow({
  row,
  cols,
  hidden,
  width,
  index,
  settled,
}: {
  readonly row: GridRowView;
  readonly cols: readonly Col[];
  readonly hidden: number;
  readonly width: number;
  readonly index: number;
  readonly settled: boolean;
}): React.ReactElement {
  const t = useT();
  const speed = useSpeed();
  const onPick = React.useContext(GridPickContext);
  const filling = !settled && !t.reduced && row.state === "filling";
  const pending = !settled && row.state === "pending";
  // Everything after the cells hangs off when the last one landed, so the order on screen is the
  // order of the argument: the cells, then what they add up to, then what that means for the row.
  const cellsMs = filling ? row.grid.length * CELL_MS : 0;
  const sumDelay = (cellsMs + SUM_MS) / speed / 1000;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-current={row.current ? "true" : undefined}
      className={cn(
        "relative flex items-stretch border-b border-border/70 transition-colors duration-200 last:border-b-0",
        !pending && row.verdict === "fail" && "bg-destructive/8",
        row.current && "z-10 ring-1 ring-info ring-inset",
      )}
      initial={{ opacity: 0 }}
      layout="position"
      layoutId={row.key}
      transition={{ layout: t.spring, default: t.fade }}
    >
      <div className="flex w-5.5 shrink-0 items-center justify-center">
        {!pending && <RowVerdict delay={filling ? sumDelay + 0.25 : null} verdict={row.verdict} />}
      </div>
      {/* Same basis and the same growth as the label above each one: see `Header`. */}
      {cols.map((col) => (
        <CellFrame
          className={cn(
            "flex h-7 items-center truncate whitespace-nowrap px-2 font-mono text-xs tabular-nums",
            col.num && "justify-end",
            row.cells[col.id] === null && "text-muted-foreground italic",
          )}
          grow
          key={col.id}
          width={col.width}
        >
          {formatCell(row.cells[col.id] ?? null)}
        </CellFrame>
      ))}
      {row.grid.map((cell, at) => (
        <CellFrame
          className="flex h-7 items-center justify-center"
          grow
          key={cell.key}
          width={width}
        >
          <AnimatePresence initial={false}>
            {!pending && (
              <GridCellDot
                cell={cell}
                delay={filling ? (at * CELL_MS) / speed / 1000 : 0}
                onPick={() => onPick(index, cell.key)}
              />
            )}
          </AnimatePresence>
        </CellFrame>
      ))}
      {hidden > 0 && (
        <span
          aria-hidden
          className="flex h-7 w-12 shrink-0 items-center justify-center font-mono text-muted-foreground/50 text-xs"
        >
          ⋯
        </span>
      )}
      <RowSum delay={filling ? sumDelay : null} pending={pending} returned={row.returned} />
    </motion.div>
  );
}

/**
 * The mark that says what the row's cells added up to for the predicate.
 *
 * `delay` is null when the row is settled — it arrived with everything already decided, and
 * springing the mark in would perform a test that did not just happen. When it is a number, it is
 * how long after the row's own cells the verdict lands, which is the causation the card exists to
 * show: the sum first, then what it means.
 */
function RowVerdict({
  delay,
  verdict,
}: {
  readonly delay: number | null;
  readonly verdict: GridRowView["verdict"];
}): React.ReactElement {
  const t = useT();
  return (
    <motion.span
      animate={{ opacity: 1, scale: 1 }}
      className="flex"
      initial={delay === null ? false : { opacity: 0, scale: 0.4 }}
      transition={delay === null ? t.fade : { ...t.spring, delay }}
    >
      <VerdictMark delayMs={0} settled verdict={verdict} />
    </motion.span>
  );
}

/** What the row's cells came to: the count of the ones the subquery returned. */
function RowSum({
  delay,
  pending,
  returned,
}: {
  readonly delay: number | null;
  readonly pending: boolean;
  readonly returned: number | null;
}): React.ReactElement {
  const t = useT();
  return (
    <div className="flex h-7 w-20 shrink-0 items-center justify-end bg-info/10 px-2 font-mono text-info-foreground text-xs tabular-nums">
      {pending || returned === null ? (
        <span className="text-muted-foreground">{pending ? "" : "—"}</span>
      ) : (
        <motion.span
          animate={{ opacity: 1 }}
          initial={delay === null ? false : { opacity: 0 }}
          transition={{ ...t.fade, delay: delay ?? 0 }}
        >
          {/* From zero, because the number is a count of the cells that just arrived and watching
              it climb past them is the whole reason the two sit on the same row. */}
          <TickNumber from={delay === null ? undefined : 0} value={returned} />
        </motion.span>
      )}
    </div>
  );
}

/**
 * One cell.
 *
 * Filled says the inner subquery found rows; the tint says what that does to the OUTER row's
 * verdict, which is NOT the same question and under `not exists` of `not exists` runs the opposite
 * way. Both are spelled out in the legend under the card and in this button's own label, because a
 * dot that means two things at once has to say which one it is claiming.
 */
function GridCellDot({
  cell,
  delay,
  onPick,
}: {
  readonly cell: GridCellView;
  readonly delay: number;
  readonly onPick: () => void;
}): React.ReactElement {
  const t = useT();
  const tone =
    cell.tone === "gap" ? "destructive" : cell.tone === "save" ? "success" : "muted-foreground";
  return (
    <motion.button
      animate={{ opacity: 1, scale: 1 }}
      aria-label={cell.label}
      aria-pressed={cell.picked}
      className={cn(
        "flex size-6 cursor-pointer items-center justify-center rounded-md outline-none transition-colors duration-200 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring",
        cell.picked && "bg-info/15 ring-1 ring-info",
      )}
      initial={{ opacity: 0, scale: 0.5 }}
      onClick={onPick}
      transition={{ ...t.spring, delay: t.reduced ? 0 : delay }}
      type="button"
    >
      <span
        className={cn(
          "size-2.5 rounded-full border-2",
          cell.returned === null && "border-dashed border-muted-foreground/40",
          cell.returned !== null &&
            tone === "destructive" &&
            (cell.found ? "border-destructive bg-destructive" : "border-destructive"),
          cell.returned !== null &&
            tone === "success" &&
            (cell.found ? "border-success bg-success" : "border-success"),
          cell.returned !== null &&
            tone === "muted-foreground" &&
            (cell.found
              ? "border-muted-foreground/60 bg-muted-foreground/60"
              : "border-muted-foreground/60"),
        )}
      />
    </motion.button>
  );
}
