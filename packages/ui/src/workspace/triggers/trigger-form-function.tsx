import type {
  DatabaseSchema,
  Table,
  Trigger,
  TriggerFunctionRef,
  TriggerLevel,
  TriggerOperation,
  TriggerTiming,
} from "@perch/protocol";
import { PencilIcon, Undo2Icon } from "lucide-react";
import type * as React from "react";
import { plural } from "../../lib/format";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Tabs, TabsList, TabsTab } from "../../ui/tabs";
import { SqlEditor } from "../sql-editor";
import { bodyEditBlocker } from "./trigger-catalog";
import type { FormValues, FunctionMode, ResolvedForm } from "./trigger-form-values";
import { FieldProblems, FormHint } from "./trigger-form-parts";
import { functionUsers, type DraftProblem } from "./trigger-sql";
import type { FunctionCatalogState } from "./use-function-catalog";

/**
 * The body editor never runs anything: without this, Mod-Enter in it would run the workspace's
 * query, the default target of an editor's run key.
 */
const RUN_NOTHING = (): void => {};

const refKey = (ref: TriggerFunctionRef): string => JSON.stringify([ref.schema, ref.name]);

function refOf(key: string): TriggerFunctionRef {
  const [schema, name] = JSON.parse(key) as [string, string];
  return { schema, name };
}

/**
 * What Postgres does with what the function returns: the one thing a new body has to get right.
 */
function returnHint(
  timing: TriggerTiming,
  level: TriggerLevel,
  operations: readonly TriggerOperation[],
): string {
  if (level === "statement" || timing === "after") {
    return "Postgres ignores what this trigger returns, so RETURN NULL is fine.";
  }
  if (timing === "instead_of") {
    return "Return NEW (OLD for a delete) to count the row as handled, or NULL to skip it.";
  }
  if (operations.length > 0 && operations.every((operation) => operation === "delete")) {
    return "Return OLD to let the delete go ahead, or NULL to skip the row.";
  }
  return "Return NEW to write the row, a changed NEW to change it, or NULL to skip it.";
}

/**
 * A cell-style editor grows with its text and never scrolls itself, so a long line would run out of
 * the drawer. The frame scrolls sideways instead.
 */
function BodyEditor({
  onChange,
  value,
}: {
  onChange: (value: string) => void;
  value: string;
}): React.ReactElement {
  return (
    <div className="w-full overflow-x-auto rounded-md border">
      <SqlEditor minimal onChange={onChange} onRunStatement={RUN_NOTHING} value={value} />
    </div>
  );
}

/**
 * The function the trigger calls: a new plpgsql one written here, or one that exists. An existing
 * function's body can be edited in place when it is the user's own and its definition splits
 * cleanly; every other attribute of the function is kept as it is.
 */
export function FormFunction({
  catalog,
  disabled,
  onChange,
  original,
  problems,
  resolved,
  schema,
  table,
  values,
}: {
  /** The catalog row of `values.existing`, or null while writing a new function. */
  catalog: FunctionCatalogState | null;
  disabled: boolean;
  onChange: (values: FormValues) => void;
  original: Trigger | null;
  problems: readonly DraftProblem[];
  resolved: ResolvedForm;
  schema: DatabaseSchema;
  table: Table;
  values: FormValues;
}): React.ReactElement {
  const options: TriggerFunctionRef[] = [...schema.triggerFunctions].sort(
    (a, b) => a.schema.localeCompare(b.schema) || a.name.localeCompare(b.name),
  );
  if (original && !options.some((fn) => refKey(fn) === refKey(original.function))) {
    options.unshift(original.function);
  }
  const label = (ref: TriggerFunctionRef): string =>
    `${ref.schema === table.schema ? ref.name : `${ref.schema}.${ref.name}`}()`;
  const usedBy = (ref: TriggerFunctionRef): number => functionUsers(schema, ref).length;

  const existing = values.existing;
  const others = existing
    ? functionUsers(schema, existing).filter((user) => user.trigger !== original).length
    : 0;
  const { timing, level, operations } = resolved.draft;

  const existingBody = (): React.ReactNode => {
    if (!existing || !catalog) return null;
    switch (catalog.status) {
      case "loading":
        return <p className="text-muted-foreground text-xs">Reading its body…</p>;
      case "missing":
        return <FormHint warn>{label(existing)} no longer exists.</FormHint>;
      case "error":
        return (
          <FormHint warn>
            Couldn&rsquo;t read {label(existing)}: {catalog.message}
          </FormHint>
        );
      case "found": {
        const blocker = bodyEditBlocker(catalog.fn);
        if (blocker) {
          return (
            <FormHint>
              {label(existing)} is {blocker}, so its body stays as it is.
            </FormHint>
          );
        }
        const rewriting = values.rewrite !== null;
        return (
          <>
            <Button
              disabled={disabled}
              onClick={() => onChange({ ...values, rewrite: rewriting ? null : catalog.fn.source })}
              size="xs"
              variant="link"
            >
              {rewriting ? <Undo2Icon /> : <PencilIcon />}
              {rewriting ? "Leave the body as it is" : "Edit its body"}
            </Button>
            {values.rewrite !== null && (
              <>
                <BodyEditor
                  onChange={(rewrite) => onChange({ ...values, rewrite })}
                  value={values.rewrite}
                />
                {others > 0 && (
                  <FormHint warn>
                    {plural(others, "other trigger")} {others === 1 ? "uses" : "use"}{" "}
                    {label(existing)}. Changing the body changes {others === 1 ? "it" : "them"} too.
                  </FormHint>
                )}
              </>
            )}
          </>
        );
      }
    }
  };

  return (
    <>
      <Tabs
        onValueChange={(mode) => onChange({ ...values, functionMode: mode as FunctionMode })}
        value={values.functionMode}
      >
        <TabsList aria-label="Function" size="sm">
          <TabsTab disabled={disabled} value="new">
            Write new
          </TabsTab>
          <TabsTab disabled={disabled || options.length === 0} value="existing">
            Use existing
          </TabsTab>
        </TabsList>
      </Tabs>

      {values.functionMode === "new" ? (
        <>
          <div className="w-full font-mono">
            <Input
              aria-label="Function name"
              autoComplete="off"
              disabled={disabled}
              onChange={(event) => onChange({ ...values, newName: event.target.value })}
              size="sm"
              spellCheck={false}
              value={resolved.newName}
            />
          </div>
          <FieldProblems field="function" problems={problems} />
          <BodyEditor
            onChange={(newBody) => onChange({ ...values, newBody })}
            value={resolved.newBody}
          />
          <FormHint>{returnHint(timing, level, operations)}</FormHint>
        </>
      ) : (
        <>
          <Select
            disabled={disabled}
            onValueChange={(key) =>
              onChange({ ...values, existing: refOf(String(key)), rewrite: null })
            }
            value={existing ? refKey(existing) : null}
          >
            <SelectTrigger aria-label="Existing function" size="sm">
              <SelectValue placeholder="Pick a function">
                {(key: unknown) =>
                  typeof key === "string" ? (
                    <span className="truncate font-mono text-xs">{label(refOf(key))}</span>
                  ) : (
                    "Pick a function"
                  )
                }
              </SelectValue>
            </SelectTrigger>
            <SelectPopup>
              {options.map((ref) => (
                <SelectItem key={refKey(ref)} value={refKey(ref)}>
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-mono text-xs">{label(ref)}</span>
                    <span className="shrink-0 text-muted-foreground text-xs">
                      used by {usedBy(ref)}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
          <FieldProblems field="function" problems={problems} />
          {existingBody()}
        </>
      )}
    </>
  );
}
