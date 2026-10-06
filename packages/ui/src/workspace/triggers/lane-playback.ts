// What the lane plays: one example statement run through a table's triggers, as a list of steps
// worked out from the introspected triggers alone. Nothing here touches the database, so a WHEN
// condition is assumed to hold and a BEFORE ROW trigger is assumed to hand the row on.
//
// The order is Postgres's, checked against real runs: BEFORE STATEMENT; then, for each row, its
// BEFORE ROW triggers and the write; then, only once every row is written, each row's AFTER ROW
// triggers; then AFTER STATEMENT. Within one slot the triggers run in the order the server sends
// them, which is byte order of their names, so nothing here sorts.

import type { Trigger, TriggerLevel, TriggerOperation, TriggerTiming } from "@perch/protocol";

/** What the lane can show. A materialized view takes no triggers, so it never gets this far. */
export type RelationKind = "table" | "view";

export type StageId =
  "before-statement" | "before-row" | "write" | "after-row" | "after-statement" | "instead-row";

export type Slot = { readonly timing: TriggerTiming; readonly level: TriggerLevel };

export type Stage = {
  readonly id: StageId;
  readonly title: string;
  /** The timing and level a trigger needs to sit here; null for the write, Postgres's own step. */
  readonly slot: Slot | null;
  /** One line under the title: what a trigger in this column can do, or what happens here. */
  readonly why: string;
};

/** Where a new trigger would go: the slot an Add button stands for, on one table, for one event. */
export type TriggerPreset = Slot & {
  readonly schema: string;
  readonly table: string;
  readonly operation: TriggerOperation;
};

const TABLE_STAGES: readonly Stage[] = [
  {
    id: "before-statement",
    title: "Before the statement",
    slot: { timing: "before", level: "statement" },
    why: "Once, before any row changes.",
  },
  {
    id: "before-row",
    title: "Before each row",
    slot: { timing: "before", level: "row" },
    why: "Can change the row, or skip it.",
  },
  { id: "write", title: "Row written", slot: null, why: "Postgres writes the row here." },
  {
    id: "after-row",
    title: "After each row",
    slot: { timing: "after", level: "row" },
    why: "Queued. Runs once every row is written.",
  },
  {
    id: "after-statement",
    title: "After the statement",
    slot: { timing: "after", level: "statement" },
    why: "Once, at the very end.",
  },
];

const VIEW_STAGES: readonly Stage[] = [
  {
    id: "before-statement",
    title: "Before the statement",
    slot: { timing: "before", level: "statement" },
    why: "Once, before anything happens.",
  },
  {
    id: "instead-row",
    title: "Instead of each row",
    slot: { timing: "instead_of", level: "row" },
    why: "A view has no rows to write. This trigger does the work.",
  },
  {
    id: "after-statement",
    title: "After the statement",
    slot: { timing: "after", level: "statement" },
    why: "Once, at the very end.",
  },
];

export function stagesFor(kind: RelationKind): readonly Stage[] {
  return kind === "view" ? VIEW_STAGES : TABLE_STAGES;
}

/** The triggers in one slot for one event, in the server's order. */
export function triggersAt(
  triggers: readonly Trigger[],
  slot: Slot,
  event: TriggerOperation,
): Trigger[] {
  return triggers.filter(
    (trigger) =>
      trigger.operations.includes(event) &&
      trigger.timing === slot.timing &&
      trigger.level === slot.level,
  );
}

/**
 * Why a trigger will not run for this statement, as the card finishes "skipped · …", or null when
 * it runs. A WHEN condition is never a reason: the lane has no rows to test it against.
 */
export function skipReason(
  trigger: Trigger,
  event: TriggerOperation,
  setColumns: readonly string[],
): string | null {
  if (trigger.state === "disabled") return "off";
  // Fires only while session_replication_role is `replica`, which an ordinary session is not.
  if (trigger.state === "replica") return "replica only";
  // UPDATE OF counts a column as changed when the statement SETs it, even to the same value.
  if (
    event === "update" &&
    trigger.columns.length > 0 &&
    !trigger.columns.some((column) => setColumns.includes(column))
  ) {
    return `${trigger.columns.join(", ")} not set`;
  }
  return null;
}

export type StepKind =
  /** The statement begins; its BEFORE STATEMENT triggers come next. */
  | "start"
  /** A row starts through a row stage: before-row, after-row or instead-row. */
  | "row"
  | "fire"
  | "skip"
  /** An initially deferred constraint trigger, queued here and run at COMMIT. */
  | "defer"
  /** Postgres writes (or deletes) the row; for TRUNCATE, empties the table. */
  | "write"
  /** A view whose rows no INSTEAD OF trigger takes. */
  | "unhandled"
  /** Every row is done; the AFTER STATEMENT triggers come next. */
  | "end"
  | "done";

export type Step = {
  readonly kind: StepKind;
  readonly stage: StageId;
  /** 1-based; null for a statement-level step. */
  readonly row: number | null;
  /** The trigger a fire, skip or defer is about. */
  readonly trigger: Trigger | null;
  /** For a skip, why, in the words the card shows after "skipped · ". */
  readonly reason: string | null;
};

export type PlaybackInput = {
  /** One table's triggers, in the server's order. */
  readonly triggers: readonly Trigger[];
  readonly kind: RelationKind;
  readonly event: TriggerOperation;
  /** How many rows the example statement touches. Ignored for TRUNCATE. */
  readonly rows: number;
  /** The columns an UPDATE sets. Ignored for the other events. */
  readonly setColumns: readonly string[];
};

const step = (
  kind: StepKind,
  stage: StageId,
  row: number | null = null,
  trigger: Trigger | null = null,
  reason: string | null = null,
): Step => ({ kind, stage, row, trigger, reason });

const BEFORE_STATEMENT: Slot = { timing: "before", level: "statement" };
const BEFORE_ROW: Slot = { timing: "before", level: "row" };
const AFTER_ROW: Slot = { timing: "after", level: "row" };
const AFTER_STATEMENT: Slot = { timing: "after", level: "statement" };
const INSTEAD_ROW: Slot = { timing: "instead_of", level: "row" };

export function buildSteps(input: PlaybackInput): Step[] {
  const { triggers, kind, event, setColumns } = input;
  const rows = Math.max(1, Math.floor(input.rows));
  const steps: Step[] = [];
  const reasonFor = (trigger: Trigger): string | null => skipReason(trigger, event, setColumns);

  // A view's statement triggers fire only when an INSTEAD OF row trigger takes the event.
  // Otherwise Postgres either rewrites the statement onto the base table, whose triggers are the
  // ones that run, or refuses it; either way these never fire.
  const handled =
    kind !== "view" ||
    triggersAt(triggers, INSTEAD_ROW, event).some((trigger) => reasonFor(trigger) === null);
  const statementReason = handled ? null : `no INSTEAD OF ${event.toUpperCase()} trigger`;

  const statementTriggers = (slot: Slot, stage: StageId): void => {
    for (const trigger of triggersAt(triggers, slot, event)) {
      const reason = statementReason ?? reasonFor(trigger);
      steps.push(step(reason ? "skip" : "fire", stage, null, trigger, reason));
    }
  };
  const rowTriggers = (slot: Slot, stage: StageId, row: number): void => {
    for (const trigger of triggersAt(triggers, slot, event)) {
      const reason = reasonFor(trigger);
      if (reason) steps.push(step("skip", stage, row, trigger, reason));
      else if (trigger.constraint && trigger.initiallyDeferred) {
        steps.push(step("defer", stage, row, trigger));
      } else steps.push(step("fire", stage, row, trigger));
    }
  };

  steps.push(step("start", "before-statement"));
  statementTriggers(BEFORE_STATEMENT, "before-statement");

  if (kind === "view") {
    if (!handled) steps.push(step("unhandled", "instead-row"));
    else if (event !== "truncate") {
      for (let row = 1; row <= rows; row += 1) {
        steps.push(step("row", "instead-row", row));
        rowTriggers(INSTEAD_ROW, "instead-row", row);
      }
    }
  } else if (event === "truncate") {
    steps.push(step("write", "write"));
  } else {
    for (let row = 1; row <= rows; row += 1) {
      steps.push(step("row", "before-row", row));
      rowTriggers(BEFORE_ROW, "before-row", row);
      steps.push(step("write", "write", row));
    }
    // The queue only gets its own beats when something is waiting in it.
    if (triggersAt(triggers, AFTER_ROW, event).length > 0) {
      for (let row = 1; row <= rows; row += 1) {
        steps.push(step("row", "after-row", row));
        rowTriggers(AFTER_ROW, "after-row", row);
      }
    }
  }

  steps.push(step("end", "after-statement"));
  statementTriggers(AFTER_STATEMENT, "after-statement");
  steps.push(step("done", "after-statement"));
  return steps;
}

export type CardStatus =
  | { readonly kind: "firing" }
  | { readonly kind: "ran"; readonly rows: readonly number[] }
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "deferred" };

/** The lane as it stands after `index` steps have played; -1 is at rest. */
export type LaneState = {
  readonly stage: StageId | null;
  /** The row the current step is on, when it is on one. */
  readonly row: number | null;
  /** Keyed by trigger name, which is unique on a table. */
  readonly cards: ReadonlyMap<string, CardStatus>;
  /** Rows written so far. */
  readonly written: readonly number[];
  /** Whether a TRUNCATE has emptied the table yet. */
  readonly emptied: boolean;
  /** Rows whose AFTER ROW triggers have had their turn. */
  readonly drained: readonly number[];
  readonly log: readonly Step[];
};

export function laneAt(steps: readonly Step[], index: number): LaneState {
  const log = steps.slice(0, Math.max(0, index + 1));
  const cards = new Map<string, CardStatus>();
  const written: number[] = [];
  const drained: number[] = [];
  let emptied = false;
  let row: number | null = null;

  log.forEach((current, at) => {
    const name = current.trigger?.name;
    if (current.row !== null) row = current.row;
    else if (current.kind === "start" || current.kind === "end") row = null;
    if (current.kind === "fire" && name !== undefined) {
      const before = cards.get(name);
      const rows = before?.kind === "ran" ? before.rows : [];
      cards.set(name, {
        kind: "ran",
        rows: current.row === null ? rows : [...rows, current.row],
      });
      if (at === index) cards.set(name, { kind: "firing" });
    }
    if (current.kind === "skip" && name !== undefined && current.reason !== null) {
      cards.set(name, { kind: "skipped", reason: current.reason });
    }
    if (current.kind === "defer" && name !== undefined) cards.set(name, { kind: "deferred" });
    if (current.kind === "write") {
      if (current.row === null) emptied = true;
      else written.push(current.row);
    }
    if (current.kind === "row" && current.stage === "after-row" && current.row !== null) {
      drained.push(current.row);
    }
  });

  return {
    stage: log.at(-1)?.stage ?? null,
    row,
    cards,
    written,
    emptied,
    drained,
    log,
  };
}
