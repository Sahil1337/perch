import type { DatabaseSchema, Table, Trigger } from "@perch/protocol";
import { Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import type * as React from "react";
import { plural } from "../../lib/format";
import { useFade } from "../../lib/motion";
import { Button } from "../../ui/button";
import { Switch } from "../../ui/switch";
import { highlightSql } from "../sql-editor/highlight-sql";
import { canAlsoDropFunction, dropTriggerScript, functionUsers } from "./trigger-sql";

/**
 * Drop's second press, in place of the first: what goes, the exact SQL, and the one choice worth
 * asking about. The function is offered only when nothing else calls it and it is the user's own,
 * and never by default: a trigger function outliving its trigger costs nothing, and one dropped by
 * mistake costs its body.
 */
export function TriggerDrop({
  alsoDropFunction,
  onAlsoDropFunction,
  onCancel,
  onDrop,
  pending,
  schema,
  table,
  trigger,
}: {
  alsoDropFunction: boolean;
  onAlsoDropFunction: (on: boolean) => void;
  onCancel: () => void;
  onDrop: () => void;
  pending: boolean;
  schema: DatabaseSchema;
  table: Table;
  trigger: Trigger;
}): React.ReactElement {
  const fade = useFade();
  const lone = canAlsoDropFunction(schema, trigger);
  const others = functionUsers(schema, trigger.function).length - 1;
  const script = dropTriggerScript(schema, table, trigger, lone && alsoDropFunction);
  const fn = `${trigger.function.name}()`;

  return (
    <motion.div
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 flex flex-col gap-2.5 rounded-lg border border-destructive/32 bg-destructive/4 p-3"
      initial={{ opacity: 0, y: -4 }}
      transition={fade}
    >
      <p className="text-sm">
        Drop <span className="break-all font-mono">{trigger.name}</span>? Postgres can&rsquo;t undo
        this.
      </p>
      {lone ? (
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <Switch
            checked={alsoDropFunction}
            disabled={pending}
            onCheckedChange={onAlsoDropFunction}
          />
          <span>
            Also drop <span className="font-mono">{fn}</span>. No other trigger uses it.
          </span>
        </label>
      ) : (
        others > 0 && (
          <p className="text-muted-foreground text-xs">
            <span className="font-mono">{fn}</span> stays: {plural(others, "other trigger")}{" "}
            {others === 1 ? "uses" : "use"} it.
          </p>
        )
      )}
      {script.kind === "sql" && (
        <pre className="overflow-x-auto whitespace-pre rounded-md bg-background p-2.5 font-mono text-xs leading-5">
          {highlightSql(script.sql)}
        </pre>
      )}
      <div className="flex justify-end gap-1.5">
        <Button disabled={pending} onClick={onCancel} size="sm" variant="ghost">
          Cancel
        </Button>
        <Button loading={pending} onClick={onDrop} size="sm" variant="destructive">
          <Trash2Icon />
          Drop trigger
        </Button>
      </div>
    </motion.div>
  );
}
