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
  /**
   * The SELECT list does not carry this column into its output, so it is about to go.
   *
   * Only SELECT's first phase sets it, and it is the whole of what that phase has to say: the
   * station is named "dropping unused columns" and a card that has already dropped them is showing
   * the aftermath rather than the act.
   */
  readonly drop?: boolean;
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
   * One line under the card saying what it is NOT showing, and why.
   *
   * For a downgrade the reader would otherwise read as a bug: a cap that took a column away, a
   * measurement the station declined to make. It is not an error and not an emptiness — `error`
   * and `empty` cover those — so it sits quietly under the rows rather than replacing them.
   */
  readonly note?: string;
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

/** One value the subquery of an IN returned: a piece of the hay the needle is looked for in. */
export type ValueChip = {
  readonly key: string;
  readonly text: string;
  /** This is the value the outer row's left expression equals: the needle, found. */
  readonly match: boolean;
  /**
   * A null among the values, which under `NOT IN` is fatal to every row.
   *
   * `x not in (a, null)` compares x against every value with `=`; a comparison to null is unknown,
   * so the predicate can never be proved true and no row passes, however unlike the other values x
   * is. Marking the row is what turns a table that looks fine into the reason the result is empty.
   */
  readonly poison: boolean;
};

/**
 * The right half of a per-row ledger, which is a different picture for each predicate kind.
 *
 * EXISTS is absent from this union on purpose: presence is a question about ROWS, and the rows are
 * an ordinary card. IN is a question about membership, so its card is a value list rather than a
 * table — a table invites the eye to read columns that are not the point. A scalar is a question
 * about one comparison, so its card is that comparison, three cells wide.
 */
export type AnswerView =
  | {
      readonly kind: "values";
      readonly key: string;
      readonly title: string;
      /** How the needle is labelled: the left expression as written, `s.dept_name`. */
      readonly needleLabel: string;
      /** The outer row's value for it, spelled as the SQL spells it. */
      readonly needle: string;
      readonly values: readonly ValueChip[];
      readonly total: number | null;
      readonly truncated: boolean;
      readonly verdict: "pass" | "fail";
      readonly empty: string;
      readonly error: string | null;
    }
  | {
      readonly kind: "equation";
      readonly key: string;
      readonly title: string;
      /** The left expression as written, and the outer row's value for it. */
      readonly leftLabel: string;
      readonly left: string;
      /** The comparison operator, exactly as the user typed it. */
      readonly operator: string;
      /** The one value the subquery returned, or `null` when it returned no row at all. */
      readonly right: string;
      readonly verdict: "pass" | "fail";
      /** The subquery returned no row, so the value is null and the comparison is unknown. */
      readonly missing: boolean;
      /** Rows the subquery returned when that is more than one, which SQL makes an error. */
      readonly many: number | null;
      readonly error: string | null;
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

/** One row of the nearest-miss card: an outer row, and how far it was from passing. */
export type NearRow = {
  readonly key: string;
  readonly cells: Readonly<Record<string, Cell>>;
  /** `short by 1: CS-319`, `closest: 96.0 against 98.7`, `nothing in takes for s.ID = '12345'`. */
  readonly gap: string;
};

/**
 * Why the result is empty, and which rows came closest to not making it so.
 *
 * It is a VIEW choice and never a step the database took: the rows are re-ordered by how close they
 * came, which no ORDER BY asked for, so the card arrives settled and nothing about it animates. See
 * `terminus.ts` for what "close" means per predicate kind and for why some kinds have no such thing.
 */
export type TerminusView = {
  readonly key: string;
  readonly title: string;
  /** The line the empty result card carries: `no row survived not exists (…)`. */
  readonly why: string;
  readonly cols: readonly Col[];
  /** The header over the gap column, which names the measure: `how far`, `what it needed`. */
  readonly gapLabel: string;
  readonly rows: readonly NearRow[];
  /** What the card means, in a sentence, for the narrator beside the stage. */
  readonly sentence: string;
};

export type Scene =
  | {
      readonly kind: "tables";
      readonly tables: readonly TableView[];
      readonly tight: boolean;
      readonly count: number | null;
      /** The per-kind right half of a bound ledger, when the kind is not EXISTS. */
      readonly answer?: AnswerView;
      /** Under an empty result: the rows that came closest, and why none of them made it. */
      readonly terminus?: TerminusView;
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
