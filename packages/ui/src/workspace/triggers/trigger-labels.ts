// How a trigger is said in words, shared by its card in the lane and its detail in the drawer, so
// the two never describe the same trigger two ways.

import type { Trigger, TriggerOperation, TriggerState } from "@perch/protocol";

/** "status", "status or total": UPDATE OF fires when any one of them is set. */
export function columnsWord(columns: readonly string[]): string {
  return columns.length < 2
    ? columns.join("")
    : `${columns.slice(0, -1).join(", ")} or ${columns.at(-1)}`;
}

function operationWord(operation: TriggerOperation, columns: readonly string[]): string {
  return operation === "update" && columns.length > 0
    ? `update of ${columns.join(", ")}`
    : operation;
}

/** "before update of status", "after insert, update or delete". */
export function firesWord(trigger: Trigger): string {
  const timing = trigger.timing === "instead_of" ? "instead of" : trigger.timing;
  const words = trigger.operations.map((operation) => operationWord(operation, trigger.columns));
  const list =
    words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} or ${words.at(-1)}`;
  return `${timing} ${list}`;
}

const literal = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * `audit_row()`, `log_change('orders', '')`. Qualified only when the function lives in another
 * schema than the table, which is the one case where the bare name could point somewhere else.
 */
export function callWord(trigger: Trigger, tableSchema: string): string {
  const { schema, name } = trigger.function;
  const qualified = schema === tableSchema ? name : `${schema}.${name}`;
  return `${qualified}(${trigger.arguments.map(literal).join(", ")})`;
}

export function stateWord(state: TriggerState): string {
  switch (state) {
    case "enabled":
      return "On";
    case "disabled":
      return "Off";
    case "replica":
      return "Replica only";
    case "always":
      return "Always, even on replicas";
  }
}
