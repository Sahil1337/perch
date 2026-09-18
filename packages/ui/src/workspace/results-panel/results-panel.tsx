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

import { DownloadIcon, ScrollTextIcon, TableIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Kbd } from "../../ui/kbd";
import { Tabs, TabsList, TabsTab } from "../../ui/tabs";
import { useFade } from "../../lib/motion";
import { useWorkspace } from "../context";
import { type ResultsView, type Run, runStatements } from "../types";
import { summaryOf } from "./format";
import { RunningRows } from "./skeletons";
import { ResultBody, StatementStrip } from "./statement-view";

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
  const summary = summaryOf(current, statement);
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
        {summary !== null && (
          <p className="min-w-0 truncate text-muted-foreground text-xs tabular-nums">{summary}</p>
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
            ) : (
              <ResultBody
                run={current}
                skeleton={<RunningRows />}
                statement={statement}
                view={view}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}

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

function EmptyState(): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground text-sm">
      <span>Run a query to see results</span>
      <Kbd>⌘↵</Kbd>
    </div>
  );
}
