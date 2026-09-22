// Completion that reads the statement instead of the dictionary.
//
// `@codemirror/lang-sql`'s own source offers every keyword and every column in the database at
// every position, which is the same list whether you are three tables into a join or have not
// written FROM yet. This source answers from `analyzeSql`: columns only for the tables actually in
// scope, tables only where a table can go, and only the keywords that can legally follow. It is
// installed through `override`, because that is the one way to suppress the language-data source —
// a facet value cannot be removed once the language provides it.

import {
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from "@codemirror/autocomplete";
import type { Column, DatabaseSchema, Dialect, Schema, Settings, Table } from "@perch/protocol";
import { analyzeSql, type SqlClause, type SqlContext, type TableRef } from "./sql-context";
import { statementAtCursor } from "./statements";

/**
 * Ranking, in one place. CodeMirror takes -99..99 and applies it on top of its own match score, so
 * these only have to order groups that match the typed text equally well. Schema objects always
 * outrank keywords: the keyword you want is usually one you already know how to spell.
 */
const BOOST = {
  predicate: 90,
  relatedTable: 70,
  column: 60,
  qualifiedColumn: 60,
  table: 40,
  bareColumn: 30,
  schemaName: 10,
  keyword: -20,
  fn: -30,
} as const;

const COLUMN_CLAUSES = new Set<SqlClause>([
  "select",
  "on",
  "where",
  "having",
  "groupBy",
  "orderBy",
  "set",
  "insertColumns",
  "returning",
]);

const TABLE_CLAUSES = new Set<SqlClause>(["from", "join", "insertInto", "update"]);

/** Clauses where a scalar or aggregate call reads as a suggestion rather than noise. */
const FUNCTION_CLAUSES = new Set<SqlClause>(["select", "on", "where", "having"]);

const FUNCTIONS = [
  "count",
  "sum",
  "avg",
  "min",
  "max",
  "coalesce",
  "nullif",
  "cast",
  "lower",
  "upper",
  "length",
  "trim",
  "round",
  "abs",
  "concat",
  "substring",
  "now",
];

type Options = {
  schema: DatabaseSchema | undefined;
  dialect: Dialect;
  /** Reuse `defaultSchemaName` from ./completion.ts — the schema whose tables need no prefix. */
  defaultSchema: string | undefined;
  keywordCase: Settings["keywordCase"];
};

export function smartCompletionSource(options: Options): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const word = context.matchBefore(/[\w$]*/);
    if (!word) return null;
    // An empty match means the cursor is not inside a word. Typing `.` should still open the
    // popup — that is the whole point of a qualifier — but a bare space should not.
    const afterDot = context.state.sliceDoc(Math.max(0, word.from - 1), word.from) === ".";
    if (word.from === word.to && !context.explicit && !afterDot) return null;

    const doc = context.state.doc.toString();
    // One statement, not the document: on a file with a hundred queries in it the analyser would
    // otherwise re-tokenize all of them on every keystroke.
    const statement = statementAtCursor(doc, context.pos);
    const analysis = analyzeSql(statement?.sql ?? doc, context.pos - (statement?.offset ?? 0));

    const list = buildOptions(analysis, options);
    if (list.length === 0) return null;
    return { from: word.from, getMatch: shiftMatch, options: list, validFor: /^[\w$]*$/ };
  };
}

function buildOptions(analysis: SqlContext, options: Options): Completion[] {
  const list: Completion[] = [];
  if (COLUMN_CLAUSES.has(analysis.clause)) {
    const columns = columnOptions(analysis, options);
    // A qualifier that resolved to nothing is a dead end, not an invitation to list keywords.
    if (analysis.qualifier) return columns;
    list.push(...columns);
  }
  if (TABLE_CLAUSES.has(analysis.clause)) {
    const tables = tableOptions(analysis, options);
    if (analysis.qualifier) return tables;
    list.push(...tables);
  }
  if (analysis.qualifier) return [];

  if (analysis.clause === "on") list.push(...joinPredicates(analysis, options));
  list.push(...keywordOptions(analysis.clause, options));
  if (FUNCTION_CLAUSES.has(analysis.clause)) list.push(...functionOptions(options));
  return list;
}

function sameName(a: string | undefined, b: string | undefined): boolean {
  return a !== undefined && b !== undefined && a.toLowerCase() === b.toLowerCase();
}

function findSchema(schema: DatabaseSchema | undefined, name: string): Schema | undefined {
  return schema?.schemas.find((entry) => sameName(entry.name, name));
}

/** The table a FROM item names, searching the default schema before the rest. */
function resolveRef(ref: TableRef, options: Options): Table | undefined {
  const { defaultSchema, schema } = options;
  if (!schema || ref.derived) return undefined;
  if (ref.schema) {
    return findSchema(schema, ref.schema)?.tables.find((table) => sameName(table.name, ref.table));
  }
  const preferred = defaultSchema ? findSchema(schema, defaultSchema) : undefined;
  const hit = preferred?.tables.find((table) => sameName(table.name, ref.table));
  if (hit) return hit;
  for (const entry of schema.schemas) {
    const table = entry.tables.find((candidate) => sameName(candidate.name, ref.table));
    if (table) return table;
  }
  return undefined;
}

function columnCompletion(column: Column, label: string, detail: string, boost: number): Completion {
  return { boost, detail, label, type: column.pk ? "constant" : "property" };
}

/**
 * A qualified column, matched on its bare name.
 *
 * `label` is what CodeMirror scores the typed text against, and its penalties dwarf `boost`:
 * matching `na` inside `s.name` costs -700 for not starting at the front, against a ±99 boost
 * range. Scored on `s.name` the qualified form could never outrank the bare one however it was
 * boosted. Scoring on `name` and showing `s.name` makes the two forms tie on the match, which is
 * what lets `boost` order them — and it is the truthful comparison anyway, since the column name
 * is what you are typing.
 */
function qualifiedColumn(column: Column, prefix: string, detail: string): Completion {
  return {
    apply: `${prefix}.${column.name}`,
    boost: BOOST.qualifiedColumn,
    detail,
    displayLabel: `${prefix}.${column.name}`,
    label: column.name,
    type: column.pk ? "constant" : "property",
  };
}

/**
 * Where the typed text sits in a `displayLabel`. CodeMirror hands back ranges into `label`, and
 * anything with a `displayLabel` renders no highlight at all unless this puts them back — the
 * prefix and its dot are the whole offset.
 */
function shiftMatch(completion: Completion, matched?: readonly number[]): readonly number[] {
  if (!matched) return [];
  // `getMatch` is set on the whole result, so most of what arrives here is a plain label whose
  // ranges already point at the text CodeMirror will render. Returning [] would un-bold them all.
  if (!completion.displayLabel) return matched;
  const shift = completion.displayLabel.length - completion.label.length;
  return matched.map((index) => index + shift);
}

/** Bare columns, the way `completion.ts` has always rendered them: type as detail, `· pk` marker. */
function bareColumns(table: Table, boost: number): Completion[] {
  return table.columns.map((column) =>
    columnCompletion(column, column.name, column.pk ? `${column.type} · pk` : column.type, boost),
  );
}

function columnOptions(analysis: SqlContext, options: Options): Completion[] {
  const { schema } = options;
  const refs = analysis.tables;

  if (analysis.qualifier) {
    const path = analysis.qualifierPath ?? [analysis.qualifier];
    const ref =
      refs.find((candidate) => sameName(candidate.alias, analysis.qualifier)) ??
      refs.find((candidate) => sameName(candidate.table, analysis.qualifier));
    if (ref) {
      const table = resolveRef(ref, options);
      return table ? bareColumns(table, BOOST.column) : [];
    }
    // `public.users.|` — a table nobody put in FROM yet, but still a real one.
    if (path.length >= 2) {
      const qualified = resolveRef(
        { schema: path[path.length - 2], table: analysis.qualifier },
        options,
      );
      if (qualified) return bareColumns(qualified, BOOST.column);
      return [];
    }
    const entry = findSchema(schema, analysis.qualifier);
    return entry ? entry.tables.map((table) => tableCompletion(table, table.name, BOOST.table)) : [];
  }

  // No FROM clause written yet means no columns — deliberately, not as a fallback. Offering the
  // whole database here is what makes the plain dictionary source unreadable.
  if (refs.length === 0) return [];

  const scope = refs
    .map((ref) => ({ ref, table: resolveRef(ref, options) }))
    .filter((entry): entry is { ref: TableRef; table: Table } => entry.table !== undefined);
  if (scope.length === 0) return [];
  if (refs.length === 1) {
    const only = scope[0];
    return only ? bareColumns(only.table, BOOST.column) : [];
  }

  // A name carried by two of the joined tables is ambiguous, and inserting it bare would produce a
  // query the server rejects — so it is offered qualified only.
  const occurrences = new Map<string, number>();
  for (const entry of scope) {
    for (const column of entry.table.columns) {
      const key = column.name.toLowerCase();
      occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
    }
  }

  const qualified: Completion[] = [];
  const bare: Completion[] = [];
  for (const { ref, table } of scope) {
    const prefix = ref.alias ?? ref.table;
    for (const column of table.columns) {
      qualified.push(qualifiedColumn(column, prefix, `${column.type} · ${table.name}`));
      if (occurrences.get(column.name.toLowerCase()) === 1) {
        bare.push(
          columnCompletion(
            column,
            column.name,
            column.pk ? `${column.type} · pk` : column.type,
            BOOST.bareColumn,
          ),
        );
      }
    }
  }
  return [...qualified, ...bare];
}

function rowCount(estimate: number): string {
  if (estimate < 1000) return `${estimate} rows`;
  if (estimate < 1_000_000) return `${trim1(estimate / 1000)}k rows`;
  return `${trim1(estimate / 1_000_000)}m rows`;
}

function trim1(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function tableCompletion(table: Table, label: string, boost: number): Completion {
  const kind = table.kind === "materialized_view" ? "materialized view" : table.kind;
  const detail =
    table.rowEstimate === undefined ? kind : `${kind} · ~${rowCount(table.rowEstimate)}`;
  return { boost, detail, label, type: table.kind === "table" ? "class" : "interface" };
}

function tableKey(schemaName: string, tableName: string): string {
  return `${schemaName.toLowerCase()}.${tableName.toLowerCase()}`;
}

/** Tables a foreign key already links to something in scope — the ones a JOIN is reaching for. */
function relatedTables(analysis: SqlContext, options: Options): Set<string> {
  const related = new Set<string>();
  const schema = options.schema;
  if (!schema) return related;
  const inScope = analysis.tables
    .map((ref) => resolveRef(ref, options))
    .filter((table): table is Table => table !== undefined);
  if (inScope.length === 0) return related;

  for (const table of inScope) {
    for (const fk of table.foreignKeys) related.add(tableKey(fk.refSchema, fk.refTable));
  }
  for (const entry of schema.schemas) {
    for (const table of entry.tables) {
      for (const fk of table.foreignKeys) {
        if (inScope.some((scoped) => tableKey(fk.refSchema, fk.refTable) === tableKey(scoped.schema, scoped.name))) {
          related.add(tableKey(entry.name, table.name));
        }
      }
    }
  }
  for (const table of inScope) related.delete(tableKey(table.schema, table.name));
  return related;
}

function tableOptions(analysis: SqlContext, options: Options): Completion[] {
  const { defaultSchema, schema } = options;
  if (!schema) return [];

  if (analysis.qualifier) {
    const entry = findSchema(schema, analysis.qualifier);
    return entry ? entry.tables.map((table) => tableCompletion(table, table.name, BOOST.table)) : [];
  }

  const related =
    analysis.clause === "join" || analysis.clause === "on"
      ? relatedTables(analysis, options)
      : new Set<string>();

  const list: Completion[] = [];
  for (const entry of schema.schemas) {
    const bare = sameName(entry.name, defaultSchema);
    for (const table of entry.tables) {
      const boost = related.has(tableKey(entry.name, table.name)) ? BOOST.relatedTable : BOOST.table;
      list.push(tableCompletion(table, bare ? table.name : `${entry.name}.${table.name}`, boost));
    }
    list.push({ boost: BOOST.schemaName, detail: "schema", label: entry.name, type: "type" });
  }
  return list;
}

/**
 * The ON predicate a foreign key already spells out. The join being written is the last table in
 * scope, so only its relationships with the tables before it are worth offering.
 */
function joinPredicates(analysis: SqlContext, options: Options): Completion[] {
  const refs = analysis.tables;
  if (refs.length < 2) return [];
  const lastRef = refs[refs.length - 1];
  if (!lastRef) return [];
  const lastTable = resolveRef(lastRef, options);
  if (!lastTable) return [];

  const predicates: Completion[] = [];
  const add = (left: string, leftColumns: string[], right: string, rightColumns: string[]): void => {
    const parts = leftColumns.map(
      (column, index) => `${left}.${column} = ${right}.${rightColumns[index] ?? column}`,
    );
    if (parts.length === 0) return;
    predicates.push({
      boost: BOOST.predicate,
      detail: "foreign key",
      label: parts.join(" and "),
      type: "text",
    });
  };

  const lastPrefix = lastRef.alias ?? lastRef.table;
  for (const ref of refs.slice(0, -1)) {
    const table = resolveRef(ref, options);
    if (!table) continue;
    const prefix = ref.alias ?? ref.table;
    for (const fk of lastTable.foreignKeys) {
      if (sameName(fk.refTable, table.name)) add(lastPrefix, fk.columns, prefix, fk.refColumns);
    }
    for (const fk of table.foreignKeys) {
      if (sameName(fk.refTable, lastTable.name)) add(prefix, fk.columns, lastPrefix, fk.refColumns);
    }
  }
  return predicates;
}

/** Keywords that can legally follow, and nothing else. */
function clauseKeywords(clause: SqlClause, dialect: Dialect): string[] {
  const postgres = dialect === "postgres";
  switch (clause) {
    case "start":
      return [
        "select",
        "insert into",
        "update",
        "delete from",
        "with",
        "create",
        "alter",
        "drop",
        "truncate",
        "explain",
        "begin",
        "commit",
        "rollback",
      ];
    case "select":
      return ["distinct", "all", "as", "case", "from"];
    case "from":
    case "join":
      return [
        "join",
        "inner join",
        "left join",
        "right join",
        "full join",
        "cross join",
        "on",
        "using",
        "as",
        "where",
        "group by",
        "order by",
        "limit",
        "union",
        ...(dialect === "mysql" ? ["straight_join"] : []),
      ];
    case "on":
    case "where":
    case "having":
      return [
        "and",
        "or",
        "not",
        "in",
        "exists",
        "between",
        "like",
        ...(postgres ? ["ilike"] : []),
        "is null",
        "is not null",
        ...(clause === "where" ? ["group by"] : []),
        "order by",
        "limit",
      ];
    case "groupBy":
      return ["having", "order by", "limit"];
    case "orderBy":
      return ["asc", "desc", ...(postgres ? ["nulls first", "nulls last"] : []), "limit"];
    case "limit":
      return ["offset"];
    case "insertInto":
      return [
        "values",
        "select",
        ...(postgres ? ["on conflict"] : ["on duplicate key update", "ignore"]),
      ];
    case "values":
      return ["default", "null", ...(postgres ? ["returning"] : [])];
    case "update":
      return ["set"];
    case "set":
      return ["where", ...(postgres ? ["returning"] : [])];
    default:
      return [];
  }
}

function keywordOptions(clause: SqlClause, options: Options): Completion[] {
  return clauseKeywords(clause, options.dialect).map((keyword) => ({
    boost: BOOST.keyword,
    label: options.keywordCase === "upper" ? keyword.toUpperCase() : keyword.toLowerCase(),
    type: "keyword",
  }));
}

/** A call, not a bare name: the snippet inserts `NAME()` and leaves the cursor between the parens. */
function functionOptions(options: Options): Completion[] {
  return FUNCTIONS.map((name) => {
    const label = options.keywordCase === "upper" ? name.toUpperCase() : name;
    return snippetCompletion(label + "(${})", {
      boost: BOOST.fn,
      detail: "function",
      label,
      type: "function",
    });
  });
}
