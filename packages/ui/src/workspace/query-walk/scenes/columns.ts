// Turning a StatementResult into the columns and rows a card shows. Rows keep stable keys across
// phases — the hash of their visible cells — so layout animations can carry a row from one
// arrangement to the next, and a row that is gone from the next sample animates out.

import type { Cell, ResultColumn, StatementResult } from "@perch/protocol";
import { formatCell } from "../../results-grid";
import { splitRef } from "../clauses";
import { WALK_PREFIX } from "../steps";
import type { Col, Row } from "./types";

const CHAR_PX = 6.8;
const MIN_WIDTH = 48;
const MAX_WIDTH = 220;

export function widthFor(label: string, values: readonly Cell[]): number {
  let chars = label.length;
  for (const value of values) chars = Math.max(chars, formatCell(value).length);
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, 16 + chars * CHAR_PX)));
}

/** Indices of the columns worth showing: not the walk's own bookkeeping columns. */
export function visibleIndices(result: StatementResult): number[] {
  return result.columns.flatMap((column, index) =>
    column.name.startsWith(WALK_PREFIX) ? [] : [index],
  );
}

export function isNumeric(column: ResultColumn): boolean {
  return column.align === "right";
}

export function colsOf(
  result: StatementResult,
  indices: readonly number[],
  idFor: (index: number) => string,
): Col[] {
  return indices.map((index) => {
    const column = result.columns[index]!;
    return {
      id: idFor(index),
      label: column.name,
      width: widthFor(
        column.name,
        result.rows.map((row) => row[index] ?? null),
      ),
      num: isNumeric(column),
    };
  });
}

export const positional = (index: number): string => `c${index}`;

const CELL_SEPARATOR = "";

export function hashCells(row: readonly Cell[], indices: readonly number[]): string {
  return indices.map((index) => formatCell(row[index] ?? null)).join(CELL_SEPARATOR);
}

/**
 * Rows keyed by the hash of `keyIndices` (default: the shown columns), with a `#n` suffix on
 * repeats so two identical rows stay two rows.
 */
export function rowsOf(
  result: StatementResult,
  cols: readonly Col[],
  indices: readonly number[],
  prefix: string,
  keyIndices: readonly number[] = indices,
): Row[] {
  const seen = new Map<string, number>();
  return result.rows.map((row) => {
    const hash = hashCells(row, keyIndices);
    const dup = seen.get(hash) ?? 0;
    seen.set(hash, dup + 1);
    const cells: Record<string, Cell> = {};
    indices.forEach((index, at) => {
      cells[cols[at]!.id] = row[index] ?? null;
    });
    return { key: `${prefix}${hash}${dup > 0 ? `#${dup}` : ""}`, cells };
  });
}

export const withHl = (cols: readonly Col[], ids: ReadonlySet<string>): Col[] =>
  cols.map((col) => (ids.has(col.id) ? { ...col, hl: true } : col));

/** The column a `o.customer_id` names, preferring one the driver says comes from that table. */
export function findColumn(
  result: StatementResult,
  indices: readonly number[],
  ref: string,
  tableOf: (qualifier: string) => string | null,
): number | null {
  const { qualifier, column } = splitRef(ref.trim());
  const name = column.toLowerCase();
  const table = qualifier ? (tableOf(qualifier) ?? qualifier).toLowerCase() : null;
  let byName: number | null = null;
  for (const index of indices) {
    const candidate = result.columns[index]!;
    if (candidate.name.toLowerCase() !== name) continue;
    if (table && candidate.source && candidate.source.table.toLowerCase() === table) return index;
    if (byName === null) byName = index;
  }
  return byName;
}

/** Columns whose name appears as a word in `clause`: the ones a WHERE or HAVING is about. */
export function mentionedColumns(
  result: StatementResult,
  indices: readonly number[],
  clause: string,
): Set<number> {
  const words = new Set(clause.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? []);
  return new Set(indices.filter((index) => words.has(result.columns[index]!.name.toLowerCase())));
}

export function truthy(value: Cell | undefined): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}
