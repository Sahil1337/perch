"use client";

// The reading side of a per-row section, laid out like the station narrator so the two do not feel
// like different screens: what this section is, what happened for the row currently bound, and the
// two pieces of SQL underneath as reference.
//
// The SQL tab is the point of the whole feature. "The subquery" is what the user wrote, correlated
// references and all; "SQL that ran" is the same text with this row's values written over them, and
// watching `takes.ID = s.ID` become `takes.ID = '12345'` as the scrubber moves is the lesson that no
// amount of prose delivers.

import { CornerUpRightIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import { Tabs, TabsList, TabsPanel, TabsTab } from "../../ui/tabs";
import { highlightSql } from "../sql-editor/highlight-sql";
import type { BoundPlan, BoundRow } from "./bound";
import { boundCountSentence, boundNullSentence, boundRowSentence, boundSentence } from "./narration";
import { Sentence } from "./narrator";

export function BoundPanel({
  plan,
  row,
  caption,
  innerSql,
  innerError,
  durationMs,
  onOpenOuter,
}: {
  readonly plan: BoundPlan;
  /** Null until the outer probe has landed and there is a row to stand on. */
  readonly row: BoundRow | null;
  readonly caption: string;
  readonly innerSql: string | null;
  readonly innerError: string | null;
  readonly durationMs: number | null;
  readonly onOpenOuter: () => void;
}): React.ReactElement {
  const [tab, setTab] = React.useState("ran");
  const nulls = boundNullSentence(row?.nulls ?? []);
  const countless = boundCountSentence(plan);

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
          <Sentence text={boundSentence(plan)} />
        </p>
        {row && (
          <p className="mt-2 text-foreground text-sm leading-relaxed">
            <Sentence text={boundRowSentence(plan, row)} />
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

      <Tabs className="min-h-0 flex-1" onValueChange={(next) => setTab(String(next))} value={tab}>
        <TabsList size="sm">
          <TabsTab value="ran">SQL that ran</TabsTab>
          <TabsTab value="query">The subquery</TabsTab>
        </TabsList>
        <TabsPanel className="min-h-0 overflow-auto" value="ran">
          <div className="flex flex-col gap-2">
            <div className="min-w-0">
              <p className="mb-1 text-muted-foreground text-xs">
                This row&apos;s values, in place of the correlated columns
                {durationMs !== null && <span className="opacity-70"> · {durationMs} ms</span>}
              </p>
              <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
                {highlightSql(innerSql ?? plan.section.text)}
              </pre>
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
