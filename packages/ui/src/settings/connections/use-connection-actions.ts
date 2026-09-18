import * as React from "react";
import { messageOf } from "../../lib/errors";
import { useWorkspace } from "../../workspace/context";
import type { ConnectionTest } from "../../workspace/types";

/** Per-row, because a test result that appears somewhere else is useless with two connections. */
export type TestState =
  { kind: "running" } | { kind: "ok"; test: ConnectionTest } | { kind: "error"; message: string };

/**
 * One at a time, so the state is a single value rather than a map: removing is modal — it takes a
 * confirming click on the row before it runs at all.
 */
export type RemoveState =
  { kind: "idle" } | { kind: "removing"; id: string } | { kind: "error"; message: string };

export type ConnectionActions = {
  readonly tests: Record<string, TestState>;
  readonly removeState: RemoveState;
  test: (id: string) => void;
  remove: (id: string, onRemoved: () => void) => void;
};

/** Testing and removing a saved connection, with the outcome of each kept by the row it belongs to. */
export function useConnectionActions(): ConnectionActions {
  const { testConnection, removeConnection } = useWorkspace();
  const [tests, setTests] = React.useState<Record<string, TestState>>({});
  const [removeState, setRemoveState] = React.useState<RemoveState>({ kind: "idle" });

  const test = React.useCallback(
    (id: string) => {
      setTests((previous) => ({ ...previous, [id]: { kind: "running" } }));
      void testConnection(id).then(
        (result) => setTests((previous) => ({ ...previous, [id]: { kind: "ok", test: result } })),
        (cause: unknown) =>
          setTests((previous) => ({
            ...previous,
            [id]: { kind: "error", message: messageOf(cause) },
          })),
      );
    },
    [testConnection],
  );

  const remove = React.useCallback(
    (id: string, onRemoved: () => void) => {
      setRemoveState({ kind: "removing", id });
      void removeConnection(id).then(
        () => {
          setRemoveState({ kind: "idle" });
          onRemoved();
        },
        (cause: unknown) => setRemoveState({ kind: "error", message: messageOf(cause) }),
      );
    },
    [removeConnection],
  );

  return { tests, removeState, test, remove };
}
