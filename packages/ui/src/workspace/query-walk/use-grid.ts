// The grid's two probes: one for every cell at once, and one more for whichever cell is picked.
//
// THE GRID PROBE runs once, beside the per-row section's own outer probe. It is the outer query
// crossed with the middle query's driving rows, so one statement fills the whole grid; nothing here
// runs a query per cell, which for the relational-division query would be 65 of them.
//
// THE CELL PROBE is lazy, and fires only when a reader picks a cell — the same bargain the per-row
// card already strikes for its rows. Most cells are never looked at, and the grid has already said
// what each one answered; the probe is for the rows BEHIND that answer.
//
// When the grid probe fails the view falls back to the ledger silently. A dialect that will not take
// the shape is a limit of the dialect, not a fault in the reader's query, and the per-row view it
// falls back to is the one that shipped before this existed.

import type { Cell, StatementResult } from "@perch/protocol";
import * as React from "react";
import { bindKey, bindKeyOf, cellParts, partsSql, sqlLiteral, type BoundRow } from "./bound";
import type { SqlPart } from "./clauses";
import type { GridBuild } from "./grid";
import { messageOf, only, type QueryOutcome } from "./probe-outcome";
import { MAX_GRID_CELLS } from "./grid";
import { truthy } from "./scenes/columns";
import { bindColumn, CELL_COLUMN, driveColumn, SAMPLE_ROWS } from "./steps";
import type { Probe } from "./use-walk";

/** One column of the grid: one driving row, and the value that names it. */
export type GridColumn = {
  readonly key: string;
  /** What the header shows: the driving key's value, as the results grid would format it. */
  readonly label: string;
  /** The driving reference → the literal a cell's SQL writes over it. */
  readonly literals: ReadonlyMap<string, string>;
};

type GridRun = {
  /** Null while the probe is out, and for good once it has failed. */
  readonly columns: readonly GridColumn[];
  /** Outer row (by its bound literals) → column key → the inner predicate's answer. */
  readonly cells: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
  readonly loading: boolean;
  /** The grid could not be filled, so the view falls back to the ledger. */
  readonly failed: boolean;
  /** The probe hit its cap, so the outer rows past this many have no cells. */
  readonly truncated: boolean;
  /** How many outer rows the probe covered whole. */
  readonly covered: number;
  /** The cell the SQL panel and the cell card are bound to. */
  readonly picked: GridPick | null;
  readonly pick: (pick: GridPick | null) => void;
  /** The picked cell's statement, split so the panel can cross-fade only its two literals. */
  readonly cellParts: readonly SqlPart[] | null;
  readonly cell: QueryOutcome | undefined;
};

export type GridPick = { readonly row: number; readonly column: string };

const NO_COLUMNS: readonly GridColumn[] = [];
const NO_CELLS: ReadonlyMap<string, ReadonlyMap<string, boolean>> = new Map();

export function useGridRun(
  grid: GridBuild | null,
  rows: readonly BoundRow[],
  probe: Probe,
): GridRun {
  const [outcome, setOutcome] = React.useState<QueryOutcome | null>(null);
  const [picked, setPicked] = React.useState<GridPick | null>(null);
  const [cells, setCells] = React.useState<ReadonlyMap<string, QueryOutcome>>(new Map());
  const flying = React.useRef<Set<string>>(new Set());
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Keyed on the build, so opening a different section — or editing the query — starts clean rather
  // than showing the last grid's cells under this one's headers.
  const [seen, setSeen] = React.useState(grid);
  if (seen !== grid) {
    setSeen(grid);
    setOutcome(null);
    setPicked(null);
    setCells(new Map());
    flying.current = new Set();
  }

  React.useEffect(() => {
    if (grid === null) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = only(await probe(grid.sql, { maxRows: MAX_GRID_CELLS }));
        if (!cancelled) setOutcome(result);
      } catch (error) {
        if (!cancelled) setOutcome({ ok: false, error: messageOf(error), skipped: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [grid, probe]);

  const sample = outcome?.ok ? outcome.result : null;
  const read = React.useMemo(
    () => (grid && sample ? readGrid(grid, sample) : null),
    [grid, sample],
  );

  const row = picked ? rows[picked.row] : undefined;
  const column = picked ? read?.columns.find((entry) => entry.key === picked.column) : undefined;
  const cellParams = React.useMemo(() => {
    if (!grid || !row || !column) return null;
    const literals = new Map([...row.literals, ...column.literals]);
    const parts = cellParts(grid, literals);
    return { key: `${bindKeyOf(row)}::${column.key}`, sql: partsSql(parts), parts };
  }, [column, grid, row]);

  const cached = cellParams ? cells.get(cellParams.key) : undefined;
  React.useEffect(() => {
    if (!cellParams || cached !== undefined || flying.current.has(cellParams.key)) return;
    const { key, sql } = cellParams;
    flying.current.add(key);
    void (async () => {
      let result: QueryOutcome;
      try {
        result = only(await probe(sql, { maxRows: SAMPLE_ROWS }));
      } catch (error) {
        result = { ok: false, error: messageOf(error), skipped: false };
      }
      flying.current.delete(key);
      if (alive.current) setCells((previous) => new Map(previous).set(key, result));
    })();
  }, [cached, cellParams, probe]);

  return {
    columns: read?.columns ?? NO_COLUMNS,
    cells: read?.cells ?? NO_CELLS,
    loading: grid !== null && outcome === null,
    failed: outcome !== null && !outcome.ok,
    truncated: sample?.truncated ?? false,
    covered: read?.covered ?? 0,
    picked,
    pick: setPicked,
    cellParts: cellParams?.parts ?? null,
    cell: cached,
  };
}

/**
 * The probe's rows read back as columns and cells.
 *
 * Columns come out in the order the probe returned them, which the ORDER BY makes the driving key's
 * own order, and a driving value that appears for one outer row appears for all of them — it is a
 * cross join, so the axis is the same for every row. `covered` counts the outer rows that arrived
 * WHOLE: the ORDER BY puts the bind key first exactly so a cap falls between rows, and the last row
 * of a truncated sample is the one that may be short.
 */
function readGrid(
  grid: GridBuild,
  sample: StatementResult,
): {
  columns: GridColumn[];
  cells: Map<string, Map<string, boolean>>;
  covered: number;
} {
  const at = (name: string): number =>
    sample.columns.findIndex((column) => column.name.toLowerCase() === name.toLowerCase());
  const bindAt = grid.columns.map((_, index) => at(bindColumn(index)));
  const driveAt = grid.drives.map((_, index) => at(driveColumn(index)));
  const cellAt = at(CELL_COLUMN);

  const literalAt = (row: readonly Cell[], index: number): string =>
    index < 0 ? "null" : sqlLiteral(row[index] ?? null, grid.dialect, sample.columns[index]);
  const textAt = (row: readonly Cell[], index: number): string => {
    const value = index < 0 ? null : (row[index] ?? null);
    return value === null ? "null" : String(value);
  };

  const columns: GridColumn[] = [];
  const known = new Set<string>();
  const cells = new Map<string, Map<string, boolean>>();
  const order: string[] = [];

  for (const raw of sample.rows) {
    const key = bindKey(bindAt.map((index) => literalAt(raw, index)));
    const columnKey = JSON.stringify(driveAt.map((index) => literalAt(raw, index)));
    if (!known.has(columnKey)) {
      known.add(columnKey);
      columns.push({
        key: columnKey,
        label: driveAt.map((index) => textAt(raw, index)).join(" · "),
        literals: new Map(
          grid.drives.map((drive, i) => [drive.ref, literalAt(raw, driveAt[i] ?? -1)]),
        ),
      });
    }
    let byColumn = cells.get(key);
    if (!byColumn) {
      byColumn = new Map();
      cells.set(key, byColumn);
      order.push(key);
    }
    // Read the same way the verdict is: a driver that hands a boolean back as `1`, `t` or `true`
    // has said the same thing, and a predicate that evaluated to unknown comes back null — which is
    // not true, and is exactly what a WHERE would make of it.
    byColumn.set(columnKey, truthy(raw[cellAt] ?? null));
  }

  // A truncated sample's LAST outer row is the one the cap may have cut in half. Showing four of a
  // student's five courses as if that were the whole row would put a wrong row-sum on screen, so a
  // short last row is dropped — and one that happens to be whole is kept, because it is whole.
  const last = order[order.length - 1];
  const short =
    sample.truncated && last !== undefined && (cells.get(last)?.size ?? 0) < columns.length;
  if (short && last !== undefined) cells.delete(last);
  return { columns, cells, covered: cells.size };
}
