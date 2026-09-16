// The shapes a scene is made of: what one card, one row and one bucket look like once the stage
// has them. Types only, so every other file here can import them without pulling in a builder.

import type { Cell } from "@perch/protocol";
import type { SourceRef } from "../clauses";

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

export const EMPTY: Scene = { kind: "tables", tables: [], tight: true, count: null };
