import type { StatementResult } from "@perch/protocol";
import * as React from "react";
import { Tabs, TabsList, TabsTab } from "../../ui/tabs";
import { ResultsGrid } from "../results-grid";
import type { ResultsView, Run } from "../types";
import { isRowResult, statementSummary } from "./format";
import { CommandOutcome, MessagesView, Outcome } from "./messages";

/**
 * One tab per statement outcome. Hidden for a single-statement run, where it would only be a
 * second copy of the row count already in the toolbar.
 */
export function StatementStrip({
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

/**
 * What one statement turns into. The pane and a notebook cell read the same run the same way, so the
 * cascade lives once: only the shape of the wait and whether rows cascade in differ between them.
 */
export function ResultBody({
  run,
  statement,
  view,
  skeleton,
  animateRows = false,
}: {
  run: Run;
  statement: StatementResult | undefined;
  view: ResultsView;
  /** The wait, in the caller's own shape: a pane fills with a fake grid, a cell with loose bars. */
  skeleton: React.ReactElement;
  animateRows?: boolean;
}): React.ReactElement {
  if (view === "messages") return <MessagesView run={run} />;
  if (run.status === "running") return skeleton;

  if (run.status === "cancelled") {
    return (
      <Outcome
        detail="Nothing was returned for the statements that had not finished."
        title="Run cancelled"
        tone="muted"
      />
    );
  }

  if (!statement) {
    return run.status === "error" ? (
      <Outcome
        detail={run.error?.message ?? "See Messages for the full error."}
        title="Statement failed"
        tone="error"
      />
    ) : (
      <Outcome detail="The run produced no statements." title="Nothing to show" tone="muted" />
    );
  }

  if (!isRowResult(statement)) return <CommandOutcome result={statement} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {statement.truncated && (
        <p className="shrink-0 border-border border-b bg-warning/8 px-2 py-1 text-warning-foreground text-xs">
          Showing the first {statement.rowCount.toLocaleString()} rows — the result was cut at the
          server&rsquo;s row limit.
        </p>
      )}
      <div className="min-h-0 flex-1">
        <ResultsGrid animateRows={animateRows} result={statement} />
      </div>
    </div>
  );
}
