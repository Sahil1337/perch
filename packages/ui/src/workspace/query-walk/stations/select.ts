// The clause walk: one SELECT into FROM, JOIN n, WHERE, GROUP BY, HAVING, WINDOW, SELECT,
// DISTINCT, ORDER BY and LIMIT.
//
// Every query is the user's own text spliced together, so the "SQL that ran" block can show it and
// it means what the user wrote. A newline goes before anything appended: a `-- comment` at the end
// of a clause would otherwise swallow the `limit` that follows it.

import type { Dialect } from "@perch/protocol";
import {
  conjuncts,
  type ParsedSelect,
  type Range,
} from "../clauses";
import { caseExpressions } from "../case-expr";
import {
  ABSENT,
  absentStation,
  sourceTitle,
  station,
  wrap,
  type Query,
  type Station,
} from "../station-types";
import {
  branchColumn,
  conjunctColumn,
  keyColumn,
  measurableInLists,
  memberColumn,
  memberNullColumn,
  PASS_COLUMN,
  WINDOW_COLUMN,
} from "../walk-columns";
import { windowFunctions, windowRange } from "../window-fn";

export function buildStations(parsed: ParsedSelect, dialect: Dialect): Station[] {
  const { text } = parsed;
  const slice = (range: Range): string => text.slice(range.from, range.to);
  const withPrefix = parsed.with ? `${slice(parsed.with)}\n` : "";
  const lines = (...parts: (string | null | undefined)[]): string =>
    parts.filter((part): part is string => Boolean(part)).join("\n");
  const { limited, counted } = wrap(withPrefix);

  const list = slice(parsed.selectList);
  const fullFrom = slice(parsed.from);
  const where = parsed.where ? slice(parsed.where.range) : null;
  const groupBy = parsed.groupBy ? slice(parsed.groupBy.range) : null;
  const having = parsed.having ? slice(parsed.having.range) : null;
  const window = parsed.window ? slice(parsed.window.range) : null;
  const orderBy = parsed.orderBy ? slice(parsed.orderBy.range) : null;
  const distinct = parsed.distinct ? slice(parsed.distinct) : null;

  const sample = (sql: string): Query => ({ id: "sample", label: "Sample", sql: limited(sql) });
  const count = (sql: string): Query => ({ id: "count", label: "Count", sql: counted(sql) });

  const stations: Station[] = [];

  /* FROM: one card per source, each its own probe so a missing table only fails its own card. */
  const sources = [parsed.first, ...parsed.joins.map((join) => join.source)];
  stations.push(
    station({
    key: "from",
    id: "from",
    label: "FROM",
    present: true,
    clause: { from: parsed.fromKeyword.from, to: parsed.first.range.to },
    batches: sources.map((source, index) => [
      {
        id: `src${index}.sample`,
        label: `Sample of ${sourceTitle(source)}`,
        sql: limited(`select *\nfrom ${slice(source.range)}`),
      },
      {
        id: `src${index}.count`,
        label: `Count of ${sourceTitle(source)}`,
        sql: `${withPrefix}select count(*)\nfrom ${slice(source.range)}`,
      },
    ]),
    }),
  );

  /* JOIN n: the FROM list up to and including join n. */
  if (parsed.joins.length === 0) {
    stations.push(absentStation("join", "join", "JOIN"));
  }
  parsed.joins.forEach((join, index) => {
    const through = `select *\n${text.slice(parsed.fromKeyword.from, join.range.to)}`;
    const queries: Query[] = [sample(through), count(through)];
    if (join.kind === "inner" && join.label !== ",") {
      // The same chain with this join spelled as a left join: the rows an inner join drops are the
      // ones that come back with nothing on the right.
      //
      // `NATURAL` has to survive the rewrite. It is part of the join's keyword run, so replacing
      // that run outright leaves `left join t` with no condition at all — which is a syntax error,
      // not a wider join, and the probe came back empty every time.
      const spelled = join.natural ? "natural left join" : "left join";
      const pairs = `select *\n${text.slice(parsed.fromKeyword.from, join.keyword.from)}${spelled}${text.slice(join.keyword.to, join.range.to)}`;
      queries.push({ id: "pairs", label: "Every pairing (as a left join)", sql: limited(pairs) });
    }
    stations.push({
      key: `join${index}`,
      id: "join",
      label: parsed.joins.length > 1 ? `JOIN ${index + 1}` : "JOIN",
      present: true,
      clause: join.range,
      batches: [queries],
      join,
      joinIndex: index,
      sentence: null,
      root: null,
      inLists: [],
    });
  });

  /* WHERE */
  {
    const base = lines("select *", fullFrom, where);
    // One boolean per depth-zero conjunct, beside the verdict the station already asks for. It is
    // the same statement with wider columns, not a second probe, and it is the only measure of
    // "how close did this row come" that exists for free: a row that failed one of three tests got
    // further than a row that failed all three. A single-conjunct WHERE adds nothing, because the
    // one column would be the verdict again under another name.
    const parts = parsed.where ? conjuncts(text, parsed.where.body, dialect) : [];
    const tests =
      parts.length > 1
        ? parts.map((part, index) => `, (${slice(part)}) as ${conjunctColumn(index)}`)
        : [];
    // One boolean per value of each `IN (…)` list, on the same widened statement. `x in (a, b)` is
    // one verdict but three facts, and the two that the pass/fail throws away — WHICH value matched,
    // and whether the left side was null and so matched nothing it could have — are the two the
    // predicate is actually about. The null test is asked separately because `x = a` is null rather
    // than false when `x` is, so the value columns alone cannot tell "matched nothing" from "had
    // nothing to match with".
    const lists = measurableInLists(parsed, dialect);
    const members = lists
      .filter((entry) => entry.measured)
      .flatMap(({ list, index }) => [
        ...list.values.map(
          (value, vi) =>
            `, ((${slice(list.left)}) = (${slice(value)})) as ${memberColumn(index, vi)}`,
        ),
        `, ((${slice(list.left)}) is null) as ${memberNullColumn(index)}`,
      ]);
    const queries: Query[] = parsed.where
      ? [
          sample(base),
          count(base),
          {
            id: "verdict",
            label: "Row test",
            sql: limited(
              lines(
                `select *, (${slice(parsed.where.body)}) as ${PASS_COLUMN}${tests.join("")}${members.join("")}`,
                fullFrom,
              ),
            ),
          },
        ]
      : [];
    stations.push(
      station({
        key: "where",
        id: "where",
        label: "WHERE",
        present: parsed.where !== null,
        clause: parsed.where?.range ?? null,
        batches: parsed.where ? [queries] : ABSENT,
        // A WHERE that was not in the query measured nothing, whatever `lists` found: the default
        // is right for every other station and wrong only when this one is present.
        inLists: parsed.where ? lists : [],
      }),
    );
  }

  /* GROUP BY: the grouped rows, plus the rows before grouping ordered by the keys. */
  const keyColumns = parsed.groupKeys.map((key, index) => `(${key}) as ${keyColumn(index)}`);
  const grouped = lines(`select ${list}`, fullFrom, where, groupBy, window);
  {
    const queries: Query[] = parsed.groupBy
      ? [
          sample(
            lines(`select ${list}, ${keyColumns.join(", ")}`, fullFrom, where, groupBy, window),
          ),
          count(grouped),
          {
            id: "pre",
            label: "Rows before grouping, ordered by the keys",
            sql: limited(
              lines(
                `select *, ${keyColumns.join(", ")}`,
                fullFrom,
                where,
                `order by ${parsed.groupKeys.map((_, index) => keyColumn(index)).join(", ")}`,
              ),
            ),
          },
        ]
      : [];
    stations.push(
      station({
      key: "group",
      id: "group",
      label: "GROUP BY",
      present: parsed.groupBy !== null,
      clause: parsed.groupBy?.range ?? null,
      batches: parsed.groupBy ? [queries] : ABSENT,
      }),
    );
  }

  /* HAVING */
  const withHaving = lines(`select ${list}`, fullFrom, where, groupBy, having, window);
  {
    const queries: Query[] = parsed.having
      ? [
          sample(withHaving),
          count(withHaving),
          {
            id: "verdict",
            label: "Group test",
            sql: limited(
              lines(
                `select ${list}, (${slice(parsed.having.body)}) as ${PASS_COLUMN}`,
                fullFrom,
                where,
                groupBy,
                window,
              ),
            ),
          },
        ]
      : [];
    stations.push(
      station({
      key: "having",
      id: "having",
      label: "HAVING",
      present: parsed.having !== null,
      clause: parsed.having?.range ?? null,
      batches: parsed.having ? [queries] : ABSENT,
      }),
    );
  }

  /* WINDOW: the rows HAVING left, each one given the window function's value.
   *
   * It sits here because a window function sees the rows grouping already settled — which is the
   * whole reason ORDER BY may sort by one and WHERE cannot mention one at all. The partition
   * expressions ride along as key columns so the scene can gather the rows into panes without
   * re-deriving them, and the function itself is computed a second time under a name the walk
   * owns. The count is only here to show the number did not move: unlike GROUP BY, a pane keeps
   * every row it holds.
   */
  const windows = windowFunctions(parsed);
  {
    const fn = windows[0];
    const keys = fn ? fn.partition.map((key, index) => `(${key}) as ${keyColumn(index)}`) : [];
    // Panes first, then the order the function walks them in, so the sample arrives looking like
    // what it is. Both are the user's own expressions; the key columns are ordered by their alias
    // because a partition on an expression has no column name to name.
    const paneOrder = fn ? [...fn.partition.map((_, index) => keyColumn(index)), ...fn.order] : [];
    const probe = fn
      ? lines(
          `select ${[list, ...keys, `(${fn.expr}) as ${WINDOW_COLUMN}`].join(", ")}`,
          fullFrom,
          where,
          groupBy,
          having,
          window,
          paneOrder.length > 0 ? `order by ${paneOrder.join(", ")}` : null,
        )
      : "";
    stations.push(
      station({
      key: "window",
      id: "window",
      label: "WINDOW",
      present: fn !== undefined,
      clause: fn ? windowRange(parsed, fn) : null,
      batches: fn ? [[sample(probe), count(withHaving)]] : ABSENT,
      }),
    );
  }

  /* SELECT: the output columns. Same row count as the station before it, so no count. */
  {
    const queries: Query[] = [sample(withHaving)];
    const branches = caseExpressions(parsed)[0];
    if (branches) {
      // Every WHEN spliced out as its own boolean column. The CASE alone only ever shows its
      // answer, so without these there is no way to say which branch produced it — and the first
      // true one wins, which only reads as a rule once the others can be seen failing.
      const tests = branches.branches.map(
        (branch, index) => `(${branch.when}) as ${branchColumn(index)}`,
      );
      queries.push({
        id: "case",
        label: "The branch each row takes",
        sql: limited(
          lines(`select ${[list, ...tests].join(", ")}`, fullFrom, where, groupBy, having, window),
        ),
      });
    }
    stations.push(
      station({
      key: "select",
      id: "select",
      label: "SELECT",
      present: true,
      clause: parsed.selectClause,
      batches: [queries],
      }),
    );
  }

  /* DISTINCT */
  const withDistinct = lines(
    `select ${distinct ? `${distinct} ` : ""}${list}`,
    fullFrom,
    where,
    groupBy,
    having,
    window,
  );
  stations.push(
    station({
    key: "distinct",
    id: "distinct",
    label: "DISTINCT",
    present: parsed.distinct !== null,
    clause: parsed.distinct,
    batches: parsed.distinct ? [[sample(withDistinct), count(withDistinct)]] : ABSENT,
    }),
  );

  /* ORDER BY: no count, the rows only move. */
  stations.push(
    station({
    key: "order",
    id: "order",
    label: "ORDER BY",
    present: parsed.orderBy !== null,
    clause: parsed.orderBy?.range ?? null,
    batches: parsed.orderBy ? [[sample(lines(withDistinct, orderBy))]] : ABSENT,
    }),
  );

  /* LIMIT / OFFSET: the query exactly as written. The server still caps the rows it returns. */
  const hasLimit = parsed.limit !== null || parsed.offset !== null;
  const limitClause: Range | null =
    parsed.limit && parsed.offset
      ? {
          from: Math.min(parsed.limit.range.from, parsed.offset.range.from),
          to: Math.max(parsed.limit.range.to, parsed.offset.range.to),
        }
      : (parsed.limit?.range ?? parsed.offset?.range ?? null);
  stations.push(
    station({
    key: "limit",
    id: "limit",
    label: parsed.limit === null && parsed.offset !== null ? "OFFSET" : "LIMIT",
    present: hasLimit,
    clause: limitClause,
    batches: hasLimit
      ? [[{ id: "sample", label: "The query as written", sql: slice(parsed.statement) }]]
      : ABSENT,
    }),
  );

  return stations;
}
