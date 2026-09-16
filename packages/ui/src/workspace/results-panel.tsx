"use client";

// The results surface: everything a run can turn into, in one place. A run is a list of statement
// outcomes, and most of them are not grids.
//
//   A statement with no `columns` is an `UPDATE 3` or a `CREATE TABLE`, not an empty result, so it
//   gets an outcome of its own rather than reading as "no rows returned".
//   A multi-statement run needs a way to reach statement 2; the strip of statement tabs is that.
//   `cancelled` and `truncated` are outcomes, not errors — rows cut at `maxRows` are still correct,
//   but showing 1000 of 4 million silently would be a lie, so truncation is always visible.
//
// Export is a prop, not a fetch: this package never talks to the server (see types.ts).

import type { QueryError, StatementResult } from "@perch/protocol";
import { DownloadIcon, ScrollTextIcon, TableIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Kbd } from "../ui/kbd";
import { Skeleton } from "../ui/skeleton";
import { Tabs, TabsList, TabsTab } from "../ui/tabs";
import { useFade } from "../lib/motion";
import { useWorkspace } from "./context";
import { ROW_HEIGHT, ResultsGrid } from "./results-grid";
import { type ResultsView, type Run, runStatements } from "./types";

/**
 * Stand-in columns, in `ch`, weighted the way `columnTemplate` sizes real ones so the placeholder
 * stretches across a wide pane. The mix of widths is what makes it read as data rather than bars.
 */
const SKELETON_COLUMNS = [10, 22, 14, 9, 16, 12] as const;
const SKELETON_TEMPLATE = SKELETON_COLUMNS.map((ch) => `minmax(${ch}ch, ${ch}fr)`).join(" ");
/** Drawn before the pane has been measured, and the floor afterwards. */
const SKELETON_MIN_ROWS = 8;

export function ResultsPanel({
  run,
  className,
}: {
  /** Defaults to the workspace's active run; pass one to pin the panel to a specific run. */
  run?: Run;
  className?: string;
}): React.ReactElement {
  const { activeRun, cancelRun, exportUrl, panels, setPanel } = useWorkspace();
  const fade = useFade();
  const current = run ?? activeRun;

  const statements = current ? runStatements(current) : [];
  const view = panels.resultsView;
  const setView = React.useCallback(
    (next: ResultsView): void => setPanel("resultsView", next),
    [setPanel],
  );

  // Keyed by run id rather than reset in an effect, so switching runs never paints statement 5 of
  // the previous run for a frame.
  const [selection, setSelection] = React.useState<{ runId: string; index: number } | null>(null);
  const index =
    selection && current && selection.runId === current.id
      ? Math.min(selection.index, Math.max(0, statements.length - 1))
      : 0;
  const statement = statements[index];
  // Only a finished statement with rows is worth downloading; the provider may still say no.
  const exportHref =
    current && current.status === "done" && statement && statement.rows.length > 0
      ? exportUrl(current.id, { statement: index })
      : null;

  // Each finished run gets one say in which half you are looking at: failures go to Messages,
  // successes to Results. Once per run id, so clicking between them afterwards sticks.
  const announced = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!current || current.status === "running") return;
    if (announced.current === current.id) return;
    announced.current = current.id;
    setView(current.status === "error" ? "messages" : "results");
  }, [current, setView]);

  const running = current?.status === "running";

  return (
    <section
      aria-label="Query results"
      className={cn("flex min-h-0 flex-col bg-background", className)}
    >
      {/* Deliberately NOT a tab strip. The pane's own tab already says "Results", and a second
          strip saying it again one line below is what made the pane look like it had two headers
          for one thing. What is left is only what the pane tab cannot say: how the run turned out,
          and which of its two views you are reading. */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-border border-b px-2">
        {summaryOf(current, statement) !== null && (
          <p className="min-w-0 truncate text-muted-foreground text-xs tabular-nums">
            {summaryOf(current, statement)}
          </p>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {running && current && (
            <Button onClick={() => void cancelRun(current.id)} size="xs" variant="outline">
              Cancel
            </Button>
          )}

          <ViewToggle failed={Boolean(current?.error)} onChange={setView} value={view} />

          {/* A real link: the browser downloads it, and the provider decides whether one exists. */}
          {exportHref ? (
            <Button
              aria-label="Export results as CSV"
              render={<a download href={exportHref} />}
              size="icon-xs"
              variant="ghost"
            >
              <DownloadIcon />
            </Button>
          ) : (
            <Button aria-label="Export results" disabled size="icon-xs" variant="ghost">
              <DownloadIcon />
            </Button>
          )}
        </div>
      </div>

      {statements.length > 1 && (
        <StatementStrip
          index={index}
          onSelect={(next) => {
            if (current) setSelection({ runId: current.id, index: next });
          }}
          statements={statements}
        />
      )}

      {/* A result arriving is the payoff of the whole app, so it fades in rather than blinking
          into place. The key changes on a new run, a different statement, or the other view —
          the three things that mean "this is a different answer now".

          `popLayout`, not `wait`. `wait` runs the exit to completion before the enter starts, so for
          the length of both transitions this region holds nothing at all — and a region holding
          nothing has no height, so the box collapses and springs back. That collapse is the flicker.
          `popLayout` takes the outgoing copy out of flow instead, and the incoming one occupies the
          space on the same frame: a crossfade, with the geometry never leaving. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            animate={{ opacity: 1 }}
            className="h-full"
            exit={{ opacity: 0 }}
            initial={{ opacity: 0 }}
            key={`${current?.id ?? "none"}:${index}:${view}`}
            transition={fade}
          >
        {!current ? (
          <EmptyState />
        ) : view === "messages" ? (
          <MessagesView run={current} />
        ) : running ? (
          <RunningRows />
        ) : current.status === "cancelled" ? (
          <Outcome
            detail="Nothing was returned for the statements that had not finished."
            title="Run cancelled"
            tone="muted"
          />
        ) : !statement ? (
          current.status === "error" ? (
            <Outcome
              detail={current.error?.message ?? "See Messages for the full error."}
              title="Statement failed"
              tone="error"
            />
          ) : (
            <Outcome detail="The run produced no statements." title="Nothing to show" tone="muted" />
          )
        ) : !isRowResult(statement) ? (
          <CommandOutcome result={statement} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {statement.truncated && (
              <p className="shrink-0 border-border border-b bg-warning/8 px-2 py-1 text-warning-foreground text-xs">
                Showing the first {statement.rowCount.toLocaleString()} rows — the result was cut at
                the server&rsquo;s row limit.
              </p>
            )}
            <div className="min-h-0 flex-1">
              <ResultsGrid result={statement} />
            </div>
          </div>
        )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ view */

const VIEWS: readonly {
  id: ResultsView;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: "results", label: "Results", Icon: TableIcon },
  { id: "messages", label: "Messages", Icon: ScrollTextIcon },
];

/**
 * Results or Messages, as two icons rather than labelled tabs. Spelling "Results" here would print
 * it twice, one line below the pane tab that already says it, and two underlined strips stacked
 * read as two headers for one pane. The words live in `aria-label`/`title` instead.
 */
function ViewToggle({
  value,
  failed,
  onChange,
}: {
  value: ResultsView;
  /** Puts a dot on Messages, since that is where the error actually is. */
  failed: boolean;
  onChange: (next: ResultsView) => void;
}): React.ReactElement {
  return (
    <Tabs onValueChange={(next) => onChange(next as ResultsView)} value={value}>
      <TabsList size="sm">
        {VIEWS.map(({ id, label, Icon }) => (
          <TabsTab aria-label={label} key={id} title={label} value={id}>
            <Icon />
            {id === "messages" && failed && (
              <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-destructive" />
            )}
          </TabsTab>
        ))}
      </TabsList>
    </Tabs>
  );
}

/** The one line the pane tab cannot carry: what came back. */
function summaryOf(run: Run | undefined, statement: StatementResult | undefined): string | null {
  if (!run) return null;
  if (run.status === "running") return "Running…";
  if (run.status === "cancelled") return "Cancelled";
  if (statement) return statementSummary(statement);
  return run.status === "error" ? "Failed" : null;
}

/* ------------------------------------------------------------- statements */

/**
 * One tab per statement outcome. Hidden for a single-statement run, where it would only be a
 * second copy of the row count already in the toolbar.
 */
function StatementStrip({
  statements,
  index,
  onSelect,
}: {
  statements: readonly StatementResult[];
  index: number;
  onSelect: (index: number) => void;
}): React.ReactElement {
  return (
    <div className="flex shrink-0 items-center overflow-x-auto border-border border-b px-2">
      <Tabs onValueChange={(value) => onSelect(Number(value))} value={String(index)}>
        <TabsList size="sm" variant="underline">
          {statements.map((result, position) => (
            <TabsTab key={result.index} value={String(position)}>
              <span className="text-muted-foreground tabular-nums">[{position + 1}]</span>
              <span className="tabular-nums">{statementSummary(result)}</span>
            </TabsTab>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}

/* ---------------------------------------------------------------- states */

function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
      <span>Run a query to see results</span>
      <Kbd>⌘↵</Kbd>
    </div>
  );
}

/**
 * The wait, shaped like the answer: the grid's own geometry with the text swapped for bars, so the
 * result does not jump when it lands. The row count is measured rather than fixed, because the
 * panel is a notebook cell in one place and a full-height sheet in another.
 */
function RunningRows(): React.ReactElement {
  const ref = React.useRef<HTMLDivElement>(null);
  const [rows, setRows] = React.useState(SKELETON_MIN_ROWS);

  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const measure = (): void => {
      // The header takes a row off the top; the rest is what there is to fill. Ceil so a partial
      // row is drawn and clipped, the way a real result runs off the bottom edge.
      const body = element.clientHeight - ROW_HEIGHT;
      setRows(Math.max(SKELETON_MIN_ROWS, Math.ceil(body / ROW_HEIGHT)));
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      aria-busy
      aria-label="Running"
      className="h-full w-full overflow-hidden font-mono text-sm"
      ref={ref}
      role="status"
      style={{ "--perch-grid-cols": SKELETON_TEMPLATE } as React.CSSProperties}
    >
      <div className="bg-muted">
        <div className="grid grid-cols-(--perch-grid-cols)">
          {SKELETON_COLUMNS.map((_, column) => (
            <div
              className="flex h-7 items-center gap-1.5 border-border border-r border-b px-2 last:border-r-0"
              key={column}
            >
              {/* Two bars, because the real header is a name and a type sitting beside it. */}
              <Skeleton
                className="h-2.5 w-(--perch-bar)"
                style={{ "--perch-bar": barWidth(0, column, 34, 26) } as React.CSSProperties}
              />
              <Skeleton className="h-2 w-5 shrink-0" />
            </div>
          ))}
        </div>
      </div>

      {Array.from({ length: rows }, (_, row) => (
        <div
          className={cn("grid grid-cols-(--perch-grid-cols)", row % 2 === 1 && "bg-muted/40")}
          key={row}
        >
          {SKELETON_COLUMNS.map((_, column) => (
            <div
              className="flex h-7 items-center border-border border-r border-b px-2 last:border-r-0"
              key={column}
            >
              <Skeleton
                className="h-2.5 w-(--perch-bar)"
                style={{ "--perch-bar": barWidth(row + 1, column, 46, 44) } as React.CSSProperties}
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/**
 * A bar's share of its cell — ragged, but derived from the coordinates rather than `Math.random`, so
 * a re-render cannot reshuffle every width mid-shimmer and the server render agrees with the client.
 */
function barWidth(row: number, column: number, base: number, spread: number): string {
  const noise = Math.sin(row * 12.9898 + column * 78.233) * 43758.5453;
  return `${Math.round(base + (noise - Math.floor(noise)) * spread)}%`;
}

/** A statement that changed rows instead of returning them, reported the way psql reports it. */
function CommandOutcome({ result }: { result: StatementResult }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <Badge size="lg" variant="success">
        <span className="tabular-nums">{commandLabel(result)}</span>
      </Badge>
      <p className="text-muted-foreground text-xs tabular-nums">
        {result.affectedRows === null
          ? "Completed"
          : `${plural(result.affectedRows, "row")} affected`}{" "}
        · {result.durationMs} ms
      </p>
    </div>
  );
}

function Outcome({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "error" | "muted";
}): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Badge size="lg" variant={tone === "error" ? "error" : "secondary"}>
        {title}
      </Badge>
      <p className="max-w-prose text-muted-foreground text-xs">{detail}</p>
    </div>
  );
}

/* -------------------------------------------------------------- messages */

/** The log view: what the server said, in order, including the parts a grid cannot show. */
function MessagesView({ run }: { run: Run }): React.ReactElement {
  const statements = runStatements(run);
  const started = clockOf(run.startedAt);

  return (
    <div className="h-full overflow-auto p-2.5 font-mono text-xs leading-5">
      <p className="text-muted-foreground">
        <span className="tabular-nums">[{started}]</span> Run started
        {run.database ? ` on ${run.database}` : ""}.
      </p>

      {statements.map((result) => (
        <React.Fragment key={result.index}>
          <p className="text-foreground">
            <span className="text-muted-foreground tabular-nums">[{result.index + 1}]</span>{" "}
            <span className="tabular-nums">{statementSummary(result)}</span>
            {result.truncated && (
              <span className="text-warning-foreground"> · truncated at the row limit</span>
            )}
          </p>
          {result.notices.map((notice, position) => (
            <p className="text-info-foreground" key={position}>
              {"  "}
              {notice}
            </p>
          ))}
        </React.Fragment>
      ))}

      {run.error && <ErrorBlock error={run.error} />}

      {run.status === "running" && (
        <p className="text-muted-foreground">
          <span className="tabular-nums">[{started}]</span> Waiting for the server…
        </p>
      )}

      {run.status === "cancelled" && <p className="text-muted-foreground">Run cancelled.</p>}

      {run.status === "done" && run.finishedAt && (
        <p className="text-muted-foreground">
          <span className="tabular-nums">[{clockOf(run.finishedAt)}]</span> Done
          {run.durationMs === undefined ? "" : ` in ${run.durationMs} ms`}.
        </p>
      )}
    </div>
  );
}

/** `detail` and `hint` are the two fields that usually say what to actually do about the error. */
function ErrorBlock({ error }: { error: QueryError }): React.ReactElement {
  return (
    <div className="mt-2 space-y-1 whitespace-pre-wrap rounded-md border border-destructive/32 bg-destructive/4 p-2.5 text-destructive-foreground">
      <p className="font-medium">
        {error.code ? `${error.code}: ` : ""}
        {error.message}
      </p>
      {error.line !== undefined && (
        <p className="text-muted-foreground tabular-nums">Line {error.line}</p>
      )}
      {error.detail && <p>{error.detail}</p>}
      {error.hint && <p className="text-muted-foreground">Hint: {error.hint}</p>}
    </div>
  );
}

/* ---------------------------------------------------------------- format */

function isRowResult(result: StatementResult): boolean {
  return result.columns.length > 0;
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** psql's wording: the verb, then what it touched. */
function commandLabel(result: StatementResult): string {
  const command = result.command ?? "OK";
  return result.affectedRows === null ? command : `${command} ${result.affectedRows}`;
}

/** What a statement tab says: `30 rows · 142ms` for a result set, `DELETE 412` for everything else. */
function statementSummary(result: StatementResult): string {
  return isRowResult(result)
    ? `${plural(result.rowCount, "row")} · ${result.durationMs}ms`
    : commandLabel(result);
}

function clockOf(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? timestamp
    : date.toLocaleTimeString("en-GB", { hour12: false });
}

/* ------------------------------------------------------------------ cell */

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
        style={{ "--perch-cell-h": height === undefined ? "auto" : `${height}px` } as React.CSSProperties}
      >
        {view === "messages" ? (
          <MessagesView run={run} />
        ) : running ? (
          <RunningBars />
        ) : run.status === "cancelled" ? (
          <Outcome
            detail="Nothing was returned for the statements that had not finished."
            title="Run cancelled"
            tone="muted"
          />
        ) : !statement ? (
          run.status === "error" ? (
            <Outcome
              detail={run.error?.message ?? "See Messages for the full error."}
              title="Statement failed"
              tone="error"
            />
          ) : (
            <Outcome detail="The run produced no statements." title="Nothing to show" tone="muted" />
          )
        ) : !isRowResult(statement) ? (
          <CommandOutcome result={statement} />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            {statement.truncated && (
              <p className="shrink-0 border-border border-b bg-warning/8 px-2 py-1 text-warning-foreground text-xs">
                Showing the first {statement.rowCount.toLocaleString()} rows — the result was cut at
                the server&rsquo;s row limit.
              </p>
            )}
            <div className="min-h-0 flex-1">
              <ResultsGrid animateRows result={statement} />
            </div>
          </div>
        )}
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
          <Button
            render={<a download href={exportHref} />}
            size="xs"
            variant="ghost"
          >
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

/**
 * The wait, inline. Six loose rows rather than the pane's full fake grid: a cell is nine rows tall at
 * most, so a skeleton shaped like a complete table would overshoot and snap shut when the rows land.
 */
function RunningBars(): React.ReactElement {
  return (
    <div aria-busy aria-label="Running" className="space-y-2 p-2.5" role="status">
      {Array.from({ length: 6 }, (_, row) => (
        <div className="grid grid-cols-3 gap-2" key={row}>
          {Array.from({ length: 3 }, (_, col) => (
            <Skeleton className="h-4" key={col} />
          ))}
        </div>
      ))}
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
