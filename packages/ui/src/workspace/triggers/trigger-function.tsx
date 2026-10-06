import type { DatabaseSchema, Trigger } from "@perch/protocol";
import type * as React from "react";
import { plural } from "../../lib/format";
import { Badge } from "../../ui/badge";
import { highlightSql } from "../sql-editor/highlight-sql";
import { bodyEditBlocker } from "./trigger-catalog";
import { functionUsers } from "./trigger-sql";
import type { FunctionCatalogState } from "./use-function-catalog";

function Body({ catalog }: { catalog: FunctionCatalogState }): React.ReactElement {
  switch (catalog.status) {
    case "loading":
      return <p className="text-muted-foreground text-xs">Reading the function…</p>;
    case "missing":
      return <p className="text-muted-foreground text-xs">This function no longer exists.</p>;
    case "error":
      return (
        <p className="break-words text-destructive-foreground text-xs" role="alert">
          Couldn&rsquo;t read the function: {catalog.message}
        </p>
      );
    case "found":
      return (
        <pre className="overflow-x-auto whitespace-pre rounded-md bg-muted p-2.5 font-mono text-xs leading-5">
          {highlightSql(catalog.fn.definition.trimEnd())}
        </pre>
      );
  }
}

/**
 * The function a trigger calls, read from the catalog when the drawer shows it, and how many
 * triggers share it: editing a shared function's body changes every one of them.
 */
export function TriggerFunction({
  catalog,
  schema,
  tableSchema,
  trigger,
}: {
  catalog: FunctionCatalogState;
  schema: DatabaseSchema;
  tableSchema: string;
  trigger: Trigger;
}): React.ReactElement {
  const users = functionUsers(schema, trigger.function).length;
  const { schema: fnSchema, name } = trigger.function;
  const blocker = catalog.status === "found" ? bodyEditBlocker(catalog.fn) : null;

  return (
    <section className="flex flex-col gap-2">
      <h4 className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium text-muted-foreground text-xs">
        Function
        <span className="break-all font-mono text-foreground">
          {fnSchema === tableSchema ? name : `${fnSchema}.${name}`}()
        </span>
        <span className="font-normal">used by {plural(users, "trigger")}</span>
        {blocker && (
          <Badge size="sm" variant="outline">
            {blocker}
          </Badge>
        )}
      </h4>
      <Body catalog={catalog} />
    </section>
  );
}
