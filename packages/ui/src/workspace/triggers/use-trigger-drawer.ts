// The drawer's state: which face it shows, and what it is in the middle of. Everything that moves
// the drawer goes through `go`, which is the one place a dirty form gets to ask before its changes
// are thrown away, whether the reader closed the drawer, picked another table or card, pressed
// Escape or closed the view.

import type { DatabaseSchema, QueryError, Table, Trigger, TriggerOperation } from "@perch/protocol";
import * as React from "react";
import { useWorkspace } from "../context";
import type { TriggerPreset } from "./lane-playback";
import { sameValues, submittedTrigger, type FormValues } from "./trigger-form-values";
import { dropTriggerScript, toggleTriggerScript, type TriggerDraft } from "./trigger-sql";

/** A trigger by where it lives, which is what survives a rename or a refresh. */
export type TriggerAt = { readonly schema: string; readonly table: string; readonly name: string };

export type DrawerFace =
  | {
      readonly kind: "detail";
      readonly at: TriggerAt;
      /** What was just submitted, shown while the schema that has it is on its way. */
      readonly submitted: Trigger | null;
    }
  | {
      readonly kind: "form";
      /** The trigger being edited as it was when the form opened; null when creating one. */
      readonly original: Trigger | null;
      /** The Add slot the form was opened from, which stays lit while it is open. */
      readonly slot: TriggerPreset | null;
      readonly initial: FormValues;
      readonly values: FormValues;
    };

/** Somewhere to go: a face, or none, and what else to do once there (pick a table, close). */
export type Leave = { readonly face: DrawerFace | null; readonly then?: () => void };

/** "Created. The SQL is in History." On a trigger's detail, or with none after a drop. */
export type Flash = { readonly text: string; readonly at: TriggerAt | null };

type State = {
  readonly face: DrawerFace | null;
  /** Bumped on every move, so each face mounts fresh even when it is the same kind twice. */
  readonly opened: number;
  /** A dirty form was asked to go somewhere: where, once the reader says to discard. */
  readonly leaving: Leave | null;
  readonly dropArmed: boolean;
  readonly alsoDropFunction: boolean;
  readonly pending: boolean;
  readonly failure: QueryError | null;
  readonly flash: Flash | null;
};

const CLOSED: State = {
  face: null,
  opened: 0,
  leaving: null,
  dropArmed: false,
  alsoDropFunction: false,
  pending: false,
  failure: null,
  flash: null,
};

export const atOf = (table: Table, name: string): TriggerAt => ({
  schema: table.schema,
  table: table.name,
  name,
});

export type TriggerDrawerApi = State & {
  readonly dirty: boolean;
  go(leave: Leave): void;
  discard(): void;
  keepEditing(): void;
  edit(values: FormValues): void;
  armDrop(armed: boolean): void;
  setAlsoDropFunction(on: boolean): void;
  toggle(table: Table, trigger: Trigger): void;
  drop(schema: DatabaseSchema, table: Table, trigger: Trigger): void;
  save(sql: string, table: Table, draft: TriggerDraft, original: Trigger | null): void;
  /** Escape: steps back out of whatever is open. False when nothing was, so the view closes. */
  dismiss(): boolean;
  /** Any other way of closing the view: false while a dirty form asks first. */
  release(onClose: () => void): boolean;
};

export function useTriggerDrawer({
  onShow,
}: {
  /** A change landed on this table: bring its lane up, on an event the trigger fires on. */
  onShow: (table: Table, operations: readonly TriggerOperation[]) => void;
}): TriggerDrawerApi {
  const { execute } = useWorkspace();
  const [state, setState] = React.useState<State>(CLOSED);
  // A second click lands before the render that disables the button, so the guard can't be state.
  const running = React.useRef(false);

  const face = state.face;
  const dirty = face?.kind === "form" && !sameValues(face.initial, face.values);

  const arrive = (leave: Leave, flash: Flash | null = null): void => {
    setState((prev) => ({
      ...CLOSED,
      face: leave.face,
      opened: prev.opened + 1,
      flash,
    }));
    leave.then?.();
  };

  const go = (leave: Leave): void => {
    if (running.current) return;
    if (dirty) setState((prev) => ({ ...prev, leaving: leave }));
    else arrive(leave);
  };

  const run = async (sql: string, landed: () => void): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setState((prev) => ({ ...prev, pending: true, failure: null, flash: null, leaving: null }));
    const record = await execute(sql);
    running.current = false;
    if (record.status === "done") {
      setState((prev) => ({ ...prev, pending: false }));
      landed();
      return;
    }
    const failure: QueryError = record.error ?? {
      message:
        record.status === "cancelled"
          ? "The change was cancelled. Nothing was changed."
          : "The change did not go through.",
    };
    setState((prev) => ({ ...prev, pending: false, failure }));
  };

  return {
    ...state,
    dirty,
    go,
    discard: () => {
      if (state.leaving) arrive(state.leaving);
    },
    keepEditing: () => setState((prev) => ({ ...prev, leaving: null })),
    edit: (values) =>
      setState((prev) =>
        prev.face?.kind === "form"
          ? { ...prev, face: { ...prev.face, values }, failure: null, leaving: null }
          : prev,
      ),
    armDrop: (armed) =>
      setState((prev) => ({
        ...prev,
        dropArmed: armed,
        alsoDropFunction: false,
        failure: null,
        flash: null,
      })),
    setAlsoDropFunction: (on) => setState((prev) => ({ ...prev, alsoDropFunction: on })),
    toggle: (table, trigger) => {
      const script = toggleTriggerScript(table, trigger);
      if (script.kind !== "sql") return;
      void run(script.sql, () =>
        setState((prev) => ({
          ...prev,
          flash: {
            text: trigger.state === "disabled" ? "Turned on" : "Turned off",
            at: atOf(table, trigger.name),
          },
        })),
      );
    },
    drop: (schema, table, trigger) => {
      const script = dropTriggerScript(schema, table, trigger, state.alsoDropFunction);
      if (script.kind !== "sql") return;
      void run(script.sql, () =>
        arrive({ face: null }, { text: `Dropped ${trigger.name}`, at: null }),
      );
    },
    save: (sql, table, draft, original) => {
      void run(sql, () => {
        const at = atOf(table, draft.name);
        arrive(
          {
            face: {
              kind: "detail",
              at,
              submitted: submittedTrigger(table, draft, original ?? undefined),
            },
          },
          { text: original ? "Saved" : "Created", at },
        );
        onShow(table, draft.operations);
      });
    },
    dismiss: () => {
      if (running.current) return true;
      if (state.leaving) {
        setState((prev) => ({ ...prev, leaving: null }));
        return true;
      }
      if (state.dropArmed) {
        setState((prev) => ({ ...prev, dropArmed: false }));
        return true;
      }
      if (face) {
        go({ face: null });
        return true;
      }
      return false;
    },
    release: (onClose) => {
      if (!dirty || running.current) return true;
      setState((prev) => ({ ...prev, leaving: { face: null, then: onClose } }));
      return false;
    },
  };
}
