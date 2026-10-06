import type {
  DatabaseSchema,
  Table,
  TriggerLevel,
  TriggerOperation,
  TriggerTiming,
} from "@perch/protocol";
import { CheckIcon, ChevronDownIcon, CodeIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Input } from "../../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../../ui/select";
import { Tabs, TabsList, TabsTab } from "../../ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "../../ui/toggle-group";
import { highlightSql } from "../sql-editor/highlight-sql";
import { tableKey } from "./table-rail";
import { ChangeFailed } from "./trigger-feedback";
import { FormFunction } from "./trigger-form-function";
import { FieldProblems, FormHint, FormRow } from "./trigger-form-parts";
import {
  formScript,
  OPERATIONS,
  resolveForm,
  type FormValues,
  type ResolvedForm,
} from "./trigger-form-values";
import { conditionHint, scriptStatementCount, type TriggerScript } from "./trigger-sql";
import { useFunctionCatalog } from "./use-function-catalog";
import { atOf, type DrawerFace, type TriggerDrawerApi } from "./use-trigger-drawer";

type FormFace = Extract<DrawerFace, { kind: "form" }>;

const TIMINGS: readonly { value: TriggerTiming; label: string }[] = [
  { value: "before", label: "Before" },
  { value: "after", label: "After" },
  { value: "instead_of", label: "Instead of" },
];

const LEVELS: readonly { value: TriggerLevel; label: string }[] = [
  { value: "row", label: "Each row" },
  { value: "statement", label: "Once per statement" },
];

const EVENT_LABEL: Record<TriggerOperation, string> = {
  insert: "Insert",
  update: "Update",
  delete: "Delete",
  truncate: "Truncate",
};

/** Why the level is forced, when it is: the same rules `draftProblems` states as errors. */
function forcedLevelWhy(resolved: ResolvedForm): string | null {
  if (resolved.levels.length !== 1) return null;
  if (resolved.draft.timing === "instead_of") return "INSTEAD OF triggers run for each row.";
  if (resolved.kind === "view") return "On a view, Before and After run once per statement.";
  return "TRUNCATE triggers run once per statement.";
}

function Preview({ script }: { script: TriggerScript }): React.ReactElement {
  switch (script.kind) {
    case "sql": {
      const count = scriptStatementCount(script.sql);
      return (
        <>
          <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted p-2.5 font-mono text-xs leading-5">
            {highlightSql(script.sql)}
          </pre>
          <FormHint>
            {count > 1
              ? `These ${count} statements run as one transaction. If any of them fails, nothing changes.`
              : "One statement."}
          </FormHint>
        </>
      );
    }
    case "unchanged":
      return (
        <p className="text-muted-foreground text-xs">
          Nothing to run: this is the trigger as it is.
        </p>
      );
    case "invalid":
      return (
        <p className="text-muted-foreground text-xs">
          Nothing to run until what&rsquo;s marked above is fixed.
        </p>
      );
    case "editor-only":
      return <FormHint warn>{script.reason}</FormHint>;
  }
}

/**
 * Creating or editing one trigger. It shows the SQL it will run as it is filled in, and runs
 * exactly that, in one transaction; "Open in editor" hands over the same text instead.
 */
export function TriggerForm({
  drawer,
  face,
  onOpenInEditor,
  qualify,
  schema,
  table,
  tables,
}: {
  drawer: TriggerDrawerApi;
  face: FormFace;
  onOpenInEditor: (sql: string) => void;
  qualify: boolean;
  schema: DatabaseSchema;
  table: Table;
  /** Where a new trigger can go. */
  tables: readonly Table[];
}): React.ReactElement {
  const { original, values } = face;
  const { pending } = drawer;
  const catalog = useFunctionCatalog(values.functionMode === "existing" ? values.existing : null);
  const resolved = resolveForm(values, table);
  const script = formScript(values, resolved, {
    schema,
    table,
    original: original ?? undefined,
    catalog: catalog?.status === "found" ? catalog.fn : null,
  });
  const problems = script.kind === "invalid" ? script.problems : [];
  const { draft } = resolved;
  const set = (next: FormValues): void => drawer.edit(next);
  const ids = React.useId();
  const tableLabel = (candidate: Table): string => (qualify ? tableKey(candidate) : candidate.name);
  const why = forcedLevelWhy(resolved);

  const cancel = (): void =>
    drawer.go({
      face: original ? { kind: "detail", at: atOf(table, original.name), submitted: null } : null,
    });

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-5 p-4">
          <div className="flex flex-col gap-4">
            <FormRow htmlFor={`${ids}-name`} label="Name">
              <div className="w-full font-mono">
                <Input
                  autoComplete="off"
                  disabled={pending}
                  id={`${ids}-name`}
                  onChange={(event) => set({ ...values, name: event.target.value })}
                  size="sm"
                  spellCheck={false}
                  value={draft.name}
                />
              </div>
              <FieldProblems field="name" problems={problems} />
            </FormRow>

            {!original && (
              <FormRow label="Table">
                <Select
                  disabled={pending}
                  onValueChange={(key) => set({ ...values, table: String(key), columns: [] })}
                  value={values.table}
                >
                  <SelectTrigger aria-label="Table" size="sm">
                    <SelectValue>
                      {(key: unknown) => {
                        const picked = tables.find((candidate) => tableKey(candidate) === key);
                        return (
                          <span className="truncate font-mono text-xs">
                            {picked ? tableLabel(picked) : String(key)}
                          </span>
                        );
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {tables.map((candidate) => (
                      <SelectItem key={tableKey(candidate)} value={tableKey(candidate)}>
                        <span className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate font-mono text-xs">
                            {tableLabel(candidate)}
                          </span>
                          {candidate.kind === "view" && (
                            <span className="shrink-0 text-muted-foreground text-xs">view</span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
                <FieldProblems field="table" problems={problems} />
              </FormRow>
            )}

            <FormRow label="Fires">
              <Tabs
                onValueChange={(timing) => set({ ...values, timing: timing as TriggerTiming })}
                value={draft.timing}
              >
                <TabsList aria-label="Fires" size="sm">
                  {TIMINGS.map((item) => (
                    <TabsTab
                      disabled={pending || !resolved.timings.includes(item.value)}
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>
              {resolved.kind === "view" && (
                <FormHint>
                  A view has no rows of its own: Instead of stands in for the write, and Before or
                  After run once per statement.
                </FormHint>
              )}
              <FieldProblems field="timing" problems={problems} />
            </FormRow>

            <FormRow label="On">
              <ToggleGroup
                aria-label="Events"
                className="flex-wrap"
                multiple
                onValueChange={(next) =>
                  set({
                    ...values,
                    operations: OPERATIONS.filter((operation) => next.includes(operation)),
                  })
                }
                size="sm"
                value={[...draft.operations]}
                variant="outline"
              >
                {OPERATIONS.map((operation) => (
                  <ToggleGroupItem
                    disabled={pending || !resolved.operations.includes(operation)}
                    key={operation}
                    value={operation}
                  >
                    {draft.operations.includes(operation) && <CheckIcon />}
                    {EVENT_LABEL[operation]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <FieldProblems field="operations" problems={problems} />
              {resolved.columnsApply && (
                <div className="mt-1 flex w-full flex-col items-start gap-1.5">
                  <span className="text-muted-foreground text-xs">Only when an update sets</span>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      disabled={pending}
                      render={<Button className="max-w-full" size="sm" variant="outline" />}
                    >
                      <span className="truncate font-mono text-xs">
                        {draft.columns.length > 0 ? draft.columns.join(", ") : "any column"}
                      </span>
                      <ChevronDownIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent className="w-60">
                      <DropdownMenuGroup>
                        <DropdownMenuLabel>Columns an update must set</DropdownMenuLabel>
                        {table.columns.map((column) => (
                          <DropdownMenuCheckboxItem
                            checked={draft.columns.includes(column.name)}
                            key={column.name}
                            onCheckedChange={(checked) => {
                              const next = new Set(draft.columns);
                              if (checked) next.add(column.name);
                              else next.delete(column.name);
                              set({
                                ...values,
                                columns: table.columns
                                  .map((c) => c.name)
                                  .filter((name) => next.has(name)),
                              });
                            }}
                          >
                            <span className="truncate font-mono">{column.name}</span>
                          </DropdownMenuCheckboxItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                  <FormHint>
                    {draft.columns.length > 0
                      ? "It fires even if the new value is the same as the old one."
                      : "None picked, so it fires on every update."}
                  </FormHint>
                  <FieldProblems field="columns" problems={problems} />
                </div>
              )}
            </FormRow>

            <FormRow label="For">
              <Tabs
                onValueChange={(level) => set({ ...values, level: level as TriggerLevel })}
                value={draft.level}
              >
                <TabsList aria-label="For" size="sm">
                  {LEVELS.map((item) => (
                    <TabsTab
                      disabled={pending || !resolved.levels.includes(item.value)}
                      key={item.value}
                      value={item.value}
                    >
                      {item.label}
                    </TabsTab>
                  ))}
                </TabsList>
              </Tabs>
              {why && <FormHint>{why}</FormHint>}
              <FieldProblems field="level" problems={problems} />
            </FormRow>

            <FormRow htmlFor={`${ids}-when`} label="Only if">
              <div className="w-full font-mono">
                <Input
                  autoComplete="off"
                  disabled={pending || !resolved.conditionApplies}
                  id={`${ids}-when`}
                  onChange={(event) => set({ ...values, condition: event.target.value })}
                  placeholder="Always"
                  size="sm"
                  spellCheck={false}
                  value={resolved.conditionApplies ? values.condition : ""}
                />
              </div>
              {!resolved.conditionApplies ? (
                <FormHint>INSTEAD OF triggers can&rsquo;t have a condition.</FormHint>
              ) : (
                conditionHint(draft.level) && <FormHint>{conditionHint(draft.level)}</FormHint>
              )}
              <FieldProblems field="condition" problems={problems} />
            </FormRow>

            <FormRow label="Function">
              <FormFunction
                catalog={catalog}
                disabled={pending}
                onChange={set}
                original={original}
                problems={problems}
                resolved={resolved}
                schema={schema}
                table={table}
                values={values}
              />
            </FormRow>
          </div>

          <p className="text-muted-foreground text-xs">
            Constraint triggers, transition tables and trigger arguments aren&rsquo;t in the form.
            Open in editor to write those by hand.
          </p>

          <section className="flex flex-col gap-2">
            <h4 className="font-medium text-muted-foreground text-xs">SQL that will run</h4>
            <Preview script={script} />
          </section>
        </div>
      </div>

      <footer className="flex shrink-0 flex-col gap-2 border-t p-3">
        {drawer.failure && <ChangeFailed error={drawer.failure} />}
        {drawer.leaving ? (
          <div className="flex items-center gap-1.5">
            <p className="min-w-0 flex-1 text-sm">Discard your changes?</p>
            <Button onClick={drawer.keepEditing} size="sm" variant="ghost">
              Keep editing
            </Button>
            <Button onClick={drawer.discard} size="sm" variant="destructive">
              Discard changes
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              disabled={pending || script.kind !== "sql"}
              onClick={() => {
                if (script.kind === "sql") onOpenInEditor(script.sql);
              }}
              size="sm"
              variant="ghost"
            >
              <CodeIcon />
              Open in editor
            </Button>
            <div className="flex-1" />
            <Button disabled={pending} onClick={cancel} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button
              disabled={script.kind !== "sql"}
              loading={pending}
              onClick={() => {
                if (script.kind === "sql") drawer.save(script.sql, table, draft, original);
              }}
              size="sm"
            >
              {original ? "Save changes" : "Create trigger"}
            </Button>
          </div>
        )}
      </footer>
    </>
  );
}
