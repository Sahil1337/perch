"use client";

import type { ConnectionSummary } from "@perch/protocol";
import type * as React from "react";
import { Skeleton } from "../../ui/skeleton";
import { ErrorText } from "../../workspace/error-text";
import { asyncData, type Async } from "../../workspace/types";
import { ConnectionRow } from "./connection-row";
import type { ConnectionActions } from "./use-connection-actions";

/**
 * What you already have. Follows the rule in types.ts: a refetch never replaces the list with
 * skeletons, and a failed refetch renders its error above whatever last loaded.
 */
export function SavedConnectionsList({
  connections,
  actions,
  editingId,
  confirmingId,
  onEdit,
  onRequestRemove,
  onConfirmRemove,
}: {
  connections: Async<readonly ConnectionSummary[]>;
  actions: ConnectionActions;
  /** The row whose form is open below, or null. */
  editingId: string | null;
  /** The row whose Remove button has turned into a confirmation, or null. */
  confirmingId: string | null;
  onEdit: (connection: ConnectionSummary) => void;
  onRequestRemove: (id: string) => void;
  onConfirmRemove: (id: string) => void;
}): React.ReactElement {
  const rows: readonly ConnectionSummary[] = asyncData(connections) ?? [];
  const pending = connections.status === "idle" || connections.status === "loading";

  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs">Saved</h3>

      {pending && (
        <ul aria-label="Loading connections" className="flex flex-col gap-1">
          {[0, 1].map((row) => (
            <li
              className="flex h-11 items-center gap-2 rounded-md border border-border px-2"
              key={row}
            >
              <Skeleton className="size-4" />
              <Skeleton className="h-3 w-40" />
            </li>
          ))}
        </ul>
      )}

      {connections.status === "error" && <ErrorText>{connections.error}</ErrorText>}

      {!pending && rows.length === 0 && (
        <p className="rounded-md border border-border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
          No connections yet
        </p>
      )}

      {rows.length > 0 && (
        <ul className="flex flex-col gap-1">
          {rows.map((connection) => (
            <ConnectionRow
              confirming={confirmingId === connection.id}
              connection={connection}
              editing={editingId === connection.id}
              key={connection.id}
              onConfirmRemove={() => onConfirmRemove(connection.id)}
              onEdit={() => onEdit(connection)}
              onRequestRemove={() => onRequestRemove(connection.id)}
              onTest={() => actions.test(connection.id)}
              removing={
                actions.removeState.kind === "removing" && actions.removeState.id === connection.id
              }
              test={actions.tests[connection.id]}
            />
          ))}
        </ul>
      )}

      {actions.removeState.kind === "error" && <ErrorText>{actions.removeState.message}</ErrorText>}
    </section>
  );
}
