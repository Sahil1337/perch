// What the stage shows for a (station, phase), built from the real step results. Pure. Rows keep
// stable keys across phases — the hash of their visible cells — so layout animations can carry a
// row from one arrangement to the next, and a row that is gone from the next sample animates out.

import type { Cell, ResultColumn, StatementResult } from "@perch/protocol";
import { formatCell } from "../results-grid";
import { splitRef, type KeyPair, type SourceRef } from "./clauses";
import { PASS_COLUMN, WALK_PREFIX, sourceTitle, type Station } from "./steps";
import type { StationResult, WalkData } from "./use-walk";

export type Col = {
  readonly id: string;
  readonly label: string;
  /** Pixels. */
  readonly width: number;
  readonly num: boolean;
  readonly hl?: boolean;
  readonly sort?: "asc" | "desc";
};

export type Row = {
  readonly key: string;
  readonly cells: Readonly<Record<string, Cell>>;
  readonly verdict?: "pass" | "fail";
  readonly testIndex?: number;
  readonly hl?: readonly string[];
};

export type TableView = {
  readonly key: string;
  readonly title: string;
  readonly cols: readonly Col[];
  readonly rows: readonly Row[];
  /** A cut line after this many rows, with the label. */
  readonly cut?: { readonly after: number; readonly label: string };
  /** The real row count behind the sample, when the count came back. */
  readonly total?: number | null;
  readonly truncated?: boolean;
  /** Names of the columns the cap dropped, when a card was too wide to show them all. */
  readonly hidden?: readonly string[];
  /** Set on a FROM card, so a CTE or subquery can offer "Walk this". */
  readonly source?: SourceRef;
  readonly error?: string;
};

export type Summary = { readonly label: string; readonly value: Cell; readonly num: boolean };

export type BucketView = {
  readonly key: string;
  readonly title: string;
  readonly members: readonly Row[];
  readonly count: number;
  /** The grouped row for this bucket; null when the grouped sample did not include it. */
  readonly summary: readonly Summary[] | null;
};

export type Scene =
  | {
      readonly kind: "tables";
      readonly tables: readonly TableView[];
      readonly tight: boolean;
      readonly count: number | null;
    }
  | {
      readonly kind: "buckets";
      readonly buckets: readonly BucketView[];
      readonly memberCols: readonly Col[];
      readonly squash: boolean;
      readonly count: number | null;
    };

const EMPTY: Scene = { kind: "tables", tables: [], tight: true, count: null };

/* ---------------------------------------------------------------- results */

function okResult(result: StationResult | undefined, id: string): StatementResult | null {
  const outcome = result?.queries[id];
  return outcome?.ok ? outcome.result : null;
}

export function errorOf(result: StationResult | undefined, id: string): string | null {
  const outcome = result?.queries[id];
  return outcome && !outcome.ok ? outcome.error : null;
}

/** The number a `select count(*)` came back with, or null when it failed or is not there yet. */
export function countValue(result: StationResult | undefined, id: string): number | null {
  const value = okResult(result, id)?.rows[0]?.[0];
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sampleId(station: Station): string {
  return station.id === "from" ? "src0.sample" : "sample";
}
function countId(station: Station): string {
  return station.id === "from" ? "src0.count" : "count";
}

function sampleOf(walk: WalkData, index: number): StatementResult | null {
  const station = walk.stations[index];
  return station ? okResult(walk.results[index], sampleId(station)) : null;
}

/** The nearest earlier station whose sample came back: what the rows looked like before this one. */
export function previousIndex(walk: WalkData, index: number): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (walk.stations[i]!.present && sampleOf(walk, i)) return i;
  }
  return null;
}

/** The row count a station leaves behind. SELECT and ORDER BY inherit; LIMIT computes. */
export function countAt(walk: WalkData, index: number): number | null {
  const station = walk.stations[index];
  if (!station || !station.present) return null;
  switch (station.id) {
    case "select":
    case "order": {
      const previous = previousIndex(walk, index);
      return previous === null ? null : countAt(walk, previous);
    }
    case "limit": {
      const previous = previousIndex(walk, index);
      const input = previous === null ? null : countAt(walk, previous);
      const sample = sampleOf(walk, index);
      if (!sample) return null;
      if (!sample.truncated) return sample.rowCount;
      const { limitValue, offsetValue } = walk.parsed;
      if (input === null) return null;
      const after = Math.max(0, input - (offsetValue ?? 0));
      return limitValue === null ? after : Math.min(limitValue, after);
    }
    default:
      return countValue(walk.results[index], countId(station));
  }
}

/** The row count the station starts from: what the station before it left behind. */
export function inputCount(walk: WalkData, index: number): number | null {
  const previous = previousIndex(walk, index);
  return previous === null ? null : countAt(walk, previous);
}

/* ---------------------------------------------------------------- columns */

const CHAR_PX = 6.8;
const MIN_WIDTH = 48;
const MAX_WIDTH = 220;

function widthFor(label: string, values: readonly Cell[]): number {
  let chars = label.length;
  for (const value of values) chars = Math.max(chars, formatCell(value).length);
  return Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, 16 + chars * CHAR_PX)));
}

/** Indices of the columns worth showing: not the walk's own bookkeeping columns. */
function visibleIndices(result: StatementResult): number[] {
  return result.columns.flatMap((column, index) =>
    column.name.startsWith(WALK_PREFIX) ? [] : [index],
  );
}

function isNumeric(column: ResultColumn): boolean {
  return column.align === "right";
}

function colsOf(
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

const positional = (index: number): string => `c${index}`;

const CELL_SEPARATOR = "";

function hashCells(row: readonly Cell[], indices: readonly number[]): string {
  return indices.map((index) => formatCell(row[index] ?? null)).join(CELL_SEPARATOR);
}

/**
 * Rows keyed by the hash of `keyIndices` (default: the shown columns), with a `#n` suffix on
 * repeats so two identical rows stay two rows.
 */
function rowsOf(
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

const withHl = (cols: readonly Col[], ids: ReadonlySet<string>): Col[] =>
  cols.map((col) => (ids.has(col.id) ? { ...col, hl: true } : col));

/** The column a `o.customer_id` names, preferring one the driver says comes from that table. */
function findColumn(
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
function mentionedColumns(
  result: StatementResult,
  indices: readonly number[],
  clause: string,
): Set<number> {
  const words = new Set(clause.toLowerCase().match(/[a-z_][a-z0-9_$]*/g) ?? []);
  return new Set(indices.filter((index) => words.has(result.columns[index]!.name.toLowerCase())));
}

function truthy(value: Cell | undefined): boolean {
  return value === true || value === 1 || value === "1" || value === "t" || value === "true";
}

/* ------------------------------------------------------------------ scene */

const tables = (list: TableView[], count: number | null, tight = true): Scene => ({
  kind: "tables",
  tables: list,
  tight,
  count,
});

const plain = (
  key: string,
  title: string,
  sample: StatementResult,
  total: number | null,
  keyIndices?: readonly number[],
): TableView => {
  const indices = visibleIndices(sample);
  const cols = colsOf(sample, indices, positional);
  return {
    key,
    title,
    cols,
    rows: rowsOf(sample, cols, indices, "m:", keyIndices),
    total,
    truncated: sample.truncated,
  };
};

/** Columns one card shows before the rest fold into a single `+n` marker. */
const MAX_COLS = 8;

/**
 * A card wider than this is unreadable and shoves the next one off the stage, so it keeps the
 * columns the station is actually about — a join key, a sort key, the ones a WHERE names, all of
 * which arrive already lit — and then the leftmost of the rest, in the query's own order.
 */
function capCols(view: TableView): TableView {
  // One folded column is not worth the marker that replaces it.
  if (view.cols.length <= MAX_COLS + 1) return view;
  const lit = view.cols.flatMap((col, i) => (col.hl || col.sort ? [i] : []));
  const rest = view.cols.flatMap((col, i) => (col.hl || col.sort ? [] : [i]));
  const keep = new Set([...lit, ...rest].slice(0, MAX_COLS));
  return {
    ...view,
    cols: view.cols.filter((_, i) => keep.has(i)),
    hidden: view.cols.flatMap((col, i) => (keep.has(i) ? [] : [col.label])),
  };
}

export function buildScene(index: number, phase: number, walk: WalkData): Scene {
  const scene = sceneAt(index, phase, walk);
  return scene.kind === "tables" ? { ...scene, tables: scene.tables.map(capCols) } : scene;
}

function sceneAt(index: number, phase: number, walk: WalkData): Scene {
  const station = walk.stations[index];
  if (!station) return EMPTY;
  const { parsed } = walk;
  const result = walk.results[index];
  const sources = [parsed.first, ...parsed.joins.map((join) => join.source)];
  const tableOf = (qualifier: string): string | null =>
    sources.find((source) => (source.alias ?? source.name).toLowerCase() === qualifier.toLowerCase())
      ?.name ?? null;
  const chainTitle = (through: number): string =>
    sources
      .slice(0, through + 1)
      .map(sourceTitle)
      .join(" ⋈ ");
  const input = inputCount(walk, index);
  const own = countAt(walk, index);
  const previous = previousIndex(walk, index);
  const prevSample = previous === null ? null : sampleOf(walk, previous);
  const prevStation = previous === null ? null : walk.stations[previous]!;
  const mainTitle =
    prevStation?.id === "group" || prevStation?.id === "having"
      ? "groups"
      : station.id === "from"
        ? sourceTitle(parsed.first)
        : chainTitle(parsed.joins.length);

  switch (station.id) {
    case "from": {
      const list = sources.map((source, s): TableView => {
        const sample = okResult(result, `src${s}.sample`);
        const total = countValue(result, `src${s}.count`);
        const title = sourceTitle(source);
        const key = s === 0 ? "main" : `src${s}`;
        if (!sample) {
          return {
            key,
            title,
            cols: [],
            rows: [],
            source,
            total,
            error: errorOf(result, `src${s}.sample`) ?? undefined,
          };
        }
        const indices = visibleIndices(sample);
        const cols = colsOf(sample, indices, positional);
        return {
          key,
          title,
          cols,
          rows: rowsOf(sample, cols, indices, s === 0 ? "m:" : `r${s}:`),
          total,
          truncated: sample.truncated,
          source,
        };
      });
      return tables(list, own, false);
    }

    case "join": {
      const join = station.join!;
      const j = station.joinIndex;
      const joined = okResult(result, "sample");
      if (!joined) return EMPTY;
      const right = okResult(walk.results[0], `src${j + 1}.sample`);
      const left = prevSample;
      const leftCount = left
        ? left.columns.length
        : right
          ? joined.columns.length - right.columns.length
          : joined.columns.length;
      const all = joined.columns.map((_, i) => i);
      const leftIdx = all.slice(0, leftCount);
      const rightIdx = all.slice(leftCount);
      const keyIds = (
        sample: StatementResult,
        indices: number[],
        refs: (pair: KeyPair) => string,
      ): Set<string> =>
        new Set(
          join.keys.flatMap((pair) => {
            const found = findColumn(sample, indices, refs(pair), tableOf);
            return found === null ? [] : [positional(found)];
          }),
        );
      const title = chainTitle(j + 1);

      if (phase === 0 && left) {
        const leftVisible = visibleIndices(left);
        const leftCols = withHl(
          colsOf(left, leftVisible, positional),
          keyIds(left, leftVisible, (pair) => pair.left),
        );
        const main: TableView = {
          key: "main",
          title: chainTitle(j),
          cols: leftCols,
          rows: rowsOf(left, leftCols, leftVisible, "m:"),
        };
        if (!right) return tables([main], input);
        const rightVisible = visibleIndices(right);
        const rightCols = withHl(
          colsOf(right, rightVisible, positional),
          keyIds(right, rightVisible, (pair) => pair.right),
        );
        const side: TableView = {
          key: `src${j + 1}`,
          title: sourceTitle(join.source),
          cols: rightCols,
          rows: rowsOf(right, rightCols, rightVisible, `r${j + 1}:`),
          total: countValue(walk.results[0], `src${j + 1}.count`),
        };
        return tables([main, side], input);
      }

      const visible = visibleIndices(joined);
      const lit = new Set([
        ...keyIds(joined, leftIdx, (pair) => pair.left),
        ...keyIds(joined, rightIdx, (pair) => pair.right),
      ]);
      if (phase <= 1) {
        const pairs = okResult(result, "pairs");
        const source = pairs ?? joined;
        const cols = withHl(colsOf(source, visible, positional), lit);
        const rows = rowsOf(source, cols, visible, "m:", leftIdx).map((row, i) => {
          const raw = source.rows[i]!;
          const unmatched =
            pairs !== null && rightIdx.length > 0 && rightIdx.every((k) => raw[k] === null);
          return unmatched ? { ...row, verdict: "fail" as const, testIndex: 0 } : row;
        });
        return tables([{ key: "main", title, cols, rows }], input);
      }
      return tables([plain("main", title, joined, own, leftIdx)], own);
    }

    case "where":
    case "having": {
      const sample = okResult(result, "sample");
      if (!sample) return EMPTY;
      const clause = station.id === "where" ? parsed.where : parsed.having;
      const body = clause ? parsed.text.slice(clause.body.from, clause.body.to) : "";
      const title = station.id === "having" ? "groups" : mainTitle;
      if (phase === 0) {
        const verdict = okResult(result, "verdict");
        const source = verdict ?? prevSample;
        if (!source) return EMPTY;
        const passAt = source.columns.findIndex((column) => column.name === PASS_COLUMN);
        const indices = visibleIndices(source);
        const cols = withHl(
          colsOf(source, indices, positional),
          new Set([...mentionedColumns(source, indices, body)].map(positional)),
        );
        const kept = new Set(sample.rows.map((row) => hashCells(row, visibleIndices(sample))));
        const rows = rowsOf(source, cols, indices, "m:").map((row, i): Row => {
          const raw = source.rows[i]!;
          const pass = passAt >= 0 ? truthy(raw[passAt]) : kept.has(hashCells(raw, indices));
          return { ...row, verdict: pass ? "pass" : "fail", testIndex: i };
        });
        return tables([{ key: "main", title, cols, rows }], input);
      }
      return tables([plain("main", title, sample, own)], own);
    }

    case "group": {
      const grouped = okResult(result, "sample");
      if (!grouped) return EMPTY;
      const pre = okResult(result, "pre");
      const keyIndicesOf = (sample: StatementResult): number[] =>
        sample.columns.flatMap((column, i) => (column.name.startsWith(`${WALK_PREFIX}k`) ? [i] : []));
      const groupedVisible = visibleIndices(grouped);
      const groupedTable = (): Scene => tables([plain("main", "groups", grouped, own)], own);
      if (!pre) {
        if (phase === 0 && prevSample) return tables([plain("main", mainTitle, prevSample, input)], input);
        return groupedTable();
      }

      const preVisible = visibleIndices(pre);
      const preKeys = keyIndicesOf(pre);
      // Plain-column keys light their column; an expression key has no column to light.
      const litKeys = new Set(
        parsed.groupKeys.flatMap((key) => {
          const found = findColumn(pre, preVisible, key, tableOf);
          return found === null ? [] : [positional(found)];
        }),
      );
      const preCols = withHl(colsOf(pre, preVisible, positional), litKeys);
      const preRows = rowsOf(pre, preCols, preVisible, "m:").map((row) => ({ ...row, hl: [...litKeys] }));
      if (phase === 0) {
        return tables([{ key: "main", title: mainTitle, cols: preCols, rows: preRows }], input);
      }

      const groupedKeys = keyIndicesOf(grouped);
      const summaries = new Map<string, Summary[]>();
      for (const row of grouped.rows) {
        summaries.set(
          hashCells(row, groupedKeys),
          groupedVisible.map((i) => ({
            label: grouped.columns[i]!.name,
            value: row[i] ?? null,
            num: isNumeric(grouped.columns[i]!),
          })),
        );
      }
      const buckets: BucketView[] = [];
      const byKey = new Map<string, { members: Row[]; count: number }>();
      pre.rows.forEach((raw, i) => {
        const hash = hashCells(raw, preKeys);
        let bucket = byKey.get(hash);
        if (!bucket) {
          bucket = { members: [], count: 0 };
          byKey.set(hash, bucket);
          buckets.push({
            key: `g:${hash}`,
            title: preKeys.map((k) => formatCell(raw[k] ?? null)).join(" · "),
            members: bucket.members,
            count: 0,
            summary: summaries.get(hash) ?? null,
          });
        }
        bucket.members.push(preRows[i]!);
        bucket.count += 1;
      });
      const counted = buckets.map((bucket) => ({ ...bucket, count: bucket.members.length }));
      const memberCols = [
        ...preCols.filter((col) => !litKeys.has(col.id)),
        ...preCols.filter((col) => litKeys.has(col.id)),
      ].slice(0, 3);
      const squash = phase >= 2;
      return { kind: "buckets", buckets: counted, memberCols, squash, count: squash ? own : input };
    }

    case "select": {
      const output = okResult(result, "sample");
      if (!output) return EMPTY;
      const outVisible = visibleIndices(output);
      if (!prevSample) return tables([plain("main", "result", output, own)], own);
      const prevVisible = visibleIndices(prevSample);
      // Which earlier column each output column comes from: by driver-reported source, else by name.
      const taken = new Set<number>();
      const origin = new Map<number, number>();
      for (const j of outVisible) {
        const column = output.columns[j]!;
        const match = prevVisible.find((i) => {
          if (taken.has(i)) return false;
          const candidate = prevSample.columns[i]!;
          if (column.source && candidate.source) {
            return (
              column.source.table === candidate.source.table &&
              column.source.column === candidate.source.column
            );
          }
          return candidate.name.toLowerCase() === column.name.toLowerCase();
        });
        if (match !== undefined) {
          taken.add(match);
          origin.set(j, match);
        }
      }
      if (phase === 0) {
        const kept = prevVisible.filter((i) => taken.has(i));
        const cols = colsOf(prevSample, kept, positional);
        return tables(
          [{ key: "main", title: mainTitle, cols, rows: rowsOf(prevSample, cols, kept, "m:", prevVisible) }],
          own,
        );
      }
      const prevRows = rowsOf(prevSample, colsOf(prevSample, prevVisible, positional), prevVisible, "m:");
      const cols = colsOf(output, outVisible, (j) => {
        const from = origin.get(j);
        return from === undefined ? `n${j}` : positional(from);
      });
      const rows = rowsOf(output, cols, outVisible, "m:").map((row, i) =>
        prevRows[i] ? { ...row, key: prevRows[i]!.key } : row,
      );
      return tables([{ key: "main", title: "result", cols, rows, total: own, truncated: output.truncated }], own);
    }

    case "distinct": {
      const distinct = okResult(result, "sample");
      if (!distinct) return EMPTY;
      if (phase === 0 && prevSample) {
        const indices = visibleIndices(prevSample);
        const cols = colsOf(prevSample, indices, positional);
        const seen = new Set<string>();
        const rows = rowsOf(prevSample, cols, indices, "m:").map((row, i): Row => {
          const hash = hashCells(prevSample.rows[i]!, indices);
          const first = !seen.has(hash);
          seen.add(hash);
          return { ...row, verdict: first ? "pass" : "fail", testIndex: i };
        });
        return tables([{ key: "main", title: "result", cols, rows }], input);
      }
      return tables([plain("main", "result", distinct, own)], own);
    }

    case "order": {
      const ordered = okResult(result, "sample");
      if (!ordered) return EMPTY;
      const sortCols = (sample: StatementResult, indices: number[]): Col[] =>
        colsOf(sample, indices, positional).map((col, at) => {
          const index = indices[at]!;
          const item = parsed.orderItems.find((entry) => {
            const expr = entry.expr.trim();
            if (/^\d+$/.test(expr)) return Number(expr) - 1 === index;
            const found = findColumn(sample, indices, expr, tableOf);
            // An expression names no column: light the output column in the same position.
            return found !== null ? found === index : parsed.selectItems[index] === expr;
          });
          // `+14`: the sort arrow shares the header cell, and without the room it eats the name.
          return item
            ? { ...col, width: col.width + 14, hl: true, sort: item.desc ? "desc" : "asc" }
            : col;
        });
      const source = phase === 0 ? (prevSample ?? ordered) : ordered;
      const indices = visibleIndices(source);
      const cols = sortCols(source, indices);
      return tables(
        [
          {
            key: "main",
            title: "result",
            cols,
            rows: rowsOf(source, cols, indices, "m:"),
            total: own,
            truncated: source.truncated,
          },
        ],
        own,
      );
    }

    case "limit": {
      const final = okResult(result, "sample");
      if (!final) return EMPTY;
      const { limitValue, offsetValue } = parsed;
      const offset = offsetValue ?? 0;
      const label = [
        limitValue !== null ? `LIMIT ${limitValue}` : null,
        offsetValue !== null ? `OFFSET ${offsetValue}` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      if (phase === 0 && prevSample) {
        const indices = visibleIndices(prevSample);
        const cols = colsOf(prevSample, indices, positional);
        const rows = rowsOf(prevSample, cols, indices, "m:").map(
          (row, i): Row => (i < offset ? { ...row, verdict: "fail", testIndex: 0 } : row),
        );
        const cutAt = limitValue === null ? null : offset + limitValue;
        const cut =
          cutAt !== null && cutAt < rows.length ? { after: cutAt, label: `${label} · cut here` } : undefined;
        return tables([{ key: "main", title: "result", cols, rows, cut }], input);
      }
      return tables([plain("main", "result", final, own)], own);
    }
  }
}
