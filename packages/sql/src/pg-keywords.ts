// The Postgres keywords an identifier cannot be spelled as without double quotes: every keyword
// whose category is not "unreserved". Generated once from PostgreSQL 18.4 with
//
//   select word, catcode from pg_get_keywords() where catcode <> 'U' order by catcode, word;
//
// and committed as data, so quoting works without a round trip. A keyword a later release adds is
// a name we leave bare that the server then rejects, never a name we quote wrongly; re-run the
// query against a newer server to refresh the list.
//
// Deliberately separate from the editor's RESERVED set in sql-context.ts, which answers a
// different question (which words end a table reference) for both dialects.

/** R: reserved everywhere. */
const RESERVED = `
  all analyse analyze and any array as asc asymmetric both case cast check collate column
  constraint create current_catalog current_date current_role current_time current_timestamp
  current_user default deferrable desc distinct do else end except false fetch for foreign
  from grant group having in initially intersect into lateral leading limit localtime
  localtimestamp not null offset on only or order placing primary references returning select
  session_user some symmetric system_user table then to trailing true union unique user using
  variadic when where window with
`;

/** T: reserved, but allowed as a function or type name. */
const TYPE_FUNC_NAME = `
  authorization binary collation concurrently cross current_schema freeze full ilike inner is
  isnull join left like natural notnull outer overlaps right similar tablesample verbose
`;

/** C: unreserved, but not allowed as a function or type name. */
const COL_NAME = `
  between bigint bit boolean char character coalesce dec decimal exists extract float
  greatest grouping inout int integer interval json json_array json_arrayagg json_exists
  json_object json_objectagg json_query json_scalar json_serialize json_table json_value
  least merge_action national nchar none normalize nullif numeric out overlay position
  precision real row setof smallint substring time timestamp treat trim values varchar
  xmlattributes xmlconcat xmlelement xmlexists xmlforest xmlnamespaces xmlparse xmlpi xmlroot
  xmlserialize xmltable
`;

/** Lower-case keywords that `quote_ident` quotes. */
export const PG_QUOTED_KEYWORDS: ReadonlySet<string> = new Set(
  [RESERVED, TYPE_FUNC_NAME, COL_NAME].join(" ").trim().split(/\s+/),
);
