import type { DatabaseSchema, Table, Trigger } from "@perch/protocol";
import { CodeIcon, InfoIcon, PencilIcon, PowerIcon, Trash2Icon, ZapIcon } from "lucide-react";
import type * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { highlightSql } from "../sql-editor/highlight-sql";
import { TriggerStateBadge } from "./trigger-card";
import { ChangeFailed, ChangeFlash } from "./trigger-feedback";
import { TriggerDrop } from "./trigger-drop";
import { TriggerFunction } from "./trigger-function";
import { callWord, firesWord, stateWord } from "./trigger-labels";
import { detailEditorScript, editorOnlyReason, relationKind, toggleBlocker } from "./trigger-sql";
import { useFunctionCatalog } from "./use-function-catalog";
import type { TriggerDrawerApi } from "./use-trigger-drawer";

type Fact = { label: string; value: React.ReactNode; mono?: boolean; wide?: boolean };

function factsOf(trigger: Trigger, table: Table): Fact[] {
  const facts: Fact[] = [
    { label: "Fires", value: firesWord(trigger) },
    { label: "For", value: trigger.level === "row" ? "each row" : "each statement" },
    {
      label: "Only if",
      value: trigger.condition ?? "always",
      mono: trigger.condition !== null,
      wide: true,
    },
    { label: "Calls", value: callWord(trigger, table.schema), mono: true, wide: true },
    { label: "State", value: stateWord(trigger.state) },
  ];
  if (trigger.constraint) {
    facts.push({
      label: "Constraint trigger",
      value: trigger.initiallyDeferred
        ? "deferred, runs at COMMIT"
        : "runs at the end of the statement",
    });
  }
  if (trigger.transitionTables) {
    facts.push({ label: "Reads", value: "the statement's rows as transition tables" });
  }
  // The facts sit two to a row; a lone one at the end takes the whole row, so no cell is empty.
  const narrow = facts.filter((fact) => !fact.wide);
  if (narrow.length % 2 === 1) narrow.at(-1)!.wide = true;
  return facts;
}

function Note({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-muted-foreground text-xs">
      <InfoIcon className="mt-px size-3.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * One trigger: the facts, what can be done to it, the definition Postgres prints, the function it
 * calls and its comment. A trigger the form can't fully represent has no Edit; its way to change is
 * the editor, with the reason said, because saving it from the form would drop what isn't shown.
 */
export function TriggerDetail({
  drawer,
  onEdit,
  onOpenInEditor,
  qualify,
  schema,
  table,
  trigger,
}: {
  drawer: TriggerDrawerApi;
  onEdit: () => void;
  onOpenInEditor: (sql: string) => void;
  /** Name the schema too, because the view is showing more than one. */
  qualify: boolean;
  schema: DatabaseSchema;
  table: Table;
  trigger: Trigger;
}): React.ReactElement {
  const catalog = useFunctionCatalog(trigger.function) ?? { status: "loading" };
  const { pending } = drawer;
  const isView = relationKind(table) === "view";
  const cantToggle = toggleBlocker(table, trigger);
  const editorOnly = editorOnlyReason(trigger, schema.serverVersionNum);
  const flash =
    drawer.flash?.at &&
    drawer.flash.at.schema === table.schema &&
    drawer.flash.at.table === table.name &&
    drawer.flash.at.name === trigger.name
      ? drawer.flash.text
      : null;

  const openInEditor = (): void =>
    onOpenInEditor(
      detailEditorScript(
        table,
        trigger,
        schema.serverVersionNum,
        catalog.status === "found" ? catalog.fn : null,
      ),
    );

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex flex-col gap-5 p-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ZapIcon
              className={cn(
                "size-4 shrink-0",
                trigger.state === "disabled" ? "text-muted-foreground" : "text-warning-foreground",
              )}
            />
            <h3 className="min-w-0 break-all font-mono font-semibold text-base">{trigger.name}</h3>
            <TriggerStateBadge state={trigger.state} />
            {flash && <ChangeFlash text={flash} />}
          </div>
          <p className="mt-1 text-muted-foreground text-sm">
            on{" "}
            <span className="font-mono text-foreground">
              {qualify ? `${table.schema}.${table.name}` : table.name}
            </span>
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border">
            {factsOf(trigger, table).map((fact) => (
              <div
                className={cn(
                  "flex min-w-0 flex-col gap-0.5 bg-popover px-3 py-2",
                  fact.wide && "col-span-2",
                )}
                key={fact.label}
              >
                <dt className="text-muted-foreground text-xs">{fact.label}</dt>
                <dd className={cn("break-words text-sm", fact.mono && "font-mono text-xs")}>
                  {fact.value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {cantToggle === null && (
              <Button
                disabled={pending}
                loading={pending && !drawer.dropArmed}
                onClick={() => drawer.toggle(table, trigger)}
                size="sm"
                variant="outline"
              >
                <PowerIcon />
                {trigger.state === "disabled" ? "Turn on" : "Turn off"}
              </Button>
            )}
            {editorOnly === null && (
              <Button disabled={pending} onClick={onEdit} size="sm" variant="outline">
                <PencilIcon />
                Edit
              </Button>
            )}
            <Button
              disabled={pending || catalog.status === "loading"}
              onClick={openInEditor}
              size="sm"
              variant={editorOnly === null ? "ghost" : "outline"}
            >
              <CodeIcon />
              Open in editor
            </Button>
            <div className="flex-1" />
            {!drawer.dropArmed && (
              <Button
                disabled={pending}
                onClick={() => drawer.armDrop(true)}
                size="sm"
                variant="destructive-outline"
              >
                <Trash2Icon />
                Drop
              </Button>
            )}
          </div>
          {editorOnly !== null && <Note>{editorOnly}</Note>}
          {cantToggle !== null && !isView && <Note>{cantToggle}</Note>}

          {drawer.dropArmed && (
            <TriggerDrop
              alsoDropFunction={drawer.alsoDropFunction}
              onAlsoDropFunction={drawer.setAlsoDropFunction}
              onCancel={() => drawer.armDrop(false)}
              onDrop={() => drawer.drop(schema, table, trigger)}
              pending={pending}
              schema={schema}
              table={table}
              trigger={trigger}
            />
          )}
          {drawer.failure && (
            <div className="mt-3">
              <ChangeFailed error={drawer.failure} />
            </div>
          )}
        </div>

        <section className="flex flex-col gap-2">
          <h4 className="font-medium text-muted-foreground text-xs">Definition</h4>
          <pre className="whitespace-pre-wrap break-words rounded-md bg-muted p-2.5 font-mono text-xs leading-5">
            {highlightSql(trigger.definition)}
          </pre>
        </section>

        <TriggerFunction
          catalog={catalog}
          schema={schema}
          tableSchema={table.schema}
          trigger={trigger}
        />

        {trigger.comment !== null && (
          <section className="flex flex-col gap-2">
            <h4 className="font-medium text-muted-foreground text-xs">Comment</h4>
            <p className="whitespace-pre-wrap text-sm">{trigger.comment}</p>
          </section>
        )}
      </div>
    </div>
  );
}
