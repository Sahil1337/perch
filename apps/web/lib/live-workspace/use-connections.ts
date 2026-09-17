"use client";

// Which server the workspace is pointed at, and which database on it.
//
// The database is a *pick*, not a copy: `null` means "whatever this connection says", so a
// connection whose summary changes underneath — edited in Settings, re-dialled onto a different
// default — is followed rather than shadowed by a value bootstrapped once at startup.

import type { PerchClient } from "@perch/client";
import type { ConnectionSummary } from "@perch/protocol";
import {
  asyncData,
  asyncLoading,
  asyncReady,
  asyncRefreshing,
  type Async,
} from "@perch/ui";
import * as React from "react";
import { upsertSummary, useConnectionCrud, type ConnectionCrud } from "./connection-crud";
import { applyError, useAbortable } from "./use-async-resource";
import { useDatabases } from "./use-databases";

export type ConnectionsState = ConnectionCrud & {
  connections: Async<readonly ConnectionSummary[]>;
  connectionId: string | null;
  connection: ConnectionSummary | undefined;
  database: string | null;
  databases: Async<readonly string[]>;
  selectDatabase: (database: string) => Promise<void>;
};

export function useConnections(getClient: () => PerchClient, enabled: boolean): ConnectionsState {
  const [connections, setConnections] =
    React.useState<Async<readonly ConnectionSummary[]>>(asyncLoading);
  const [connectionId, setConnectionId] = React.useState<string | null>(null);
  /** The database the user asked for, or null to follow the connection's own. */
  const [picked, setPicked] = React.useState<string | null>(null);

  const load = React.useCallback(
    async (signal: AbortSignal): Promise<readonly ConnectionSummary[] | undefined> => {
      setConnections((prev) => asyncRefreshing(prev));
      try {
        const list = await getClient().connections.list({ signal });
        setConnections(asyncReady(list));
        return list;
      } catch (error) {
        applyError(setConnections, error);
        return undefined;
      }
    },
    [getClient],
  );

  // Its own effect rather than `useAsyncResource`: the list is only half of what the first read is
  // for — the other half is deciding which connection the app opens on, and dialling it.
  const bootstrap = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      const list = await load(signal);
      if (signal.aborted || !list) return;
      // Prefer one the server already has open: it is the one the CLI or a previous session used.
      const first = list.find((c) => c.status === "connected") ?? list[0];
      if (!first) return;
      setConnectionId(first.id);
      // Loading the schema would connect the driver anyway, but only an explicit connect
      // refreshes the summary, so the topbar dot would stay grey over a loaded tree.
      if (first.status !== "connected") {
        try {
          const summary = await getClient().connections.connect(first.id, { signal });
          if (!signal.aborted) {
            setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
          }
        } catch {
          /* the picker shows the failure state from the next connections load */
        }
      }
    },
    [getClient, load],
  );

  useAbortable(enabled, bootstrap);

  const connection = React.useMemo(
    () => asyncData(connections)?.find((c) => c.id === connectionId),
    [connections, connectionId],
  );

  const database = picked ?? connection?.database ?? null;
  const databases = useDatabases(getClient, enabled, connectionId, connection?.databases);

  const select = React.useCallback((nextId: string | null, nextDatabase: string | null): void => {
    setConnectionId(nextId);
    setPicked(nextDatabase);
  }, []);

  const crud = useConnectionCrud(getClient, setConnections, { connectionId, select });

  // Async because the contract is: every action returns a promise so a caller can sequence work.
  // There is nothing here to await — switching database is a local pick, and the panes below
  // re-read from it.
  const selectDatabase = React.useCallback(
    (next: string): Promise<void> => {
      setPicked(next);
      return Promise.resolve();
    },
    [],
  );

  return {
    ...crud,
    connections,
    connectionId,
    connection,
    database,
    databases,
    selectDatabase,
  };
}
