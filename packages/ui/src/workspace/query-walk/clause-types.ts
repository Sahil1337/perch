// What a sliced statement IS: character ranges into the text the user wrote, and nothing else.
//
// No function in this file touches a parser. It is the vocabulary the rest of the family speaks,
// kept on its own so `clause-tokens.ts` can name a `Range` without reaching for the slicer, and so
// the documentation of what each field MEANS sits in one place rather than beside whichever
// function happened to build it.

export type Range = { readonly from: number; readonly to: number };

export type Cte = {
  readonly name: string;
  /** `name AS (…)`, for prepending earlier CTEs when a later one is walked on its own. */
  readonly range: Range;
  /** The text inside the parentheses. */
  readonly body: Range;
};

export type SourceRef = {
  readonly kind: "table" | "cte" | "derived";
  /** The source as written, alias included: `orders o`, `(select …) d`. */
  readonly range: Range;
  /** Bare name: no schema, no quotes. "subquery" for a derived table without an alias. */
  readonly name: string;
  readonly alias: string | null;
  /** Inside the parentheses of a derived table; the CTE's body for a CTE reference. */
  readonly body: Range | null;
};

export type KeyPair = {
  /** A column reference on the side that already existed before this join. */
  readonly left: string;
  /** A column reference on the table this join brings in. */
  readonly right: string;
};

export type JoinKind = "inner" | "left" | "right" | "full" | "cross";

export type JoinClause = {
  readonly kind: JoinKind;
  /** The join words as written and upper-cased: `LEFT OUTER JOIN`, or `,` for a comma join. */
  readonly label: string;
  /** From the first join word through the end of its ON/USING condition. */
  readonly range: Range;
  /** Just the join words, so an inner join can be re-spelled as a left join. */
  readonly keyword: Range;
  readonly source: SourceRef;
  /** Equality pairs found in the ON clause, or the USING columns. Empty when not extractable. */
  readonly keys: readonly KeyPair[];
  readonly using: boolean;
  /**
   * Written `NATURAL`, so the columns it joins on are not in the query at all.
   *
   * They are every column name the two sides have in common, which cannot be read off the text: it
   * depends on what the left side is carrying by the time the join happens. `keys` is empty for one
   * of these, and `joinKeys` derives the real ones from the samples once they land.
   */
  readonly natural: boolean;
};

export type Clause = {
  /** Keyword through end of body. */
  readonly range: Range;
  /** The clause without its keyword. */
  readonly body: Range;
};

export type OrderItem = { readonly expr: string; readonly desc: boolean };

export type ParsedSelect = {
  readonly kind: "select";
  readonly text: string;
  /** The statement without a trailing semicolon. */
  readonly statement: Range;
  readonly ctes: readonly Cte[];
  /** The whole `WITH …` prefix, up to the outer SELECT. */
  readonly with: Range | null;
  /** `DISTINCT`, or `DISTINCT ON (…)`, as written. */
  readonly distinct: Range | null;
  readonly selectList: Range;
  /** `SELECT … list`. */
  readonly selectClause: Range;
  /** Each select-list item's expression, aliases stripped, for positional GROUP BY / ORDER BY. */
  readonly selectItems: readonly string[];
  /**
   * The names this SELECT's output columns have, when the text settles all of them.
   *
   * Null the moment a `*` appears anywhere in the list: what a star expands to is a fact about the
   * catalogue and not about the query, so a partial list would be worse than none — a caller
   * asking "is this one of the output columns" would get a confident no for a column the star
   * really does produce. An item that is neither an alias nor a plain column reference contributes
   * nothing: `count(*)` is named by the database, not by the text, and guessing `count` would be
   * the same mistake one item smaller.
   */
  readonly selectNames: readonly string[] | null;
  readonly fromKeyword: Range;
  /** `FROM` through the last join's condition. */
  readonly from: Range;
  readonly first: SourceRef;
  readonly joins: readonly JoinClause[];
  readonly where: Clause | null;
  readonly groupBy: Clause | null;
  /** The GROUP BY expressions, positional references resolved to the select item they name. */
  readonly groupKeys: readonly string[];
  readonly having: Clause | null;
  readonly window: Clause | null;
  readonly orderBy: Clause | null;
  readonly orderItems: readonly OrderItem[];
  readonly limit: Clause | null;
  readonly limitValue: number | null;
  readonly offset: Clause | null;
  readonly offsetValue: number | null;
};

export type Unsupported = { readonly kind: "unsupported"; readonly reason: string };

/** `UNION DISTINCT` is spelled `union` here: it means the same thing as a bare UNION, and the
 *  operator's `range` still covers the word the user wrote, which is what gets highlighted. */
export type SetOperator =
  "union" | "union all" | "intersect" | "intersect all" | "except" | "except all";

export type SetBranch = {
  /** The branch's own text range in the statement. */
  readonly range: Range;
  /** The branch parsed on its own, or why it could not be. A parenthesised branch is unwrapped. */
  readonly parsed: ParsedSelect | Unsupported;
};

/**
 * How the branches actually combine, once precedence is applied.
 *
 * SQL binds INTERSECT tighter than UNION and EXCEPT, and UNION and EXCEPT bind equally and to the
 * left — so `a union b intersect c` is `a union (b intersect c)` and `a union b except c` is
 * `(a union b) except c`. A consumer that draws the chain left to right off `branches` alone gets
 * the first of those wrong, and gets it wrong in the direction a reader believes.
 *
 * `index` indexes `ParsedSetOp.branches`; `opIndex` indexes `ParsedSetOp.operators`, so the word the
 * user wrote is still the thing that gets highlighted.
 */
export type SetTree =
  | { readonly kind: "branch"; readonly index: number }
  | {
      readonly kind: "combine";
      readonly op: SetOperator;
      readonly opIndex: number;
      readonly left: SetTree;
      readonly right: SetTree;
    };

/**
 * A statement whose top level is a chain of set operators.
 *
 * The branch list is FLAT and in source order: it is what the chapter strip walks, and every branch
 * runs on its own whatever the grouping is. Precedence lives in `tree` beside it rather than in the
 * list's shape, because the two questions have different answers — "which pieces did the user
 * write, in what order" and "which two results actually meet at each step" — and collapsing them
 * into one nested list would cost the strip its reading order.
 */
export type ParsedSetOp = {
  readonly kind: "setop";
  readonly text: string;
  readonly statement: Range;
  /** The WITH prefix, which belongs to the whole statement and must be prepended to every branch probe. */
  readonly with: Range | null;
  readonly ctes: readonly Cte[];
  /** Two or more, in source order. */
  readonly branches: readonly SetBranch[];
  /** One per gap between branches: operators[i] joins branches[i] and branches[i+1]. */
  readonly operators: readonly { readonly op: SetOperator; readonly range: Range }[];
  /** The same chain grouped the way SQL evaluates it. A single branch is the bare `branch` node. */
  readonly tree: SetTree;
  /** A trailing ORDER BY / LIMIT / OFFSET that applies to the WHOLE statement, not the last branch. */
  readonly orderBy: Clause | null;
  readonly orderItems: readonly OrderItem[];
  readonly limit: Clause | null;
  readonly limitValue: number | null;
  readonly offset: Clause | null;
  readonly offsetValue: number | null;
};

/**
 * `dept_name in ('Comp. Sci.', 'Physics')` — the other IN, the one whose parentheses hold values.
 *
 * `subqueryPredicates` steps straight over these, correctly: there is no subquery to run and so no
 * section to build. But the WHERE station then shows the whole thing as one opaque pass/fail, and
 * "which of these values did this row actually match" is the only question the predicate asks.
 *
 * The values are kept as RANGES, never as parsed literals. Deciding in JavaScript whether a row's
 * value equals one of them would be re-implementing SQL comparison — collation, numeric coercion,
 * `CHAR` padding — and getting it wrong in exactly the cases a reader would never think to check.
 * The station splices these ranges into the probe instead and lets the database say.
 */
export type InList = {
  /** The whole predicate as written: `x not in (1, 2)`. */
  readonly range: Range;
  /** The compared expression on the left. */
  readonly left: Range;
  /** Each value inside the parentheses, commas dropped. */
  readonly values: readonly Range[];
  readonly negated: boolean;
  /**
   * Whether a bare `null` sits among the values, read off the TEXT rather than off a result.
   *
   * It earns its own flag because it silently decides the predicate: `x not in (1, null)` is never
   * true for any x, since the comparison to `null` is unknown and an unknown conjunct sinks the
   * whole `not in`. A reader staring at an empty result deserves to be told that, and the word is
   * right there in the query — no probe required.
   */
  readonly hasNull: boolean;
};

export type SubqueryPredicateKind = "exists" | "not exists" | "in" | "not in" | "scalar";

export type SubqueryPredicate = {
  readonly kind: SubqueryPredicateKind;
  /** The whole predicate as written: `not exists (select …)`, `x in (select …)`. */
  readonly range: Range;
  /** Inside the subquery's parentheses. */
  readonly body: Range;
  /** For in/not in and scalar: the compared expression. Null for exists. */
  readonly left: Range | null;
  /** For scalar: the comparison operator as written (`=`, `>`, `<=`, …). */
  readonly operator: string | null;
  /** The subquery parsed on its own; a nested EXISTS inside it shows up in ITS predicates. */
  readonly parsed: ParsedSelect | Unsupported;
  /**
   * Column references inside the subquery that are qualified by something the subquery itself does
   * not define — i.e. references to the OUTER query's rows. Empty means the subquery is
   * uncorrelated and can be run once.
   */
  readonly correlated: readonly string[];
};

/**
 * A subquery written in the SELECT list, whose result is a VALUE rather than a test.
 *
 * The two shapes are the same two a predicate has, and so is what separates them: one that names
 * nothing outside itself is computed once and the same value lands on every row, while a correlated
 * one is re-run for each row and lands a different value on each. What it does NOT have is a
 * verdict — there is no boolean here for a probe to splice `true` over — which is why it carries no
 * `kind` and why `bound.ts` cannot treat it as a predicate.
 */
export type SelectSubquery = {
  /** The whole select-list item as written: the expression around the subquery, and its alias. */
  readonly item: Range;
  /** The subquery itself, parentheses included: `(select count(*) from student)`. */
  readonly range: Range;
  /** Inside those parentheses. */
  readonly body: Range;
  /** The name the item was given — `total_students` — or null when it was given none. */
  readonly alias: string | null;
  /** The subquery parsed on its own; the enclosing statement's CTEs are seeded into its scope. */
  readonly parsed: ParsedSelect | Unsupported;
  /**
   * References inside it that name something it does not define: the outer query's rows. Only
   * QUALIFIED ones count, exactly as for a predicate — an empty list means "no PROVABLE
   * correlation" and never "uncorrelated". See `correlatedIn`.
   */
  readonly correlated: readonly string[];
};

/**
 * One run of a spliced statement: either text the user typed or one thing the walk wrote over it.
 *
 * The split is kept so a reader can be shown WHICH character changed. The SQL panel renders a
 * substituted run as its own element and cross-fades only that one when the bound row moves; joined
 * back together the parts are character-for-character `spliceRanges`, which is what builds them.
 */
export type SqlPart = {
  readonly text: string;
  /** The reference this run was written over (`s.ID`), or null for the user's own text. */
  readonly over: string | null;
};

export function isSetOp(value: ParsedSelect | ParsedSetOp | Unsupported): value is ParsedSetOp {
  return value.kind === "setop";
}

export function isUnsupported(
  value: ParsedSelect | ParsedSetOp | Unsupported,
): value is Unsupported {
  return value.kind === "unsupported";
}
