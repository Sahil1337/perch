// The shapes a scene is made of: what one card, one row and one bucket look like once the stage
// has them. Types only, so every other file here can import them without pulling in a builder.

import type { Cell } from "@perch/protocol";
import type { SourceRef } from "../clauses";
import type { CellTone } from "../grid";

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
  /** The row playback is standing on, in a card the reader scrubs through rather than watches once. */
  readonly current?: boolean;
};

/** One cell of a grid: what the absorbed inner predicate answered for this pair of rows. */
export type GridCellView = {
  readonly key: string;
  /** The inner predicate's answer, or null when the probe's cap did not reach this pair. */
  readonly returned: boolean | null;
  /** What it does to the OUTER row's verdict — never the raw boolean. See `cellTone`. */
  readonly tone: CellTone;
  /** The inner subquery found rows, which is what the filled dot means. */
  readonly found: boolean;
  /** The cell the SQL panel and the cell card are bound to. */
  readonly picked: boolean;
  /** The whole cell in words, for the button's accessible name: a dot that means two things at
   *  once has to say which one it is claiming to anyone who cannot see it. */
  readonly label: string;
};

export type GridRowView = {
  readonly key: string;
  /** The ordinary columns: the outer row as the ledger shows it. */
  readonly cells: Readonly<Record<string, Cell>>;
  readonly grid: readonly GridCellView[];
  /** Rows this subquery returned for the outer row: the row-sum of the cells, from the count probe. */
  readonly returned: number | null;
  readonly verdict: "pass" | "fail";
  readonly current: boolean;
  /**
   * How much of this row has run.
   *
   * `done` is a settled row; `filling` is the one playback is testing right now, whose cells arrive
   * left to right before its count ticks and its verdict lands; `pending` has not been tested yet in
   * this pass, and shows nothing, because nothing has happened to it.
   */
  readonly state: "done" | "filling" | "pending";
};

/** The column axis of a grid: one column per driving row, folded to a `+n` when there are too many. */
export type GridGroup = {
  /** The middle query's FROM as written: `RequiredCourses rc`. */
  readonly title: string;
  readonly columns: readonly { readonly id: string; readonly label: string }[];
  /** Columns the fold dropped. Non-zero with no columns left is the degraded ledger. */
  readonly hidden: number;
};

export type GridView = {
  readonly key: string;
  readonly title: string;
  /** What this card IS, on one line: what it runs per, how many rows, how many passed. */
  readonly note: string;
  readonly cols: readonly Col[];
  readonly group: GridGroup;
  readonly rows: readonly GridRowView[];
  /** The header over the row-sum column. */
  readonly countLabel: string;
  /** What a glyph means, and what a tint means. Backticks are set as code. */
  readonly legend: readonly string[];
  /** Nothing here is arriving: no stagger, no flash, marks already present. */
  readonly settled: boolean;
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
  /**
   * The card arrived settled: its rows were already tested when it came on screen.
   *
   * Entering a chapter is not a test. The outer probe ran once, before the reader got here, so
   * staggering the verdict marks in would animate something that did not just happen — which is the
   * definition of a lie in this walk. Stagger belongs to playback's first pass through the rows.
   */
  readonly settled?: boolean;
  /**
   * What to say when the card has no rows. An empty card is the honest answer to plenty of
   * queries, but headers over blank space reads as something failing to load rather than as a
   * result, so the station that emptied it says so in its own words.
   */
  readonly empty?: string;
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
    }
  | {
      readonly kind: "grid";
      readonly grid: GridView;
      /** Cards beside the grid: the subquery's rows for the bound row, or one picked cell's. */
      readonly tables: readonly TableView[];
      readonly count: number | null;
    };

export const EMPTY: Scene = { kind: "tables", tables: [], tight: true, count: null };
