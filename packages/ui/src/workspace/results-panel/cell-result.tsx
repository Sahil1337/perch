"use client";

import type { StatementResult } from "@perch/protocol";
import { DownloadIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useFade } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { useWorkspace } from "../context";
import { ROW_HEIGHT } from "../results-grid";
import { type ResultsView, type Run, runStatements } from "../types";
import { commandLabel, isRowResult, plural } from "./format";
import { RunningBars } from "./skeletons";
import { ResultBody, StatementStrip } from "./statement-view";

/** Whole rows a cell shows before its result starts scrolling. The `1 +` is the sticky header. */
const CELL_VISIBLE_ROWS = 8;

/**
 * How tall a cell's result may get. Not a round number on purpose: the grid scrolls, and a height
 * that is not a whole number of rows leaves a sliced row at the bottom edge, which reads as a stray
 * line rather than as "there is more below". Nine whole rows is the nearest such height to 260px.
 */
const CELL_MAX_HEIGHT = ROW_HEIGHT * (1 + CELL_VISIBLE_ROWS);

/** An outcome badge needs a block to sit in, not a pane to be centred in. */
const CELL_OUTCOME_HEIGHT = 88;

/**
 * A cell's result, welded to the code that produced it. The grid sits directly under the editor with
 * one rule between them and the chrome hangs off the bottom, because a toolbar above the rows makes
 * the eye go code → bar → answer and the cell stops reading as a cell.
 *
 * The height is explicit rather than a `max-height`: `ResultsGrid` is a scroll container and needs a
 * bound, and computing it from the row count keeps a three-row result three rows tall.
 */
export function CellResult({
  run,
  index,
  onSelectStatement,
  className,
}: {
  run: Run;
  /** Which statement the card's header badge is describing, so the two cannot disagree. */
  index: number;
  onSelectStatement: (index: number) => void;
  className?: string;
}): React.ReactElement {
  const { exportUrl } = useWorkspace();

  const statements = runStatements(run);
  const statement = statements[Math.min(index, Math.max(0, statements.length - 1))];
  const running = run.status === "running";

  // Local, not `panels.resultsView`: that is one global value, so ten cells sharing it would all
  // flip to Messages the moment any one of them did.
  const [view, setView] = React.useState<ResultsView>("results");

  // An error is a message, not a grid. Once per failing run; the footer link is the way back.
  const announced = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (run.status !== "error") return;
    if (announced.current === run.id) return;
    announced.current = run.id;
    setView("messages");
  }, [run]);

  const exportHref =
    run.status === "done" && statement && statement.rows.length > 0
      ? exportUrl(run.id, { statement: index })
      : null;

  const rows = statement && isRowResult(statement) ? statement.rows.length : null;
  const height =
    view === "messages"
      ? CELL_MAX_HEIGHT
      : running
        ? undefined
        : rows !== null
          ? Math.min(CELL_MAX_HEIGHT, ROW_HEIGHT * (1 + rows))
          : CELL_OUTCOME_HEIGHT;

  return (
    <div className={cn("flex flex-col", className)}>
      {statements.length > 1 && (
        <StatementStrip index={index} onSelect={onSelectStatement} statements={statements} />
      )}

      <div
        className="h-(--perch-cell-h) shrink-0 overflow-hidden"
        style={
          { "--perch-cell-h": height === undefined ? "auto" : `${height}px` } as React.CSSProperties
        }
      >
        <ResultBody
          animateRows
          run={run}
          skeleton={<RunningBars />}
          statement={statement}
          view={view}
        />
      </div>

      {/* The artboard's 28px footer: the chrome a cell needs, under the answer instead of over it. */}
      <div className="flex h-7 shrink-0 items-center justify-between border-border border-t px-3">
        <button
          className="flex items-center gap-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground"
          onClick={() => setView(view === "messages" ? "results" : "messages")}
          type="button"
        >
          {view === "messages" ? "Results" : "Messages"}
          {run.error && view !== "messages" && (
            <Badge size="sm" variant="error">
              1
            </Badge>
          )}
        </button>

        {exportHref ? (
          <Button render={<a download href={exportHref} />} size="xs" variant="ghost">
            <DownloadIcon />
            Export
          </Button>
        ) : (
          <Button disabled size="xs" variant="ghost">
            <DownloadIcon />
            Export
          </Button>
        )}
      </div>
    </div>
  );
}

/** How a run turned out, in one badge — in the card's header, so a cell needs no toolbar. */
export function CellOutcome({
  run,
  statement,
}: {
  run: Run | undefined;
  statement: StatementResult | undefined;
}): React.ReactElement | null {
  const fade = useFade();

  // Spelled out rather than reusing statementSummary: the strip is tight and wants "142ms",
  // while a cell header has room for the spaced form.
  const badge =
    run === undefined
      ? null
      : run.status === "running"
        ? {
            key: "running",
            node: (
              <Badge size="sm" variant="outline">
                <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground/60" />
                Running…
              </Badge>
            ),
          }
        : run.status === "cancelled"
          ? { key: "cancelled", node: <Badge size="sm" variant="secondary">Cancelled</Badge> }
          : run.status === "error"
            ? { key: "error", node: <Badge size="sm" variant="error">Error</Badge> }
            : statement === undefined
              ? null
              : {
                  key: "done",
                  node: (
                    <Badge size="sm" variant="success">
                      {isRowResult(statement)
                        ? `${plural(statement.rowCount, "row")} · ${statement.durationMs} ms`
                        : commandLabel(statement)}
                    </Badge>
                  ),
                };

  // The badge lifts into place rather than being swapped out from under the eye watching it.
  return (
    <AnimatePresence initial={false} mode="wait">
      {badge && (
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -2 }}
          initial={{ opacity: 0, y: 2 }}
          key={badge.key}
          transition={fade}
        >
          {badge.node}
        </motion.span>
      )}
    </AnimatePresence>
  );
}
