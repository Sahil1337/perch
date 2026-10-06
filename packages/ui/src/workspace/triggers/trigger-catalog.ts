// The one place the UI knows Postgres catalog SQL. The schema payload carries each trigger's own
// definition but not its function's: a hundred sixty-line functions come to most of a megabyte, and
// the payload is refetched after every DDL. So the drawer asks for one function when it shows it,
// through `probe`, which is read-only and unrecorded; a catalog SELECT is all it can run there.

import type { Cell, RunRecord, TriggerFunctionRef } from "@perch/protocol";
import { quoteLiteral } from "@perch/sql";

/** One trigger function as the catalog describes it. */
export type FunctionCatalog = {
  readonly schema: string;
  readonly name: string;
  /**
   * `pg_get_functiondef`: a complete `CREATE OR REPLACE FUNCTION` restating every attribute
   * (SECURITY DEFINER, SET, volatility, cost…), with no semicolon and a trailing newline.
   */
  readonly definition: string;
  /** `prosrc`: the body between the dollar quotes for a PL, the symbol name for C and internal. */
  readonly source: string;
  readonly securityDefiner: boolean;
  /** `proconfig`: the function's own SET clauses, as `name=value`. */
  readonly config: readonly string[];
  /** `pg_language.lanname`: "plpgsql", "c", "internal", … */
  readonly language: string;
  /** The extension that owns the function, or null. */
  readonly extension: string | null;
};

export type FunctionCatalogResult =
  | { readonly status: "found"; readonly fn: FunctionCatalog }
  /** Dropped since the schema payload was fetched. */
  | { readonly status: "missing" }
  | { readonly status: "error"; readonly message: string };

/**
 * The read-only SELECT for one trigger function. `pronargs = 0` and the return type make schema
 * plus name unique: a function that takes arguments can't be a trigger function.
 */
export function functionCatalogSql(ref: TriggerFunctionRef): string {
  return `select pg_get_functiondef(p.oid) as definition,
       p.prosrc as source,
       p.prosecdef as security_definer,
       array_to_json(p.proconfig)::text as config,
       l.lanname as language,
       (select e.extname
          from pg_depend d
          join pg_extension e on e.oid = d.refobjid
         where d.classid = 'pg_proc'::regclass
           and d.objid = p.oid
           and d.refclassid = 'pg_extension'::regclass
           and d.deptype = 'e') as extension
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  join pg_language l on l.oid = p.prolang
 where n.nspname = ${quoteLiteral(ref.schema, "postgres")}
   and p.proname = ${quoteLiteral(ref.name, "postgres")}
   and p.pronargs = 0
   and p.prorettype = 'trigger'::regtype`;
}

/** Reads the probe run of {@link functionCatalogSql} for `ref`. */
export function readFunctionCatalog(
  ref: TriggerFunctionRef,
  record: RunRecord,
): FunctionCatalogResult {
  if (record.status !== "done") {
    return { status: "error", message: record.error?.message ?? "The function could not be read." };
  }
  const result = record.results?.[0];
  if (!result) return { status: "error", message: "The function lookup returned nothing." };
  const row = result.rows[0];
  if (!row) return { status: "missing" };

  const cell = (name: string): Cell | undefined => {
    const index = result.columns.findIndex((column) => column.name === name);
    return index === -1 ? undefined : row[index];
  };
  const definition = cell("definition");
  const source = cell("source");
  const language = cell("language");
  if (
    typeof definition !== "string" ||
    typeof source !== "string" ||
    typeof language !== "string"
  ) {
    return { status: "error", message: "The function lookup came back in an unexpected shape." };
  }
  const extension = cell("extension");
  const secdef = cell("security_definer");
  return {
    status: "found",
    fn: {
      schema: ref.schema,
      name: ref.name,
      definition,
      source,
      securityDefiner: secdef === true || secdef === "t" || secdef === "true",
      config: parseConfig(cell("config")),
      language,
      extension: typeof extension === "string" ? extension : null,
    },
  };
}

function parseConfig(value: Cell | undefined): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

/** Whether the function is the user's own, with a body a person wrote. */
export function hasOwnSource(fn: FunctionCatalog): boolean {
  return (
    fn.schema !== "pg_catalog" &&
    fn.extension === null &&
    fn.language !== "c" &&
    fn.language !== "internal"
  );
}

/**
 * `pg_get_functiondef` quotes the body with `$function$`, adding `x`s until the tag is not in the
 * body, and ends the text with a newline.
 */
const CLOSING_TAG = /\$function[x]*\$\n?$/;

/**
 * Splits a function definition at its body: everything before the opening dollar quote, which
 * restates every attribute of the function, and the tag. Null unless the text ends in exactly
 * tag + `source` + tag, so a definition this doesn't understand is never rewritten.
 *
 * Replacing only the body is what keeps SECURITY DEFINER, SET search_path, volatility, COST and
 * the rest: a `CREATE OR REPLACE FUNCTION` that leaves an attribute out resets it.
 */
export function splitFunctionDefinition(
  definition: string,
  source: string,
): { readonly header: string; readonly tag: string } | null {
  const match = CLOSING_TAG.exec(definition);
  if (!match) return null;
  const text = definition.endsWith("\n") ? definition.slice(0, -1) : definition;
  const tag = match[0].endsWith("\n") ? match[0].slice(0, -1) : match[0];
  const close = text.length - tag.length;
  const open = text.lastIndexOf(tag, close - tag.length);
  if (open === -1 || text.slice(open) !== tag + source + tag) return null;
  return { header: text.slice(0, open), tag };
}

/**
 * Why the form can't edit this function's body, or null when it can. The reason is shown as is,
 * so it reads as a label: "built in", "from extension moddatetime".
 */
export function bodyEditBlocker(fn: FunctionCatalog): string | null {
  if (fn.schema === "pg_catalog" || fn.language === "internal") return "built in";
  if (fn.extension !== null) return `from extension ${fn.extension}`;
  if (fn.language === "c") return "written in C";
  if (!splitFunctionDefinition(fn.definition, fn.source)) return "only editable as SQL";
  return null;
}
