// The grid a doubly-correlated subquery is shown as: outer rows down the side, the middle query's
// driving rows across the top, one cell per pair.
//
// The row-sum is NOT counted from the cells. It comes from the count the per-row probe already asks
// for, which is the number the ledger has always shown — the grid's job is to show what that number
// was counting, and a second way of arriving at it could only ever disagree with the first. The one
// exception is a subquery no honest count could be asked for, where the cells are all there is.

import type { Cell, StatementResult } from "@perch/protocol";
import { formatCell } from "../../results-grid";
import { bindKeyOf, type BoundPlan, type BoundRow } from "../bound";
import { cellFound, cellTone, MAX_DRIVE_COLS, type GridBuild } from "../grid";
import type { GridColumn, GridPick } from "../use-grid";
import { colsOf, positional, visibleIndices } from "./columns";
import type { Col, GridCellView, GridRowView, Scene, TableView } from "./types";

export function gridScene(args: {
  readonly plan: BoundPlan;
  readonly grid: GridBuild;
  readonly outer: StatementResult;
  readonly rows: readonly BoundRow[];
  readonly columns: readonly GridColumn[];
  readonly cells: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
  readonly current: number;
  readonly picked: GridPick | null;
  /** Outer rows whose test has run in this playback pass; null once nothing is arriving. */
  readonly reveal: number | null;
  /** The probe's cap fell short of the last outer rows. */
  readonly truncated: boolean;
  readonly covered: number;
  /** The cards beside the grid. */
  readonly tables: readonly TableView[];
  readonly count: number | null;
}): Scene {
  const { plan, grid, outer, rows, columns, cells, current, picked, reveal, tables } = args;
  const indices = visibleIndices(outer);
  const cols: Col[] = colsOf(outer, indices, positional);

  // Past the fold the columns are not narrowed, they are DROPPED: a grid with thirteen courses
  // across the top is a wall of dots nobody can read a row of, and the count beside it already says
  // what they add up to. What is left is the ledger this view specialises, plus a `+n` that says how
  // many driving rows went into each number — the same bargain `capCols` strikes on a wide card.
  const folded = columns.length > MAX_DRIVE_COLS;
  const shown = folded ? [] : columns;

  const gridRows: GridRowView[] = rows.map((row, index) => {
    const values: Record<string, Cell> = {};
    indices.forEach((column, position) => {
      values[cols[position]!.id] = outer.rows[index]?.[column] ?? null;
    });
    const answers = cells.get(bindKeyOf(row));
    const name = formatCell(outer.rows[index]?.[indices[0] ?? -1] ?? null);
    const state: GridRowView["state"] =
      reveal === null || index < reveal - 1 ? "done" : index === reveal - 1 ? "filling" : "pending";
    return {
      key: row.key,
      cells: values,
      grid: shown.map((column): GridCellView => {
        const returned = answers?.get(column.key) ?? null;
        const found = returned !== null && cellFound(returned, grid.innerKind);
        return {
          key: column.key,
          returned,
          tone: returned === null ? "quiet" : cellTone(returned, grid.middleKind),
          found,
          picked: picked !== null && picked.row === index && picked.column === column.key,
          label:
            returned === null
              ? `${name} and ${column.label}: not probed`
              : `${name} and ${column.label}: ${grid.innerSource} ${
                  found ? "has a matching row" : "has no matching row"
                }, so this ${grid.driveNoun} is ${returned ? "returned" : "not returned"}`,
        };
      }),
      returned: row.matches ?? sumOf(answers, columns),
      verdict: row.pass ? "pass" : "fail",
      current: index === current,
      state,
    };
  });

  const passes = rows.filter((row) => row.pass).length;
  const rowNote = `${rows.length} ${rows.length === 1 ? "row" : "rows"} · ${passes} pass`;
  // The truncation is said in the header rather than hidden, because a row with no cells beside a
  // row full of them otherwise reads as a row where nothing matched.
  const short =
    args.truncated && args.covered < rows.length
      ? ` · cells for ${args.covered} of ${rows.length}`
      : "";

  return {
    kind: "grid",
    grid: {
      key: "grid",
      title: plan.section.label,
      note: `runs once per row of ${plan.outer.label} · ${rowNote}${short}`,
      cols,
      group: {
        title: grid.driveTitle,
        columns: shown.map((column) => ({ id: column.key, label: column.label })),
        hidden: folded ? columns.length : 0,
      },
      rows: gridRows,
      countLabel: "returned",
      legend: legendFor(grid, folded),
      settled: reveal === null,
    },
    tables,
    count: args.count,
  };
}

/** The row-sum from the cells, for the one case where no count could be asked for. Null unless every
 *  cell of the row arrived: a sum over half a row is a number that is simply wrong. */
function sumOf(
  answers: ReadonlyMap<string, boolean> | undefined,
  columns: readonly GridColumn[],
): number | null {
  if (!answers || answers.size < columns.length) return null;
  return columns.filter((column) => answers.get(column.key) === true).length;
}

/**
 * What the glyphs and the tints mean, in the reader's own nouns.
 *
 * Both axes are stated because they are independent and the pair is what is easy to get backwards: a
 * filled dot says the inner subquery FOUND rows, and the tint says what that does to the outer row's
 * verdict. Under `not exists` of `not exists` the two run opposite ways — the cell with nothing in it
 * is the one that sinks the row — which is exactly why neither is left to be inferred.
 */
function legendFor(grid: GridBuild, folded: boolean): string[] {
  const { driveNoun, rowNoun, innerSource, middleKind } = grid;
  const negativeMiddle = middleKind === "not exists" || middleKind === "not in";
  const foundIsReturned = !(grid.innerKind === "not exists" || grid.innerKind === "not in");
  const says = (returned: boolean): string =>
    returned ? `${driveNoun} returned` : `${driveNoun} not returned`;
  // Kept to three lines, because the card is already taller than the stage on a 13-row grid and
  // every line here is one more row of it the reader has to scroll past to reach the rows.
  const lines = [
    `Each cell is \`${grid.innerText.replace(/\s+/g, " ").trim()}\` for that ${rowNoun} and that ${driveNoun}.`,
  ];
  if (!folded) {
    lines.push(
      `● \`${innerSource}\` has a matching row — ${says(foundIsReturned)}. ○ no matching row — ${says(!foundIsReturned)}. Click a cell to bind the SQL beside this to it.`,
    );
  }
  lines.push(
    `Every returned ${driveNoun} is one row of this subquery, and \`${middleKind}\` passes the ${rowNoun} ${
      negativeMiddle ? "only when there are none at all" : "as soon as there is one"
    } — so those are the cells that decide the verdict.`,
  );
  return lines;
}
