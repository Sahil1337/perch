// The SQL the Triggers view writes on the user's behalf, and the rules its form enforces before
// writing any. Pure: everything here takes what the schema payload (and, for a function body, the
// lazily read catalog row) says and returns text. `execute()` runs what comes out unchanged.
//
// Every script is one transaction with a lock timeout, and this file is the only thing that wraps.
// Half a change (the function created, the trigger not) is worse than none. And DDL waiting for its
// lock on a busy table makes every later reader or writer of that table queue behind it, so a
// short `lock_timeout` turns "the app froze" into "the table is busy, nothing changed".
//
// Names are always schema-qualified and always go through `quoteIdent`. Postgres only.

import type {
  DatabaseSchema,
  QueryError,
  Table,
  Trigger,
  TriggerFunctionRef,
  TriggerLevel,
  TriggerOperation,
  TriggerState,
  TriggerTiming,
} from "@perch/protocol";
import { qualified, quoteIdent, quoteLiteral, splitStatements } from "@perch/sql";
import { hasOwnSource, splitFunctionDefinition, type FunctionCatalog } from "./trigger-catalog";

/** A guess, and the one place to tune it. */
export const LOCK_TIMEOUT = "3s";

/** Postgres truncates a longer name without a word, so the form refuses one instead. */
export const MAX_NAME_BYTES = 63;

/** `CREATE OR REPLACE TRIGGER` arrived in Postgres 14; before it every edit is a drop and create. */
const REPLACE_TRIGGER_SINCE = 140000;

export const BUSY_MESSAGE = "The table is busy. Nothing was changed.";

/**
 * What the form edits: a trigger minus what the form doesn't model (arguments, transition tables,
 * constraint triggers), which is why a trigger with any of those never reaches it.
 */
export type TriggerDraft = {
  name: string;
  timing: TriggerTiming;
  level: TriggerLevel;
  operations: readonly TriggerOperation[];
  /** UPDATE OF columns, in the order they should be declared. */
  columns: readonly string[];
  /** The WHEN condition without its outer parentheses; null or blank for none. */
  condition: string | null;
  function: TriggerFunctionRef;
};

export type DraftField =
  "table" | "name" | "timing" | "level" | "operations" | "columns" | "condition" | "function";

export type DraftProblem = { readonly field: DraftField; readonly message: string };

export type TriggerScript =
  | { readonly kind: "sql"; readonly sql: string }
  /** The draft matches the trigger as it is; there is nothing to run. */
  | { readonly kind: "unchanged" }
  /** The draft breaks a rule; nothing should run until it's fixed. */
  | { readonly kind: "invalid"; readonly problems: readonly DraftProblem[] }
  /** The view won't write this change; the detail script in the editor is the way to make it. */
  | { readonly kind: "editor-only"; readonly reason: string };

/** What a trigger hangs off: a view, or anything that behaves like a table (partitioned, foreign). */
export type RelationKind = "table" | "view";

const OPERATIONS: readonly TriggerOperation[] = ["insert", "update", "delete", "truncate"];

const ident = (name: string): string => quoteIdent(name, "postgres");
const relation = (table: Table): string => qualified(table.schema, table.name, "postgres");
const routine = (ref: TriggerFunctionRef): string =>
  `${qualified(ref.schema, ref.name, "postgres")}()`;
const literal = (value: string): string => quoteLiteral(value, "postgres");
/** How a script's header names the relation: for reading, not for running. */
const where = (table: Table): string => `${table.schema}.${table.name}`;

/** A name typed by a user can hold a newline, which would end a `--` comment early. */
const commentText = (text: string): string => text.replace(/[\r\n]+/g, " ");

/** Null for a materialized view, which can't have triggers. */
export function relationKind(table: Table): RelationKind | null {
  if (table.kind === "view") return "view";
  return table.kind === "table" ? "table" : null;
}

export function allowedTimings(kind: RelationKind): TriggerTiming[] {
  return kind === "view" ? ["before", "after", "instead_of"] : ["before", "after"];
}

/** TRUNCATE never reaches a view, and INSTEAD OF only stands in for row writes. */
export function allowedOperations(kind: RelationKind, timing: TriggerTiming): TriggerOperation[] {
  return kind === "view" || timing === "instead_of"
    ? ["insert", "update", "delete"]
    : [...OPERATIONS];
}

/**
 * INSTEAD OF is always per row. On a view BEFORE and AFTER are always per statement: the rows a
 * view "writes" aren't rows of the view. TRUNCATE has no rows, so it is per statement too.
 */
export function allowedLevels(
  kind: RelationKind,
  timing: TriggerTiming,
  operations: readonly TriggerOperation[],
): TriggerLevel[] {
  if (timing === "instead_of") return ["row"];
  if (kind === "view" || operations.includes("truncate")) return ["statement"];
  return ["row", "statement"];
}

/** Statement triggers can have a WHEN (Postgres checks it); INSTEAD OF triggers can't. */
export function allowsCondition(timing: TriggerTiming): boolean {
  return timing !== "instead_of";
}

export function allowsUpdateColumns(timing: TriggerTiming): boolean {
  return timing !== "instead_of";
}

/** The hint under the WHEN field, when there is one to give. */
export function conditionHint(level: TriggerLevel): string | null {
  return level === "statement"
    ? "A statement trigger's condition can't reference NEW or OLD."
    : null;
}

export function nameBytes(name: string): number {
  return new TextEncoder().encode(name).length;
}

/**
 * Why a trigger opens read-only, with Edit replaced by Open in editor; null when the form can edit
 * it. The form never saves a trigger it can't fully represent, because saving would drop what it
 * doesn't show.
 */
export function editorOnlyReason(trigger: Trigger, serverVersionNum: number | null): string | null {
  if (trigger.constraint)
    return "Constraint triggers can't be replaced in place, so they're edited as SQL.";
  if (trigger.transitionTables)
    return "The form doesn't cover transition tables (REFERENCING), so this trigger is edited as SQL.";
  if (trigger.arguments.length > 0)
    return "The form doesn't cover trigger arguments, so this trigger is edited as SQL.";
  if (serverVersionNum === null || serverVersionNum < REPLACE_TRIGGER_SINCE) {
    return "Editing a trigger in place needs Postgres 14 or later, so on this server it's edited as SQL.";
  }
  return null;
}

export function editableInForm(trigger: Trigger, serverVersionNum: number | null): boolean {
  return editorOnlyReason(trigger, serverVersionNum) === null;
}

export function draftFromTrigger(trigger: Trigger): TriggerDraft {
  return {
    name: trigger.name,
    timing: trigger.timing,
    level: trigger.level,
    operations: trigger.operations,
    columns: trigger.columns,
    condition: trigger.condition,
    function: trigger.function,
  };
}

function truncateBytes(name: string, max: number): string {
  let out = "";
  for (const ch of name) {
    if (nameBytes(out + ch) > max) break;
    out += ch;
  }
  return out;
}

/** `<table>_<function>`, without doubling the table when the function already starts with it. */
export function defaultTriggerName(tableName: string, functionName: string): string {
  const name = functionName.startsWith(`${tableName}_`)
    ? functionName
    : `${tableName}_${functionName}`;
  return truncateBytes(name, MAX_NAME_BYTES);
}

/** `<table>_<timing>_<first operation>`, e.g. `orders_before_update`. */
export function defaultFunctionName(
  tableName: string,
  timing: TriggerTiming,
  operations: readonly TriggerOperation[],
): string {
  const first = OPERATIONS.find((op) => operations.includes(op)) ?? "insert";
  return truncateBytes(`${tableName}_${timing}_${first}`, MAX_NAME_BYTES);
}

/**
 * A plpgsql body that does nothing, returning what the trigger's timing needs. Only a row trigger
 * that can change the write (BEFORE, INSTEAD OF) reads the return value: NULL there silently skips
 * the row, so it returns the row it was given. Everything else returns NULL, which is ignored.
 */
export function defaultFunctionBody(
  timing: TriggerTiming,
  level: TriggerLevel,
  operations: readonly TriggerOperation[],
): string {
  if (timing === "after" || level === "statement") return "BEGIN\n  RETURN NULL;\nEND;";
  if (!operations.includes("delete")) return "BEGIN\n  RETURN NEW;\nEND;";
  if (operations.every((op) => op === "delete")) return "BEGIN\n  RETURN OLD;\nEND;";
  return "BEGIN\n  IF TG_OP = 'DELETE' THEN\n    RETURN OLD;\n  END IF;\n  RETURN NEW;\nEND;";
}

/**
 * The rules the form enforces before anything runs. `original` is the trigger being edited, so
 * its own name doesn't count as taken.
 */
export function draftProblems(
  table: Table,
  draft: TriggerDraft,
  original?: Trigger,
): DraftProblem[] {
  const kind = relationKind(table);
  if (!kind) return [{ field: "table", message: "Materialized views can't have triggers." }];
  const problems: DraftProblem[] = [];
  const add = (field: DraftField, message: string): void => {
    problems.push({ field, message });
  };

  const name = draft.name;
  if (name.trim() === "") add("name", "Give the trigger a name.");
  else if (nameBytes(name) > MAX_NAME_BYTES) {
    add(
      "name",
      `Postgres keeps only the first ${MAX_NAME_BYTES} bytes of a name; this one is ${nameBytes(name)}.`,
    );
  } else if (name !== original?.name && table.triggers.some((t) => t.name === name)) {
    add("name", `${table.name} already has a trigger called ${name}.`);
  }

  if (!allowedTimings(kind).includes(draft.timing)) {
    add("timing", "INSTEAD OF triggers are for views; a table can use BEFORE or AFTER.");
  }

  const allowedOps = allowedOperations(kind, draft.timing);
  if (draft.operations.length === 0) add("operations", "Pick at least one event.");
  else if (draft.operations.some((op) => !allowedOps.includes(op))) {
    add(
      "operations",
      kind === "view"
        ? "TRUNCATE can't fire a trigger on a view."
        : "INSTEAD OF triggers can't fire on TRUNCATE.",
    );
  }

  if (!allowedLevels(kind, draft.timing, draft.operations).includes(draft.level)) {
    add(
      "level",
      draft.timing === "instead_of"
        ? "INSTEAD OF triggers run for each row."
        : kind === "view"
          ? "On a view, BEFORE and AFTER triggers run once per statement."
          : "TRUNCATE triggers run once per statement.",
    );
  }

  if (draft.columns.length > 0) {
    const missing = draft.columns.find((column) => !table.columns.some((c) => c.name === column));
    if (!allowsUpdateColumns(draft.timing))
      add("columns", "INSTEAD OF triggers can't be limited to columns.");
    else if (!draft.operations.includes("update"))
      add("columns", "Columns only apply to the Update event.");
    else if (missing !== undefined) add("columns", `${table.name} has no column ${missing}.`);
  }

  if ((draft.condition ?? "").trim() !== "" && !allowsCondition(draft.timing)) {
    add("condition", "INSTEAD OF triggers can't have a condition.");
  }

  if (draft.function.name.trim() === "") add("function", "Pick a function, or name a new one.");
  return problems;
}

/**
 * `$$`, or `$body$`, `$body1$`, … when the body holds the tag. The tag must first appear exactly
 * where the closing one starts: a body ending in `$` would otherwise close `$$` one character early.
 */
export function dollarTag(body: string): string {
  const fits = (tag: string): boolean => (body + tag).indexOf(tag) === body.length;
  if (fits("$$")) return "$$";
  if (fits("$body$")) return "$body$";
  for (let n = 1; ; n++) {
    if (fits(`$body${n}$`)) return `$body${n}$`;
  }
}

/**
 * The one transaction every script runs in. `header` lines become `--` comments above it: History
 * lists a run by its first line, and every script's first statement is BEGIN.
 */
export function wrapScript(statements: readonly string[], header: readonly string[] = []): string {
  const comments = header.map((line) => `-- ${commentText(line)}\n`).join("");
  return `${comments}BEGIN;\nSET LOCAL lock_timeout = '${LOCK_TIMEOUT}';\n\n${statements.join("\n\n")}\n\nCOMMIT;`;
}

function triggerStatement(
  table: Table,
  draft: TriggerDraft,
  fn: TriggerFunctionRef,
  replace: boolean,
): string {
  const events = OPERATIONS.filter((op) => draft.operations.includes(op))
    .map((op) =>
      op === "update" && draft.columns.length > 0
        ? `UPDATE OF ${draft.columns.map(ident).join(", ")}`
        : op.toUpperCase(),
    )
    .join(" OR ");
  const timing = draft.timing === "instead_of" ? "INSTEAD OF" : draft.timing.toUpperCase();
  const condition = (draft.condition ?? "").trim();
  return [
    `CREATE ${replace ? "OR REPLACE " : ""}TRIGGER ${ident(draft.name)}`,
    `  ${timing} ${events} ON ${relation(table)}`,
    `  FOR EACH ${draft.level.toUpperCase()}`,
    ...(condition ? [`  WHEN (${condition})`] : []),
    `  EXECUTE FUNCTION ${routine(fn)};`,
  ].join("\n");
}

/**
 * Replacing or recreating a trigger switches it back on, so one that was off, or set to fire only
 * in replica mode or always, is put back the way it was. Views have no state to put back.
 */
function restoreState(table: Table, name: string, state: TriggerState): string[] {
  if (state === "enabled" || relationKind(table) !== "table") return [];
  const verb =
    state === "disabled" ? "DISABLE" : state === "replica" ? "ENABLE REPLICA" : "ENABLE ALWAYS";
  const was =
    state === "disabled"
      ? "It was off"
      : `It fired ${state === "replica" ? "only in replica mode" : "always"}`;
  return [
    `-- A replaced or recreated trigger starts out on. ${was}, so:\nALTER TABLE ${relation(table)} ${verb} TRIGGER ${ident(name)};`,
  ];
}

/** A new plpgsql trigger function, in the table's schema. */
function createFunctionStatement(table: Table, name: string, body: string): string {
  const text = (body.startsWith("\n") ? "" : "\n") + body + (body.endsWith("\n") ? "" : "\n");
  const tag = dollarTag(text);
  return `CREATE FUNCTION ${routine({ schema: table.schema, name })}\n  RETURNS trigger\n  LANGUAGE plpgsql\nAS ${tag}${text}${tag};`;
}

/** A new body for an existing function: `next` goes between the dollar quotes, verbatim. */
export type BodyRewrite = { readonly fn: FunctionCatalog; readonly next: string };

/** The splice for a rewritten body, nothing when the body is as it was, or why it can't be done. */
function rewriteStatements(
  rewrite: BodyRewrite | null | undefined,
): string[] | { readonly reason: string } {
  if (!rewrite || rewrite.next === rewrite.fn.source) return [];
  const spliced = spliceFunctionBody(rewrite.fn, rewrite.next);
  return spliced === null
    ? {
        reason: `The body of ${rewrite.fn.name}() can't be rewritten safely here, so it's edited as SQL.`,
      }
    : [spliced];
}

/**
 * CREATE TRIGGER, after a new plpgsql function when `newFunctionBody` is given, or after an
 * existing function's body is rewritten when `rewrite` is. A new function is created in the
 * table's schema under `draft.function.name`, whatever `draft.function.schema` says.
 */
export function createTriggerScript(
  table: Table,
  draft: TriggerDraft,
  newFunctionBody: string | null,
  rewrite?: BodyRewrite | null,
): TriggerScript {
  const problems = draftProblems(table, draft);
  if (problems.length > 0) return { kind: "invalid", problems };
  const statements: string[] = [];
  let fn = draft.function;
  if (newFunctionBody !== null) {
    fn = { schema: table.schema, name: draft.function.name };
    statements.push(createFunctionStatement(table, fn.name, newFunctionBody));
  } else {
    const spliced = rewriteStatements(rewrite);
    if (!Array.isArray(spliced)) return { kind: "editor-only", reason: spliced.reason };
    statements.push(...spliced);
  }
  statements.push(triggerStatement(table, draft, fn, false));
  return {
    kind: "sql",
    sql: wrapScript(statements, [`Create trigger ${draft.name} on ${where(table)}`]),
  };
}

/**
 * The CREATE TRIGGER a draft comes to, without its semicolon, as `definition` holds it: what the
 * drawer shows for a trigger it has just written until the schema that has it arrives.
 */
export function draftDefinition(table: Table, draft: TriggerDraft): string {
  return triggerStatement(table, draft, draft.function, false).slice(0, -1);
}

/** The statements a script from here runs, not counting the three that make it a transaction. */
export function scriptStatementCount(sql: string): number {
  return Math.max(0, splitStatements(sql).length - 3);
}

/**
 * What stops a new function being created under `name`: CREATE FUNCTION refuses a name a
 * zero-argument function in the schema already has. Only trigger functions are in the payload, so
 * a clash with any other function still surfaces as Postgres's error.
 */
export function newFunctionProblems(
  schema: DatabaseSchema,
  table: Table,
  name: string,
): DraftProblem[] {
  if (name.trim() === "") return [];
  if (nameBytes(name) > MAX_NAME_BYTES) {
    return [
      {
        field: "function",
        message: `Postgres keeps only the first ${MAX_NAME_BYTES} bytes of a name; this one is ${nameBytes(name)}.`,
      },
    ];
  }
  return schema.triggerFunctions.some((fn) => fn.schema === table.schema && fn.name === name)
    ? [
        {
          field: "function",
          message: `${name}() already exists. Pick Use existing, or another name.`,
        },
      ]
    : [];
}

/**
 * The function with only its body replaced, or null when its definition can't be split safely.
 * `body` is used verbatim, exactly as `source` was: it is what goes between the dollar quotes.
 */
export function spliceFunctionBody(fn: FunctionCatalog, body: string): string | null {
  if (!hasOwnSource(fn)) return null;
  const split = splitFunctionDefinition(fn.definition, fn.source);
  if (!split) return null;
  const tag = dollarTag(body);
  return `${split.header}${tag}${body}${tag};`;
}

function sameList<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((item, i) => item === b[i]);
}

/** Whether anything CREATE OR REPLACE TRIGGER would change differs, name aside. */
function definitionChanged(trigger: Trigger, draft: TriggerDraft): boolean {
  return (
    draft.timing !== trigger.timing ||
    draft.level !== trigger.level ||
    !sameList(
      OPERATIONS.filter((op) => draft.operations.includes(op)),
      OPERATIONS.filter((op) => trigger.operations.includes(op)),
    ) ||
    !sameList(draft.columns, trigger.columns) ||
    (draft.condition ?? "").trim() !== (trigger.condition ?? "").trim() ||
    draft.function.schema !== trigger.function.schema ||
    draft.function.name !== trigger.function.name
  );
}

export type TriggerEdit = {
  table: Table;
  trigger: Trigger;
  draft: TriggerDraft;
  serverVersionNum: number | null;
  /** A new body for `fn`, which is usually the trigger's own function. Omit when unchanged. */
  body?: BodyRewrite | null;
  /**
   * The body of a new plpgsql function for the trigger to call instead, created in the table's
   * schema under `draft.function.name`. Omit to call an existing one.
   */
  newFunctionBody?: string | null;
};

/**
 * Only what changed, in order: a rename, the function created or its body spliced into its
 * definition, then the trigger replaced and its state put back. Nothing at all runs when nothing
 * changed.
 */
export function editTriggerScript(edit: TriggerEdit): TriggerScript {
  const { table, trigger, serverVersionNum, body, newFunctionBody } = edit;
  const blocked = editorOnlyReason(trigger, serverVersionNum);
  if (blocked) return { kind: "editor-only", reason: blocked };
  const draft: TriggerDraft =
    newFunctionBody === null || newFunctionBody === undefined
      ? edit.draft
      : { ...edit.draft, function: { schema: table.schema, name: edit.draft.function.name } };
  const problems = draftProblems(table, draft, trigger);
  if (problems.length > 0) return { kind: "invalid", problems };

  const statements: string[] = [];
  if (draft.name !== trigger.name) {
    statements.push(
      `ALTER TRIGGER ${ident(trigger.name)} ON ${relation(table)} RENAME TO ${ident(draft.name)};`,
    );
  }
  if (newFunctionBody !== null && newFunctionBody !== undefined) {
    statements.push(createFunctionStatement(table, draft.function.name, newFunctionBody));
  } else {
    const spliced = rewriteStatements(body);
    if (!Array.isArray(spliced)) return { kind: "editor-only", reason: spliced.reason };
    statements.push(...spliced);
  }
  if (definitionChanged(trigger, draft)) {
    statements.push(triggerStatement(table, draft, draft.function, true));
    statements.push(...restoreState(table, draft.name, trigger.state));
  }
  return statements.length === 0
    ? { kind: "unchanged" }
    : {
        kind: "sql",
        sql: wrapScript(statements, [`Change trigger ${trigger.name} on ${where(table)}`]),
      };
}

/**
 * Why the view can't switch this trigger on or off, or null when it can. Views can't disable
 * triggers at all, and a replica or always trigger has more than two states, so it's the editor's.
 */
export function toggleBlocker(table: Table, trigger: Trigger): string | null {
  if (relationKind(table) !== "table")
    return "Triggers on a view can't be switched off; drop it instead.";
  if (trigger.state === "replica")
    return "This trigger fires only in replica mode; change that as SQL.";
  if (trigger.state === "always")
    return "This trigger fires always, even in replica mode; change that as SQL.";
  return null;
}

/** Switches one trigger on or off. Never `ALL`, which would reach the foreign-key triggers too. */
export function toggleTriggerScript(table: Table, trigger: Trigger): TriggerScript {
  const blocked = toggleBlocker(table, trigger);
  if (blocked) return { kind: "editor-only", reason: blocked };
  const on = trigger.state === "disabled";
  return {
    kind: "sql",
    sql: wrapScript(
      [
        `ALTER TABLE ${relation(table)} ${on ? "ENABLE" : "DISABLE"} TRIGGER ${ident(trigger.name)};`,
      ],
      [`Turn ${on ? "on" : "off"} trigger ${trigger.name} on ${where(table)}`],
    ),
  };
}

const sameFunction = (a: TriggerFunctionRef, b: TriggerFunctionRef): boolean =>
  a.schema === b.schema && a.name === b.name;

/** Every trigger in the payload that calls `ref`: the "used by N" count. */
export function functionUsers(
  schema: DatabaseSchema,
  ref: TriggerFunctionRef,
): { table: Table; trigger: Trigger }[] {
  return schema.schemas.flatMap((s) =>
    s.tables.flatMap((table) =>
      table.triggers
        .filter((trigger) => sameFunction(trigger.function, ref))
        .map((trigger) => ({ table, trigger })),
    ),
  );
}

/**
 * Whether dropping `trigger` may also drop its function: the function is the user's own (not
 * built in, not from an extension) and no other trigger calls it. Without CASCADE, a caller this
 * payload can't see makes the DROP FUNCTION fail, and with it the whole transaction.
 */
export function canAlsoDropFunction(schema: DatabaseSchema, trigger: Trigger): boolean {
  const fn = schema.triggerFunctions.find((f) => sameFunction(f, trigger.function));
  if (!fn || fn.schema === "pg_catalog" || fn.extension !== null) return false;
  return functionUsers(schema, fn).every((user) => user.trigger === trigger);
}

/** DROP TRIGGER, and DROP FUNCTION too when asked and allowed. Never CASCADE. */
export function dropTriggerScript(
  schema: DatabaseSchema,
  table: Table,
  trigger: Trigger,
  alsoDropFunction: boolean,
): TriggerScript {
  if (alsoDropFunction && !canAlsoDropFunction(schema, trigger)) {
    return {
      kind: "invalid",
      problems: [
        { field: "function", message: `${trigger.function.name}() is still needed, so it stays.` },
      ],
    };
  }
  const statements = [`DROP TRIGGER ${ident(trigger.name)} ON ${relation(table)};`];
  if (alsoDropFunction) statements.push(`DROP FUNCTION ${routine(trigger.function)};`);
  const also = alsoDropFunction ? `, and its function ${trigger.function.name}()` : "";
  return {
    kind: "sql",
    sql: wrapScript(statements, [`Drop trigger ${trigger.name} on ${where(table)}${also}`]),
  };
}

/**
 * The trigger as SQL for the editor, from the drawer's detail: its function when the user wrote it
 * (`fn` is the lazily read catalog row, null while it loads or when it can't be read), the trigger
 * replaced in place where Postgres can (14+, not a constraint trigger) or dropped and recreated,
 * its state put back, and its comment. Run as it is, it changes nothing.
 *
 * The trigger is `pg_get_triggerdef` verbatim. It names the function without a schema when that
 * schema is on the search path, which holds for the run too: every run starts from `DISCARD ALL`.
 */
export function detailEditorScript(
  table: Table,
  trigger: Trigger,
  serverVersionNum: number | null,
  fn: FunctionCatalog | null,
): string {
  const statements: string[] = [];
  if (fn && hasOwnSource(fn)) {
    statements.push(
      `${fn.definition.endsWith("\n") ? fn.definition.slice(0, -1) : fn.definition};`,
    );
  }
  const inPlace =
    !trigger.constraint &&
    serverVersionNum !== null &&
    serverVersionNum >= REPLACE_TRIGGER_SINCE &&
    trigger.definition.startsWith("CREATE TRIGGER ");
  if (inPlace) {
    statements.push(
      `${trigger.definition.replace(/^CREATE TRIGGER /, "CREATE OR REPLACE TRIGGER ")};`,
    );
  } else {
    statements.push(
      `DROP TRIGGER ${ident(trigger.name)} ON ${relation(table)};\n${trigger.definition};`,
    );
  }
  statements.push(...restoreState(table, trigger.name, trigger.state));
  if (trigger.comment !== null) {
    statements.push(
      `COMMENT ON TRIGGER ${ident(trigger.name)} ON ${relation(table)} IS ${literal(trigger.comment)};`,
    );
  }
  return wrapScript(statements, [
    `${trigger.name} on ${table.schema}.${table.name}, as the database has it now.`,
    "Change what you need, then run the whole script. It runs as one transaction.",
  ]);
}

/** What the drawer shows for a failed script: a lock or statement timeout reads as "busy". */
export function scriptErrorMessage(error: QueryError): string {
  return error.code === "55P03" || error.code === "57014" ? BUSY_MESSAGE : error.message;
}
