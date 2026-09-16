"use client";

// Running a per-row section: one probe for the outer rows, and one more for whichever row is bound.
//
// THE OUTER PROBE runs once, when the section is first opened. It asks for the count and the verdict
// together; if the database refuses that statement it is asked again without the count, because the
// shapes that fail are the ones where counting needs a derived table and the dialect will not
// resolve an outer reference through one. A failure there is a limit, not the user's mistake, so the
// fallback is tried before anything red is shown.
//
// THE ROW PROBES are lazy and cached. Firing all 25 on entry would send 25 statements for a section
// the reader may glance at and leave, and it would make the first row wait behind the last; probing
// the row that is actually bound, as it becomes bound, sends exactly the ones that get looked at,
// and the cache means scrubbing back over rows already seen costs nothing.

import type { StatementResult } from "@perch/protocol";
import * as React from "react";
import { boundRows, boundRowSql, type BoundPlan, type BoundRow } from "./bound";
import { SAMPLE_ROWS } from "./steps";
import type { Probe, QueryOutcome } from "./use-walk";

export type BoundRun = {
  readonly outer: StatementResult | null;
  /** The outer probe could not run at all: both shapes of it failed. */
  readonly outerError: string | null;
  readonly loadingOuter: boolean;
  readonly rows: readonly BoundRow[];
  /** The row currently bound, clamped to what came back. */
  readonly current: number;
  readonly bind: (index: number) => void;
  /** The subquery's own rows for the bound row, once its probe has landed. */
  readonly inner: QueryOutcome | undefined;
  /** The statement that produced them, literals and all — this is the SQL worth reading. */
  readonly innerSql: string | null;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first statement's result, or the reason there is none. */
function only(record: Awaited<ReturnType<Probe>>): QueryOutcome {
  const result = record.results?.[0];
  if (result) return { ok: true, result };
  return { ok: false, error: record.error?.message ?? "The database returned nothing.", skipped: false };
}

export function useBoundRun(plan: BoundPlan, probe: Probe): BoundRun {
  const [outer, setOuter] = React.useState<QueryOutcome | null>(null);
  const [rowResults, setRowResults] = React.useState<ReadonlyMap<number, QueryOutcome>>(new Map());
  const [wanted, setWanted] = React.useState(0);
  /** Rows whose probe is in the air, so a scrub away and back does not send it twice. */
  const flying = React.useRef<Set<number>>(new Set());
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Keyed on the plan, so opening a different bound section — or editing the query — starts clean
  // rather than showing the previous section's rows under this one's labels.
  const [seen, setSeen] = React.useState(plan);
  if (seen !== plan) {
    setSeen(plan);
    setOuter(null);
    setRowResults(new Map());
    setWanted(0);
    flying.current = new Set();
  }

  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const first = only(await probe(plan.outerSql, { maxRows: SAMPLE_ROWS }));
        if (cancelled) return;
        if (first.ok || plan.counting === null) {
          setOuter(first);
          return;
        }
        // The count is the only thing the two statements differ by, so a failure of the first is
        // reason to drop it rather than to give up on the section.
        const second = only(await probe(plan.verdictSql, { maxRows: SAMPLE_ROWS }));
        if (cancelled) return;
        setOuter(second.ok ? second : first);
      } catch (error) {
        if (!cancelled) setOuter({ ok: false, error: messageOf(error), skipped: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan, probe]);

  const sample = outer?.ok ? outer.result : null;
  const rows = React.useMemo(() => (sample ? boundRows(plan, sample) : []), [plan, sample]);
  const current = rows.length === 0 ? 0 : Math.min(wanted, rows.length - 1);
  const row = rows[current];
  const innerSql = React.useMemo(() => (row ? boundRowSql(plan, row) : null), [plan, row]);

  const cached = rowResults.get(current);
  // Deliberately without a cleanup that cancels: a reader dragging the scrubber crosses rows faster
  // than the database answers, and throwing away every answer they scrubbed past would mean probing
  // the same rows again on the way back. The result is filed under the row it was asked for, so a
  // late one lands in the right place or, once the section is gone, nowhere.
  React.useEffect(() => {
    if (innerSql === null || cached !== undefined || flying.current.has(current)) return;
    const index = current;
    flying.current.add(index);
    void (async () => {
      let outcome: QueryOutcome;
      try {
        outcome = only(await probe(innerSql, { maxRows: SAMPLE_ROWS }));
      } catch (error) {
        outcome = { ok: false, error: messageOf(error), skipped: false };
      }
      flying.current.delete(index);
      if (alive.current) setRowResults((previous) => new Map(previous).set(index, outcome));
    })();
  }, [cached, current, innerSql, probe]);

  return {
    outer: sample,
    outerError: outer && !outer.ok ? outer.error : null,
    loadingOuter: outer === null,
    rows,
    current,
    bind: setWanted,
    inner: cached,
    innerSql,
  };
}
