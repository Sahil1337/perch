// Why the result is empty, from what the walk already measured.
//
// The relational-division query returns nothing, and until this existed the walk ended on a blank
// card: correct, and the least useful thing it could have said. The reason it is empty is not that
// the query is wrong — it is that NOBODY has taken all five required courses, and one student is
// short of exactly one course. That fact is the whole lesson, it is already on screen one chapter
// earlier as a column of counts, and it was being thrown away at the last station.
//
// TWO RULES HOLD THIS HONEST.
//
// It never probes. Every number here comes from a statement the walk had already sent: the bound
// chapter's outer probe, which brings back one count per outer row; the grid's one probe, whose
// cells name the values that were missing; and the per-row probes the ledger sends as playback
// walks the rows. If a chapter has not run, there is no card — "already known" is the condition,
// not an invitation to go and find out.
//
// It never claims a gradient it does not have. "Nearest" means something different under each
// predicate kind and under one of them it means nothing at all: every row that fails an `exists`
// fails it with a count of zero, so there is no closest row, and ranking them would be a ranking of
// nothing dressed as a finding. That case shows what the subquery would have needed instead.

import type { Cell, Dialect, StatementResult } from "@perch/protocol";
import { formatCell } from "../results-grid";
import { sqlLiteral, type BoundPlan, type BoundRow } from "./bound";
import { conjuncts, spliceRanges, type Range, type SubqueryPredicateKind } from "./clauses";
import type { GridBuild } from "./grid";
import {
  bindingText,
  closestSentence,
  genericTerminusSentence,
  nearMissSentence,
  NEAREST_TITLE,
  noGradientSentence,
} from "./narration";
import type { SectionId } from "./program";
import { colsOf, positional, truthy, visibleIndices, widthFor } from "./scenes/columns";
import type { Col, NearRow, TerminusView } from "./scenes/types";
import { conjunctColumn, PASS_COLUMN, sourceTitle } from "./steps";
import type { GridColumn } from "./use-grid";
import type { StationResult, WalkData } from "./use-walk";

/**
 * Everything a bound chapter's probes learned, kept so a later chapter can read it.
 *
 * The ledger's own view owns these numbers and would otherwise take them off screen with it when
 * the reader moves on. Nothing here is fetched for this purpose: it is the same state the bound
 * section is already holding, reported upward as it lands.
 */
export type BoundEvidence = {
  readonly plan: BoundPlan;
  readonly rows: readonly BoundRow[];
  readonly outer: StatementResult;
  /** The grid and its cells, when one was built and its probe came back. */
  readonly grid: GridBuild | null;
  readonly columns: readonly GridColumn[];
  readonly cells: ReadonlyMap<string, ReadonlyMap<string, boolean>>;
  /**
   * The subquery's own rows, per outer row index, for the rows whose probe has landed.
   *
   * Sparse on purpose. The ledger probes a row when it binds one, so a reader who left the chapter
   * early leaves gaps here — and a gap is a row with no measure rather than a reason to send a
   * statement for it.
   */
  readonly answers: ReadonlyMap<number, StatementResult>;
};

/** Rows the card shows. Three is a shortlist; a fourth is a table, and a table of losers is a
 *  different and much less interesting card. */
const MAX_NEAR = 3;

/** Missing values named in full before the card gives up and quotes only the number. `short by 5:
 *  CS-101, CS-190, CS-315, CS-319, CS-347` is a sentence nobody reads to the end. */
const MAX_NAMED = 3;

export function buildTerminus(args: {
  readonly walk: WalkData;
  /** The station playback has reached: the card only appears at the walk's last one. */
  readonly index: number;
  readonly dialect: Dialect;
  readonly evidence: ReadonlyMap<SectionId, BoundEvidence>;
}): TerminusView | null {
  const { walk, index, dialect, evidence } = args;
  const parsed = walk.parsed;
  if (parsed === null || parsed.where === null) return null;
  if (!isLastStation(walk, index)) return null;
  // Zero rows, measured rather than assumed: a sample that is merely empty could be a station still
  // loading, and a card explaining an emptiness that is about to fill would be worse than none.
  const sample = okOf(walk.results[index], "sample");
  if (sample === null || sample.rows.length > 0 || sample.rowCount !== 0) return null;

  const body = parsed.text.slice(parsed.where.body.from, parsed.where.body.to);
  const parts = conjuncts(parsed.text, parsed.where.body, dialect);
  const bound = boundConjunct(parts, evidence);
  return bound === null ? generic(walk, parsed.text, parts, body) : nearest(bound, parsed.text, body);
}

/** The last station of the walk that actually runs: where an empty result is the query's answer
 *  rather than one step's. */
function isLastStation(walk: WalkData, index: number): boolean {
  for (let i = index + 1; i < walk.stations.length; i++) {
    if (walk.stations[i]!.present) return false;
  }
  return walk.stations[index]?.present === true;
}

function okOf(result: StationResult | undefined, id: string): StatementResult | null {
  const outcome = result?.queries[id];
  return outcome?.ok ? outcome.result : null;
}

/**
 * The conjunct of the WHERE that is a bound chapter whose counts are in, or null.
 *
 * Matched by RANGE: a predicate's ranges index the outer section's own text, which is this walk's
 * text, so a conjunct and the predicate that fills it are the same two offsets. Matching on the
 * text instead would pair a conjunct with an identical predicate somewhere else in the query.
 */
function boundConjunct(
  parts: readonly Range[],
  evidence: ReadonlyMap<SectionId, BoundEvidence>,
): BoundEvidence | null {
  for (const part of parts) {
    for (const found of evidence.values()) {
      const { range } = found.plan.predicate;
      if (range.from >= part.from && range.to <= part.to && found.rows.length > 0) return found;
    }
  }
  return null;
}

/* ── The bound card ────────────────────────────────────────────────────────────────────────── */

function nearest(found: BoundEvidence, text: string, body: string): TerminusView | null {
  const { plan, rows, outer } = found;
  const kind = plan.predicate.kind;
  const predicate = oneLine(text.slice(plan.predicate.range.from, plan.predicate.range.to));
  const why = `no row survived ${clip(predicate)}`;
  const failing = rows.flatMap((row, index) => (row.pass ? [] : [{ row, index }]));
  if (failing.length === 0) return null;

  const outerParsed = plan.outer.parsed;
  const outerSource =
    outerParsed !== null && outerParsed.kind === "select" ? sourceTitle(outerParsed.first) : body;
  const indices = visibleIndices(outer);
  const cols = colsOf(outer, indices, positional);
  const cells = (index: number): Record<string, Cell> => {
    const out: Record<string, Cell> = {};
    indices.forEach((column, at) => {
      out[cols[at]!.id] = outer.rows[index]?.[column] ?? null;
    });
    return out;
  };
  /** A row named by its own output columns, which is the only name the query gives it. */
  const nameOf = (index: number): string =>
    indices.map((column) => formatCell(outer.rows[index]?.[column] ?? null)).join(" ");

  const scored = score(found, failing, kind);
  if (scored === null) {
    // No gradient: every failing row failed the same way and by the same amount. What it WOULD have
    // taken is the only thing left that is true, so that is what the column says.
    const shown = failing.slice(0, MAX_NEAR);
    const first = shown[0]!;
    const innerParsed = plan.section.parsed;
    const innerSource =
      innerParsed !== null && innerParsed.kind === "select" ? innerParsed.first.name : "the subquery";
    const gaps = shown.map(({ row }) => needed(found, row));
    return {
      key: "terminus",
      title: "what it needed",
      why,
      cols: [...cols, gapCol("what it needed", gaps)],
      gapLabel: "what it needed",
      rows: shown.map(({ row, index }, at) => ({ key: row.key, cells: cells(index), gap: gaps[at]! })),
      sentence: noGradientSentence({
        outerSource,
        kind,
        predicate,
        innerSource,
        binding: sought(found, first.row) ?? bindingText(plan, first.row),
      }),
    };
  }

  // Ordered by closeness, which is a VIEW choice: no ORDER BY produced it, and `TerminusCard`
  // renders it settled for exactly that reason.
  const shown = [...scored].sort((a, b) => a.distance - b.distance).slice(0, MAX_NEAR);
  const best = shown[0]!;
  const label = measureOf(kind);
  const grid = found.grid;
  return {
    key: "terminus",
    title: NEAREST_TITLE,
    why,
    cols: [...cols, gapCol(label, shown.map((entry) => entry.gap))],
    gapLabel: label,
    rows: shown.map((entry): NearRow => ({
      key: entry.row.key,
      cells: cells(entry.index),
      gap: entry.gap,
    })),
    sentence:
      kind === "not exists"
        ? nearMissSentence({
            outerSource,
            rowNoun: grid?.rowNoun ?? outerSource,
            kind,
            driveTitle: grid?.driveTitle ?? null,
            driveNoun: grid?.driveNoun ?? "row",
            innerSource: grid?.innerSource ?? null,
            name: nameOf(best.index),
            count: best.distance,
            missing: missingValues(found, best.row) ?? [],
          })
        : closestSentence({
            outerSource,
            predicate,
            name: nameOf(best.index),
            gap: best.gap,
          }),
  };
}

type Scored = { readonly row: BoundRow; readonly index: number; readonly distance: number; readonly gap: string };

/** What "near" is measured in, per kind. It is a column header, so it names the measure and not the
 *  verdict: a reader who disagrees with the ranking should be able to see what it ranked by. */
function measureOf(kind: SubqueryPredicateKind): string {
  switch (kind) {
    case "not exists":
      return "how far";
    case "in":
    case "scalar":
      return "how close";
    default:
      return "what it needed";
  }
}

/**
 * How far each failing row was from passing, or null when the kind has no such thing.
 *
 * `not exists` has the clearest one there is: the count is the number of rows that must not have
 * been there, so the smallest non-zero count is the row that came closest. A count of zero under
 * `not exists` is a row that PASSED, so it cannot be here at all; the filter is a guard against a
 * count arriving for a row the verdict disagreed with.
 *
 * `in` and a scalar comparison are distances between numbers, and only between numbers: `'Physics'`
 * is not nearer to `'Comp. Sci.'` than `'Biology'` is, and inventing an order over strings would be
 * inventing the finding this card exists to report. Null when no row could be measured.
 */
function score(
  found: BoundEvidence,
  failing: readonly { readonly row: BoundRow; readonly index: number }[],
  kind: SubqueryPredicateKind,
): Scored[] | null {
  if (kind === "not exists") {
    const out = failing.flatMap(({ row, index }) =>
      row.matches === null || row.matches === 0
        ? []
        : [{ row, index, distance: row.matches, gap: shortBy(found, row, row.matches) }],
    );
    return out.length === 0 ? null : out;
  }
  if (kind !== "in" && kind !== "scalar") return null;

  const out: Scored[] = [];
  for (const { row, index } of failing) {
    const left = numberOf(row.left);
    if (left === null) continue;
    const answer = found.answers.get(index);
    if (!answer) continue;
    let best: { value: Cell; distance: number } | null = null;
    for (const inner of answer.rows) {
      const value = inner[0] ?? null;
      const n = numberOf(value);
      if (n === null) continue;
      const distance = Math.abs(left - n);
      if (best === null || distance < best.distance) best = { value, distance };
    }
    if (best === null) continue;
    const literal = sqlLiteral(best.value, found.plan.dialect, answer.columns[0]);
    out.push({
      row,
      index,
      distance: best.distance,
      gap: `${row.leftLiteral ?? String(left)} against ${literal} — off by ${trim(best.distance)}`,
    });
  }
  return out.length === 0 ? null : out;
}

/**
 * `short by 1: CS-319`, or `short by 5` when naming them all would be a paragraph.
 *
 * The names are free when a grid was built: a cell that came back true is a driving row the
 * subquery returned, which under `not exists` is exactly a value the outer row was missing. Without
 * a grid the count is all there is, and the count is what the ledger already showed.
 */
function shortBy(found: BoundEvidence, row: BoundRow, count: number): string {
  const missing = missingValues(found, row);
  if (missing === null || missing.length === 0 || missing.length > MAX_NAMED) return `short by ${count}`;
  return `short by ${count}: ${missing.join(", ")}`;
}

/** The driving rows this outer row's subquery returned, by the grid's own cells. Null when there is
 *  no grid, when its probe did not reach this row, or when it reached only part of it — a row with
 *  four of its five cells would name four of five missing courses and look like a fifth was found. */
function missingValues(found: BoundEvidence, row: BoundRow): string[] | null {
  const { grid, columns, cells } = found;
  if (grid === null || columns.length === 0) return null;
  const answers = cells.get(bindKeyOf(row));
  if (!answers || answers.size < columns.length) return null;
  return columns.filter((column) => answers.get(column.key) === true).map((column) => column.label);
}

/** The same key `useGridRun` files its cells under: the outer row's bound values, spelled as SQL. */
function bindKeyOf(row: BoundRow): string {
  return JSON.stringify([...row.literals.values()]);
}

/**
 * What the subquery would have had to find for THIS row, for a kind with no gradient at all.
 *
 * The row's own values are spliced into the subquery's WHERE, which is the same substitution the
 * per-row card already shows and the same one the database made — so the column says `no takes with
 * t.ID = '00128' and t.grade = 'Z'` rather than a generic "it found nothing". That is the value
 * sought, named, and it costs no probe: the literals came back on the outer probe.
 *
 * It is NOT the subquery's FROM rows. Showing those would mean running the subquery without its
 * WHERE, which is a statement the walk never sent, and this card does not send statements.
 */
function needed(found: BoundEvidence, row: BoundRow): string {
  const { plan } = found;
  const parsed = plan.section.parsed;
  const source = parsed !== null && parsed.kind === "select" ? parsed.first.name : "the subquery";
  if (plan.predicate.kind === "not in") {
    return `${row.leftLiteral ?? "its value"} is among the ones ${source} returned`;
  }
  const wanted = sought(found, row);
  return wanted === null ? `no row of ${source} matched` : `no ${source} with ${wanted}`;
}

/** The subquery's WHERE with this row's values written over its correlated references. */
function sought(found: BoundEvidence, row: BoundRow): string | null {
  const parsed = found.plan.section.parsed;
  if (parsed === null || parsed.kind !== "select" || parsed.where === null) return null;
  const body = parsed.where.body;
  const edits = found.plan.refs
    .filter((ref) => ref.range.from >= body.from && ref.range.to <= body.to)
    .map((ref) => ({ range: ref.range, with: row.literals.get(ref.ref) ?? "null" }));
  return clip(oneLine(spliceRanges(parsed.text, body, edits)));
}

/* ── The generic card ──────────────────────────────────────────────────────────────────────── */

/**
 * The fallback, for a WHERE with no bound chapter behind it.
 *
 * The measure is the number of the WHERE's own depth-zero conjuncts a row failed, which the row
 * test already brings back — `a and b and c` is three tests, and a row that failed one got further
 * than a row that failed all three. A WHERE with a single conjunct has no such measure, and rather
 * than order the rows by nothing the card says only what emptied them.
 */
function generic(
  walk: WalkData,
  text: string,
  parts: readonly Range[],
  body: string,
): TerminusView | null {
  const at = walk.stations.findIndex((station) => station.id === "where" && station.present);
  if (at < 0) return null;
  const verdict = okOf(walk.results[at], "verdict");
  if (verdict === null || verdict.rows.length === 0) return null;
  const why = `no row survived ${clip(oneLine(body))}`;

  const indices = visibleIndices(verdict);
  const cols = colsOf(verdict, indices, positional);
  const passAt = verdict.columns.findIndex((column) => column.name === PASS_COLUMN);
  const testAt = parts.map((_, index) =>
    verdict.columns.findIndex((column) => column.name === conjunctColumn(index)),
  );
  const measured = parts.length > 1 && testAt.every((index) => index >= 0);

  const rows = verdict.rows.flatMap((raw, index) => {
    if (passAt >= 0 && truthy(raw[passAt])) return [];
    const failed = measured ? testAt.filter((column) => !truthy(raw[column])) : [];
    const cells: Record<string, Cell> = {};
    indices.forEach((column, at2) => {
      cells[cols[at2]!.id] = raw[column] ?? null;
    });
    const which = failed.map((column) => {
      const part = parts[testAt.indexOf(column)]!;
      return oneLine(text.slice(part.from, part.to));
    });
    return [
      {
        entry: {
          key: `near:${index}`,
          cells,
          gap: measured
            ? `failed ${failed.length} of ${parts.length}: ${which.join(", ")}`
            : "failed the test",
        },
        distance: measured ? failed.length : 0,
      },
    ];
  });
  if (rows.length === 0) return null;

  const shown = measured ? [...rows].sort((a, b) => a.distance - b.distance) : rows;
  const label = measured ? "how far" : "verdict";
  const near = shown.slice(0, MAX_NEAR).map((entry) => entry.entry);
  return {
    key: "terminus",
    title: measured ? "nearest to passing" : "the rows it threw away",
    why,
    cols: [...cols, gapCol(label, near.map((entry) => entry.gap))],
    gapLabel: label,
    rows: near,
    sentence: genericTerminusSentence(oneLine(body), measured),
  };
}

/* ── Shared ───────────────────────────────────────────────────────────────────────────────── */

const GAP = "gap";

function gapCol(label: string, values: readonly string[]): Col {
  return { id: GAP, label, width: widthFor(label, values), num: false, hl: true };
}

/** A number the distance can be taken between, or null. A BIGINT or NUMERIC arrives as a string and
 *  is still a number; a string of letters is not, and must not become `NaN` further down. */
function numberOf(value: Cell): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const n = Number(value);
  return value.trim() !== "" && Number.isFinite(n) ? n : null;
}

/** A distance shown to a reader rather than to a machine: `3`, `2.7`, and never `2.7000000000000002`. */
function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** The predicate quoted on the empty card, cut where it stops being readable. The card is one line
 *  tall and a fifty-character WHERE would push the row count off the end of it. */
function clip(text: string): string {
  return text.length <= 54 ? text : `${text.slice(0, 53)}…`;
}
