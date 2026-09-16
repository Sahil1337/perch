"use client";

// The animated scene: the tables a station shows, and the rows moving through them. Column widths
// and stagger delays reach CSS as custom properties, so the layout stays in utility classes.

import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { ArrowDownIcon, ArrowUpIcon, FootprintsIcon } from "lucide-react";
import type * as React from "react";
import type { Cell as CellValue } from "@perch/protocol";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { formatCell } from "../results-grid";
import { BucketsScene } from "./buckets";
import type { SourceRef } from "./clauses";
import { STAGGER_MS } from "./narration";
import type { Col, Row as RowView, Scene, TableView } from "./scenes";
import { TickNumber } from "./tick-number";
import type { StationState } from "./use-walk";
import { collapseAfter, useSpeed, useT } from "./walk-motion";

export function Stage({
  scene,
  state,
  error,
  onWalk,
}: {
  scene: Scene;
  state: StationState;
  /** The database's message when the station's sample failed. */
  error: string | null;
  onWalk: (source: SourceRef) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <section
      aria-label="Stage"
      className="relative min-h-96 min-w-0 flex-1 overflow-auto rounded-xl border bg-muted/40"
    >
      <div className="p-4 md:p-6">
        <div className="mx-auto w-max">
          <LayoutGroup>
            {scene.kind === "tables" ? (
              <TablesScene onWalk={onWalk} scene={scene} />
            ) : (
              <BucketsScene scene={scene} />
            )}
          </LayoutGroup>
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
            className="absolute inset-0 flex flex-col items-center justify-center gap-1 p-6 text-center"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key="failed"
            transition={t.fade}
          >
            <p className="font-medium text-destructive-foreground text-sm">This step failed</p>
            <p className="max-w-md font-mono text-muted-foreground text-xs">{error}</p>
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

function TablesScene({
  scene,
  onWalk,
}: {
  scene: Extract<Scene, { kind: "tables" }>;
  onWalk: (source: SourceRef) => void;
}): React.ReactElement {
  const t = useT();
  return (
    <motion.div
      className={cn("relative flex items-start", scene.tight ? "gap-3" : "gap-12")}
      layout
      transition={t.spring}
    >
      <AnimatePresence initial={false} mode="popLayout">
        {scene.tables.map((view) => (
          <Table key={view.key} onWalk={onWalk} view={view} />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}

type Item = { kind: "row"; row: RowView; index: number } | { kind: "cut"; label: string };

function Table({
  view,
  onWalk,
}: {
  view: TableView;
  onWalk: (source: SourceRef) => void;
}): React.ReactElement {
  const t = useT();
  const items: Item[] = [];
  view.rows.forEach((row, index) => {
    items.push({ kind: "row", row, index });
    if (view.cut && view.cut.after === index + 1) items.push({ kind: "cut", label: view.cut.label });
  });
  const shown = view.rows.length;
  const total = view.total ?? null;
  const walkable = view.source && view.source.body !== null;
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
        {walkable && view.source && (
          <Button
            className="ms-1"
            onClick={() => onWalk(view.source!)}
            size="xs"
            variant="outline"
          >
            <FootprintsIcon /> Walk this
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
          </div>
          <div>
            <AnimatePresence initial={false}>
              {items.map((item) =>
                item.kind === "cut" ? (
                  <CutLine key="cut" label={item.label} />
                ) : (
                  <Row cols={view.cols} index={item.index} key={item.row.key} row={item.row} />
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
}: {
  row: RowView;
  cols: readonly Col[];
  index: number;
}): React.ReactElement {
  const t = useT();
  const speed = useSpeed();
  const verdict = row.verdict;
  const testDelay = ((row.testIndex ?? 0) * STAGGER_MS) / speed;
  const delayMs = t.reduced ? 0 : verdict ? testDelay : (index * 70) / speed;
  return (
    <motion.div
      animate={{ opacity: 1 }}
      className={cn(
        "relative flex overflow-hidden border-b border-border/70 transition-colors delay-(--d) duration-200 last:border-b-0",
        verdict === "fail" && "bg-destructive/8",
      )}
      exit={{ height: 0, opacity: 0, transition: collapseAfter(t, index * 0.045) }}
      initial={{ opacity: 0 }}
      layout="position"
      layoutId={row.key}
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
      transition={{ layout: t.spring, default: t.fade }}
    >
      {verdict === "pass" && (
        <motion.span
          animate={{ opacity: [0, 1, 0] }}
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-success/16"
          transition={{ duration: t.reduced ? 0 : 0.9, delay: delayMs / 1000, times: [0, 0.25, 1] }}
        />
      )}
      <div className="flex w-5.5 shrink-0 items-center justify-center">
        <Mark delayMs={delayMs} verdict={verdict} />
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
    </motion.div>
  );
}

function Mark({ verdict, delayMs }: { verdict?: "pass" | "fail"; delayMs: number }): React.ReactElement {
  return (
    <span
      aria-hidden
      className={cn(
        "flex size-3.5 items-center justify-center rounded-full text-white transition-opacity delay-(--d) duration-200",
        verdict ? "opacity-100" : "opacity-0",
        verdict === "fail" ? "bg-destructive" : "bg-success",
      )}
      style={{ "--d": `${delayMs}ms` } as React.CSSProperties}
    >
      {verdict === "fail" ? (
        <svg height="8" stroke="currentColor" strokeLinecap="round" strokeWidth="1.6" viewBox="0 0 8 8" width="8">
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" />
        </svg>
      ) : (
        <svg
          fill="none"
          height="8"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.6"
          viewBox="0 0 8 8"
          width="8"
        >
          <path d="M1.5 4.2l1.8 1.8 3.2-3.8" />
        </svg>
      )}
    </span>
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
