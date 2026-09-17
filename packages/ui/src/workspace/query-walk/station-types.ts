// What a station IS, and the two shapes every builder fills it in with.

import type { InList, JoinClause, Range, SourceRef } from "./clauses";
import { SAMPLE_ROWS } from "./walk-columns";
import { WALK_PREFIX } from "./clauses";

export type StationId =
  | "from"
  | "join"
  | "where"
  | "group"
  | "having"
  | "window"
  | "select"
  | "distinct"
  | "order"
  | "limit"
  /** The whole of a section that has no clause sequence: see `buildResultStation`. */
  | "result"
  /** One meeting of two results in a set-operator chain: see `buildSetStations`. */
  | "combine";

export type Query = {
  /** `sample`, `count`, `verdict`, `pre`, `pairs`, or `src0.sample` at FROM. */
  readonly id: string;
  readonly label: string;
  readonly sql: string;
};

export type Station = {
  /** Unique across the walk; joins carry their index. */
  readonly key: string;
  readonly id: StationId;
  readonly label: string;
  /** False when the query has no such clause: listed on the rail, skipped by playback. */
  readonly present: boolean;
  /** The clause in the user's text, for the narrator's highlight. */
  readonly clause: Range | null;
  /** Each batch is one probe call, so a failure in one leaves the others untouched. */
  readonly batches: readonly (readonly Query[])[];
  /** Which join this station is, when it is one. */
  readonly join: JoinClause | null;
  readonly joinIndex: number;
  /**
   * A sentence that overrides the narrator's own, for a station the clause vocabulary cannot
   * describe.
   *
   * Null for every station named after a clause: FROM, WHERE and the rest are explained from the
   * parse, which is richer than anything a builder could write down in advance. It is set where
   * there is no clause to explain — a recursive CTE's three stations are about the shape of the
   * whole CTE, and `sentenceFor` has nothing to read that would tell it so.
   */
  readonly sentence: string | null;
  /**
   * A range in the ROOT text this station is about, when `clause` does not index the section's text.
   *
   * The two are alternatives, not a pair. `clause` is an offset into the statement the section runs,
   * which for most sections IS the reader's text shifted by a prefix; for a section whose text the
   * walk invented there is no such offset, and the honest thing to point at is the root range the
   * program mapped when it took the section apart. Null when neither is available.
   */
  readonly root: Range | null;
  /**
   * The `IN (value, …)` lists this station measured, with the index each one's probe columns carry.
   *
   * Carried rather than recomputed: the scene would otherwise have to re-parse the clause to learn
   * which column belongs to which value, and it would need the dialect threaded down to it to do
   * that. Empty for every station but WHERE, and for a WHERE whose lists were all too long.
   */
  readonly inLists: readonly {
    readonly list: InList;
    readonly index: number;
    readonly measured: boolean;
  }[];
};

export const ABSENT: Station["batches"] = [];

/**
 * A station, with the five fields most of them have nothing to say about already filled in.
 *
 * Thirteen station literals spelled those five out by hand, four of them on single lines over two
 * hundred characters wide, and what a reader had to do to tell two stations apart was find the two
 * fields that differed. They are defaults rather than omissions: `joinIndex: -1` means "not a join"
 * and `inLists: []` means "measured nothing", and either is still answerable by a caller that has
 * something else to say — which is what WHERE does, since a WHERE that was not in the query
 * measured no lists whatever it found.
 */
export function station(
  fields: Pick<Station, "key" | "id" | "label" | "present" | "clause" | "batches"> &
    Partial<Station>,
): Station {
  return { join: null, joinIndex: -1, sentence: null, root: null, inLists: [], ...fields };
}

/** A station for a clause the query does not have: on the rail, skipped by playback. */
export function absentStation(key: string, id: StationId, label: string): Station {
  return station({ key, id, label, present: false, clause: null, batches: ABSENT });
}

/**
 * The two wrappers every builder that carries a WITH prefix puts round a body.
 *
 * The prefix is rendered ONCE at the head of the statement and the body goes inside, which is why
 * the count wrapper keeps it OUTSIDE its subquery: a WITH inside a derived table is not legal
 * there. `buildResultStation` writes its own count wrapper and deliberately does not use this —
 * its prefix is already part of the text it is given, so there is nothing left to put in front.
 */
export function wrap(prefix: string): {
  limited: (sql: string) => string;
  counted: (sql: string) => string;
} {
  return {
    limited: (sql) => `${prefix}${sql}\nlimit ${SAMPLE_ROWS}`,
    counted: (sql) => `${prefix}select count(*) from (\n${sql}\n) as ${WALK_PREFIX}count`,
  };
}

/** `orders o`, `customers`, `subquery d`. */
export function sourceTitle(source: SourceRef): string {
  return source.alias && source.alias !== source.name
    ? `${source.name} ${source.alias}`
    : source.name;
}

/* ── Inside one select-list item ───────────────────────────────────────────────────────────────
 *
 * `clauses.ts` already split the list on its depth-zero commas, so every item below is a verbatim
 * slice of the user's text and nothing here ever crosses into the next one. What is left is to
 * find `over` and `case` inside an item, which the pieces below do the same way the parser does
 * one level up: a string literal, a comment and a parenthesised group are each swallowed whole, so
 * a `case` written inside one is never mistaken for the keyword. Everything these return is a
 * slice of the item, never a re-spelling of it — the station queries splice those slices straight
 * back in.
 */

/**
 * The id a station's own rows come back under, and the id of its count.
 *
 * FROM is the exception: it samples one source per pane rather than one result, so its queries are
 * named after the source they came from and the first pane is the one the rest of the walk reads as
 * "the rows so far". These live here, next to the builders that spell those ids in the first place,
 * so a station and the code reading it can never disagree about the name.
 */
export function sampleId(station: Station): string {
  return station.id === "from" ? "src0.sample" : "sample";
}

export function countId(station: Station): string {
  return station.id === "from" ? "src0.count" : "count";
}
