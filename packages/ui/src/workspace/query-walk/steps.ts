// From the sliced clauses to the ordered stations, each with the SQL it samples and counts.
//
// Every query is the user's own text spliced together, so the "SQL that ran" block can show it and
// it means what the user wrote. A newline goes before anything appended: a `-- comment` at the end
// of a clause would otherwise swallow the `limit` that follows it.

import type { JoinClause, ParsedSelect, Range, SourceRef } from "./clauses";

export type StationId =
  | "from"
  | "join"
  | "where"
  | "group"
  | "having"
  | "select"
  | "distinct"
  | "order"
  | "limit";

/** Rows a sample asks for. The server caps at the same number through `maxRows`. */
export const SAMPLE_ROWS = 25;

/** Output columns the walk adds for its own bookkeeping; never shown. */
export const WALK_PREFIX = "_perch_walk_";
export const PASS_COLUMN = `${WALK_PREFIX}pass`;
export const keyColumn = (index: number): string => `${WALK_PREFIX}k${index}`;

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
};

const ABSENT: Station["batches"] = [];

/** `orders o`, `customers`, `subquery d`. */
export function sourceTitle(source: SourceRef): string {
  return source.alias && source.alias !== source.name ? `${source.name} ${source.alias}` : source.name;
}

export function buildStations(parsed: ParsedSelect): Station[] {
  const { text } = parsed;
  const slice = (range: Range): string => text.slice(range.from, range.to);
  const withPrefix = parsed.with ? `${slice(parsed.with)}\n` : "";
  const lines = (...parts: (string | null | undefined)[]): string =>
    parts.filter((part): part is string => Boolean(part)).join("\n");
  const limited = (sql: string): string => `${withPrefix}${sql}\nlimit ${SAMPLE_ROWS}`;
  const counted = (sql: string): string =>
    `${withPrefix}select count(*) from (\n${sql}\n) as ${WALK_PREFIX}count`;

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
  stations.push({
    key: "from",
    id: "from",
    label: "FROM",
    present: true,
    clause: { from: parsed.fromKeyword.from, to: parsed.first.range.to },
    batches: sources.map((source, index) => [
      { id: `src${index}.sample`, label: `Sample of ${sourceTitle(source)}`, sql: limited(`select *\nfrom ${slice(source.range)}`) },
      { id: `src${index}.count`, label: `Count of ${sourceTitle(source)}`, sql: `${withPrefix}select count(*)\nfrom ${slice(source.range)}` },
    ]),
    join: null,
    joinIndex: -1,
  });

  /* JOIN n: the FROM list up to and including join n. */
  if (parsed.joins.length === 0) {
    stations.push({ key: "join", id: "join", label: "JOIN", present: false, clause: null, batches: ABSENT, join: null, joinIndex: -1 });
  }
  parsed.joins.forEach((join, index) => {
    const through = `select *\n${text.slice(parsed.fromKeyword.from, join.range.to)}`;
    const queries: Query[] = [sample(through), count(through)];
    if (join.kind === "inner" && join.label !== ",") {
      // The same chain with this join spelled as a left join: the rows an inner join drops are the
      // ones that come back with nothing on the right.
      const pairs =
        `select *\n${text.slice(parsed.fromKeyword.from, join.keyword.from)}left join${text.slice(join.keyword.to, join.range.to)}`;
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
    });
  });

  /* WHERE */
  {
    const base = lines("select *", fullFrom, where);
    const queries: Query[] = parsed.where
      ? [
          sample(base),
          count(base),
          {
            id: "verdict",
            label: "Row test",
            sql: limited(lines(`select *, (${slice(parsed.where.body)}) as ${PASS_COLUMN}`, fullFrom)),
          },
        ]
      : [];
    stations.push({ key: "where", id: "where", label: "WHERE", present: parsed.where !== null, clause: parsed.where?.range ?? null, batches: parsed.where ? [queries] : ABSENT, join: null, joinIndex: -1 });
  }

  /* GROUP BY: the grouped rows, plus the rows before grouping ordered by the keys. */
  const keyColumns = parsed.groupKeys.map((key, index) => `(${key}) as ${keyColumn(index)}`);
  const grouped = lines(`select ${list}`, fullFrom, where, groupBy, window);
  {
    const queries: Query[] = parsed.groupBy
      ? [
          sample(lines(`select ${list}, ${keyColumns.join(", ")}`, fullFrom, where, groupBy, window)),
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
    stations.push({ key: "group", id: "group", label: "GROUP BY", present: parsed.groupBy !== null, clause: parsed.groupBy?.range ?? null, batches: parsed.groupBy ? [queries] : ABSENT, join: null, joinIndex: -1 });
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
            sql: limited(lines(`select ${list}, (${slice(parsed.having.body)}) as ${PASS_COLUMN}`, fullFrom, where, groupBy, window)),
          },
        ]
      : [];
    stations.push({ key: "having", id: "having", label: "HAVING", present: parsed.having !== null, clause: parsed.having?.range ?? null, batches: parsed.having ? [queries] : ABSENT, join: null, joinIndex: -1 });
  }

  /* SELECT: the output columns. Same row count as the station before it, so no count. */
  stations.push({
    key: "select",
    id: "select",
    label: "SELECT",
    present: true,
    clause: parsed.selectClause,
    batches: [[sample(withHaving)]],
    join: null,
    joinIndex: -1,
  });

  /* DISTINCT */
  const withDistinct = lines(`select ${distinct ? `${distinct} ` : ""}${list}`, fullFrom, where, groupBy, having, window);
  stations.push({
    key: "distinct",
    id: "distinct",
    label: "DISTINCT",
    present: parsed.distinct !== null,
    clause: parsed.distinct,
    batches: parsed.distinct ? [[sample(withDistinct), count(withDistinct)]] : ABSENT,
    join: null,
    joinIndex: -1,
  });

  /* ORDER BY: no count, the rows only move. */
  stations.push({
    key: "order",
    id: "order",
    label: "ORDER BY",
    present: parsed.orderBy !== null,
    clause: parsed.orderBy?.range ?? null,
    batches: parsed.orderBy ? [[sample(lines(withDistinct, orderBy))]] : ABSENT,
    join: null,
    joinIndex: -1,
  });

  /* LIMIT / OFFSET: the query exactly as written. The server still caps the rows it returns. */
  const hasLimit = parsed.limit !== null || parsed.offset !== null;
  const limitClause: Range | null =
    parsed.limit && parsed.offset
      ? { from: Math.min(parsed.limit.range.from, parsed.offset.range.from), to: Math.max(parsed.limit.range.to, parsed.offset.range.to) }
      : (parsed.limit?.range ?? parsed.offset?.range ?? null);
  stations.push({
    key: "limit",
    id: "limit",
    label: parsed.limit === null && parsed.offset !== null ? "OFFSET" : "LIMIT",
    present: hasLimit,
    clause: limitClause,
    batches: hasLimit ? [[{ id: "sample", label: "The query as written", sql: slice(parsed.statement) }]] : ABSENT,
    join: null,
    joinIndex: -1,
  });

  return stations;
}
