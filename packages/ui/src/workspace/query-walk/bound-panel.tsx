"use client";

// The reading side of a per-row section, laid out like the station narrator so the two do not feel
// like different screens: what this section is, what happened for the row currently bound, what
// happened in the cell that is picked, and the SQL underneath as reference.
//
// The SQL tab is the point of the whole feature. "The subquery" is what the user wrote, correlated
// references and all; "SQL that ran" is the same text with this row's values written over them, and
// watching `takes.ID = s.ID` become `takes.ID = '12345'` as the scrubber moves is the lesson that no
// amount of prose delivers. A picked cell puts BOTH of its values in at once, which is the only
// place in the walk where a statement carries two of the reader's own values.

import { CornerUpRightIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../../ui/tabs";
import { highlightSql } from "../sql-editor/highlight-sql";
import { boundRowParts, type BoundPlan, type BoundRow } from "./bound";
import type { SqlPart } from "./clauses";
import type { GridBuild } from "./grid";
import {
  boundCountSentence,
  boundNullSentence,
  boundRowSentence,
  boundSentence,
  gridCellSentence,
  gridRowSentence,
  gridSentence,
  membershipSentence,
  notInNullSentence,
  scalarSentence,
  scalarShapeSentence,
} from "./narration";
import { Sentence } from "./narrator";
import type { AnswerView } from "./scenes";
import { SqlParts } from "./sql-parts";
import type { GridColumn } from "./use-grid";
import type { QueryOutcome } from "./use-walk";

/** The picked cell, once there is one: which column, the statement it ran, and what came back. */
export type PickedCell = {
  readonly column: GridColumn;
  readonly parts: readonly SqlPart[] | null;
  readonly result: QueryOutcome | undefined;
  /**
   * What the cell answered, as the grid probe measured it.
   *
   * Never re-derived from the rows the cell's own probe brought back. Those rows are the evidence
   * and this is the verdict, and the one moment they would disagree is the moment the cell's probe
   * has not landed yet — where guessing would print "false" over a cell the grid is drawing as true.
   */
  readonly returned: boolean | null;
};

export function BoundPanel({
  plan,
  grid,
  gridColumns,
  answer,
  row,
  cell,
  caption,
  innerError,
  durationMs,
  onOpenOuter,
}: {
  readonly plan: BoundPlan;
  /** Set when this section is being shown as a grid, which changes every sentence below. */
  readonly grid: GridBuild | null;
  /** Driving rows across the grid, for "3 of the 5 rows of RequiredCourses". */
  readonly gridColumns: number;
  /**
   * The card beside the ledger, when the kind has one of its own.
   *
   * It is what the sentences for IN and for a scalar are written from — the needle and its match,
   * the value that came back, the row count that broke the one-row promise — so the panel and the
   * card can never disagree about what the subquery answered.
   */
  readonly answer: AnswerView | null;
  /** Null until the outer probe has landed and there is a row to stand on. */
  readonly row: BoundRow | null;
  readonly cell: PickedCell | null;
  readonly caption: string;
  readonly innerError: string | null;
  readonly durationMs: number | null;
  readonly onOpenOuter: () => void;
}): React.ReactElement {
  const [tab, setTab] = React.useState("ran");
  const nulls = boundNullSentence(row?.nulls ?? []);
  const countless = boundCountSentence(plan);
  // The two caveats only IN and a scalar have: the null that sinks every row of a NOT IN, and the
  // exactly-one-row promise a scalar subquery makes.
  const poison = answer === null ? null : notInNullSentence(plan, answer);
  const shape = answer === null ? null : scalarShapeSentence(plan, answer);
  const rowParts = React.useMemo(() => (row ? boundRowParts(plan, row) : null), [plan, row]);

  return (
    <aside
      aria-label="Narrator"
      className="flex min-h-0 min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
    >
      <div className="flex items-center gap-2">
        <h2 className="min-w-0 truncate font-medium font-mono text-sm">{plan.section.label}</h2>
        <Button
          aria-label={`Go to ${plan.outer.label}, the section this one runs for`}
          className="ms-auto shrink-0"
          onClick={onOpenOuter}
          size="xs"
          variant="outline"
        >
          <CornerUpRightIcon /> {plan.outer.label}
        </Button>
      </div>

      <div className="min-h-24">
        <p aria-live="polite" className="text-muted-foreground text-xs">
          {caption}
        </p>
        <p className="mt-1.5 text-foreground text-sm leading-relaxed">
          <Sentence text={grid ? gridSentence(plan, grid) : boundSentence(plan)} />
        </p>
        {row && (
          <p className="mt-2 text-foreground text-sm leading-relaxed">
            <Sentence text={rowSentence({ plan, grid, gridColumns, answer, row })} />
          </p>
        )}
        {/* The cell's own sentence, which only exists once one is picked. It sits after the row's
            because a cell is one term of the sum that sentence just quoted. */}
        {grid && row && cell && cell.returned !== null && (
          <p className="mt-2 text-foreground text-sm leading-relaxed">
            <Sentence
              text={gridCellSentence({
                grid,
                bound: boundPairs(plan, row, cell),
                label: cell.column.label,
                returned: cell.returned,
                rows: cell.result?.ok ? cell.result.result.rowCount : null,
              })}
            />
          </p>
        )}
      </div>

      {/* The two caveats. Neither is an error, and both are things a reader would otherwise blame
          on their own query: a null that matches nothing, and a count the dialect would not give. */}
      {nulls && (
        <p className="rounded-md border bg-muted/40 p-2.5 text-muted-foreground text-xs leading-relaxed">
          <Sentence text={nulls} />
        </p>
      )}
      {countless && (
        <p className="rounded-md border bg-muted/40 p-2.5 text-muted-foreground text-xs leading-relaxed">
          <Sentence text={countless} />
        </p>
      )}
      {poison && (
        <p className="rounded-md border border-destructive/30 bg-destructive/8 p-2.5 text-destructive-foreground text-xs leading-relaxed">
          <Sentence text={poison} />
        </p>
      )}
      {shape && (
        <p className="rounded-md border bg-muted/40 p-2.5 text-muted-foreground text-xs leading-relaxed">
          <Sentence text={shape} />
        </p>
      )}

      <Tabs className="min-h-0 flex-1" onValueChange={(next) => setTab(String(next))} value={tab}>
        <TabsList size="sm">
          <TabsTab value="ran">SQL that ran</TabsTab>
          <TabsTab value="query">The subquery</TabsTab>
        </TabsList>
        <TabsPanel className="min-h-0 overflow-auto" value="ran">
          <div className="flex flex-col gap-2">
            {/* The picked cell first: it is the innermost thing that ran and the only statement
                here carrying two substituted values. */}
            {cell?.parts && (
              <div className="min-w-0">
                <p className="mb-1 text-muted-foreground text-xs">
                  The picked cell, with both of its values in place
                </p>
                <SqlParts parts={cell.parts} />
                {cell.result && !cell.result.ok && (
                  <p className="mt-1 whitespace-pre-wrap font-mono text-destructive-foreground text-xs">
                    {cell.result.error}
                  </p>
                )}
              </div>
            )}
            <div className="min-w-0">
              <p className="mb-1 text-muted-foreground text-xs">
                This row&apos;s values, in place of the correlated columns
                {durationMs !== null && <span className="opacity-70"> · {durationMs} ms</span>}
              </p>
              {rowParts ? (
                <SqlParts parts={rowParts} />
              ) : (
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
                  {highlightSql(plan.section.text)}
                </pre>
              )}
              {innerError && (
                <p className="mt-1 whitespace-pre-wrap font-mono text-destructive-foreground text-xs">
                  {innerError}
                </p>
              )}
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-muted-foreground text-xs">
                Every outer row at once, with its verdict{plan.counting !== null && " and match count"}
              </p>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
                {highlightSql(plan.counting === null ? plan.verdictSql : plan.outerSql)}
              </pre>
            </div>
            {/* The grid's own probe. It writes no literal at all — every fragment of it is a range
                sliced out of the query — which is worth being able to check by eye. */}
            {grid && (
              <div className="min-w-0">
                <p className="mb-1 text-muted-foreground text-xs">
                  Every cell at once: the outer rows crossed with {grid.driveTitle}
                </p>
                <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
                  {highlightSql(grid.sql)}
                </pre>
              </div>
            )}
          </div>
        </TabsPanel>
        <TabsPanel className="min-h-0 overflow-auto" value="query">
          <pre className="whitespace-pre-wrap font-mono text-sm leading-6">
            <span className="opacity-40">{highlightSql(plan.section.text)}</span>
          </pre>
        </TabsPanel>
      </Tabs>
    </aside>
  );
}

/**
 * What happened for the bound row, in the vocabulary of its own predicate kind.
 *
 * A grid answers in driving rows, IN answers in membership, a scalar answers in one comparison, and
 * EXISTS answers in rows — four different sentences because they are four different questions, and
 * the shared one they used to have was only ever right about the last of them.
 */
function rowSentence(args: {
  readonly plan: BoundPlan;
  readonly grid: GridBuild | null;
  readonly gridColumns: number;
  readonly answer: AnswerView | null;
  readonly row: BoundRow;
}): string {
  const { plan, grid, gridColumns, answer, row } = args;
  if (grid) return gridRowSentence(plan, grid, row, gridColumns);
  if (answer?.kind === "values") return membershipSentence(plan, row, answer);
  if (answer?.kind === "equation") return scalarSentence(plan, row, answer);
  return boundRowSentence(plan, row);
}

/** The substitutions a cell's SQL made, spelled the way the panel highlights them. */
function boundPairs(plan: BoundPlan, row: BoundRow, cell: PickedCell): string[] {
  return [
    ...plan.columns.map((column) => `${column.ref} = ${row.literals.get(column.ref) ?? "null"}`),
    ...[...cell.column.literals].map(([ref, literal]) => `${ref} = ${literal}`),
  ];
}
