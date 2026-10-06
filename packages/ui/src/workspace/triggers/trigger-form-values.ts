// What the trigger form holds, and how that becomes a draft and a script. The form keeps only what
// the user chose. Everything a choice forces is worked out here on every render: the level TRUNCATE
// needs, the columns only an UPDATE takes, the name that follows the function until someone types
// one, the body that follows the timing until someone edits it. So the form can't hold a
// combination Postgres would refuse, and changing one choice never leaves another stale.

import type {
  DatabaseSchema,
  Table,
  Trigger,
  TriggerFunctionRef,
  TriggerLevel,
  TriggerOperation,
  TriggerTiming,
} from "@perch/protocol";
import type { TriggerPreset } from "./lane-playback";
import { tableKey } from "./table-rail";
import type { FunctionCatalog } from "./trigger-catalog";
import {
  allowedLevels,
  allowedOperations,
  allowedTimings,
  allowsCondition,
  allowsUpdateColumns,
  createTriggerScript,
  defaultFunctionBody,
  defaultFunctionName,
  defaultTriggerName,
  draftDefinition,
  editTriggerScript,
  newFunctionProblems,
  relationKind,
  type BodyRewrite,
  type RelationKind,
  type TriggerDraft,
  type TriggerScript,
} from "./trigger-sql";

export type FunctionMode = "new" | "existing";

export type FormValues = {
  /** `schema.table`. Fixed when editing. */
  readonly table: string;
  /** Null while it follows the function's name, until someone types one. */
  readonly name: string | null;
  readonly timing: TriggerTiming;
  readonly level: TriggerLevel;
  /** In Postgres's order: insert, update, delete, truncate. */
  readonly operations: readonly TriggerOperation[];
  /** UPDATE OF columns, in the table's column order. */
  readonly columns: readonly string[];
  readonly condition: string;
  readonly functionMode: FunctionMode;
  /** The new function's name; null while it follows the table, timing and event. */
  readonly newName: string | null;
  /** The new function's body; null while it is the default for the timing and level. */
  readonly newBody: string | null;
  /** The existing function to call. Kept when switching to a new one and back. */
  readonly existing: TriggerFunctionRef | null;
  /** "Edit its body": the existing function's new body; null leaves it as it is. */
  readonly rewrite: string | null;
};

export const OPERATIONS: readonly TriggerOperation[] = ["insert", "update", "delete", "truncate"];

/**
 * A new trigger at a preset: an Add slot's timing and level, or for New trigger only the event
 * the lane is showing, with whatever timing the relation starts on.
 */
export function createValues(
  table: Table,
  preset: Pick<TriggerPreset, "operation"> & Partial<Pick<TriggerPreset, "timing" | "level">>,
): FormValues {
  const kind = relationKind(table) ?? "table";
  const timing = preset.timing ?? (kind === "view" ? "instead_of" : "before");
  const operation = allowedOperations(kind, timing).includes(preset.operation)
    ? preset.operation
    : "insert";
  return {
    table: tableKey(table),
    name: null,
    timing,
    level: preset.level ?? "row",
    operations: [operation],
    columns: [],
    condition: "",
    functionMode: "new",
    newName: null,
    newBody: null,
    existing: null,
    rewrite: null,
  };
}

export function editValues(table: Table, trigger: Trigger): FormValues {
  return {
    table: tableKey(table),
    name: trigger.name,
    timing: trigger.timing,
    level: trigger.level,
    operations: trigger.operations,
    columns: trigger.columns,
    condition: trigger.condition ?? "",
    functionMode: "existing",
    newName: null,
    newBody: null,
    existing: trigger.function,
    rewrite: null,
  };
}

/** Whether the form still holds what it opened with: the test for asking before discarding. */
export function sameValues(a: FormValues, b: FormValues): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The values as they apply to one relation: what's allowed there, and the draft they come to. */
export type ResolvedForm = {
  readonly kind: RelationKind;
  readonly timings: readonly TriggerTiming[];
  readonly operations: readonly TriggerOperation[];
  readonly levels: readonly TriggerLevel[];
  /** Update is picked and the timing takes UPDATE OF. */
  readonly columnsApply: boolean;
  readonly conditionApplies: boolean;
  readonly draft: TriggerDraft;
  /** The new function's name and body, whether or not the form is writing a new one. */
  readonly newName: string;
  readonly newBody: string;
};

export function resolveForm(values: FormValues, table: Table): ResolvedForm {
  const kind = relationKind(table) ?? "table";
  const timings = allowedTimings(kind);
  const timing = timings.includes(values.timing)
    ? values.timing
    : kind === "view"
      ? "instead_of"
      : "before";
  const allowed = allowedOperations(kind, timing);
  const operations = values.operations.filter((operation) => allowed.includes(operation));
  const levels = allowedLevels(kind, timing, operations);
  const level = levels.includes(values.level) ? values.level : (levels[0] ?? "statement");
  const columnsApply = operations.includes("update") && allowsUpdateColumns(timing);
  const columns = columnsApply
    ? values.columns.filter((column) => table.columns.some((c) => c.name === column))
    : [];
  const conditionApplies = allowsCondition(timing);
  const condition =
    conditionApplies && values.condition.trim() !== "" ? values.condition.trim() : null;

  const newName = values.newName ?? defaultFunctionName(table.name, timing, operations);
  const newBody = values.newBody ?? defaultFunctionBody(timing, level, operations);
  const fn: TriggerFunctionRef =
    values.functionMode === "new"
      ? { schema: table.schema, name: newName }
      : (values.existing ?? { schema: table.schema, name: "" });
  const name = values.name ?? defaultTriggerName(table.name, fn.name || newName);

  return {
    kind,
    timings,
    operations: allowed,
    levels,
    columnsApply,
    conditionApplies,
    draft: { name, timing, level, operations, columns, condition, function: fn },
    newName,
    newBody,
  };
}

export type FormContext = {
  readonly schema: DatabaseSchema;
  readonly table: Table;
  /** The trigger being edited, as it was when the form opened; undefined when creating one. */
  readonly original?: Trigger;
  /** The existing function's catalog row, which a rewritten body is spliced into. */
  readonly catalog: FunctionCatalog | null;
};

/** The one script the form would run, which is also exactly what Open in editor hands over. */
export function formScript(
  values: FormValues,
  resolved: ResolvedForm,
  context: FormContext,
): TriggerScript {
  const { schema, table, original, catalog } = context;
  const writesNew = values.functionMode === "new";
  let rewrite: BodyRewrite | null = null;
  if (!writesNew && values.rewrite !== null) {
    if (!catalog) {
      return {
        kind: "invalid",
        problems: [{ field: "function", message: "Still reading the function's body." }],
      };
    }
    rewrite = { fn: catalog, next: values.rewrite };
  }
  const newFunctionBody = writesNew ? resolved.newBody : null;
  const script = original
    ? editTriggerScript({
        table,
        trigger: original,
        draft: resolved.draft,
        serverVersionNum: schema.serverVersionNum,
        body: rewrite,
        newFunctionBody,
      })
    : createTriggerScript(table, resolved.draft, newFunctionBody, rewrite);
  const clash = writesNew ? newFunctionProblems(schema, table, resolved.newName) : [];
  if (clash.length === 0 || script.kind === "editor-only") return script;
  return {
    kind: "invalid",
    problems: [...(script.kind === "invalid" ? script.problems : []), ...clash],
  };
}

/**
 * The trigger as it was just submitted, for the drawer to show until the schema that has it
 * arrives: a refresh that lands late, or fails, must never read as "that trigger is gone".
 */
export function submittedTrigger(
  table: Table,
  draft: TriggerDraft,
  original: Trigger | undefined,
): Trigger {
  return {
    name: draft.name,
    timing: draft.timing,
    operations: OPERATIONS.filter((operation) => draft.operations.includes(operation)),
    columns: [...draft.columns],
    level: draft.level,
    condition: draft.condition,
    function: draft.function,
    arguments: [],
    state: original?.state ?? "enabled",
    constraint: false,
    initiallyDeferred: false,
    transitionTables: false,
    comment: original?.comment ?? null,
    definition: draftDefinition(table, draft),
  };
}
