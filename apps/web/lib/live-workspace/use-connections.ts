"use client";

import type { PerchClient } from "@perch/client";
import type { ConnectionSummary, DiscoveryResult } from "@perch/protocol";
import {
  asyncData,
  asyncError,
  asyncIdle,
  asyncLoading,
  asyncReady,
  asyncRefreshing,
  type Async,
  type ConnectionInput,
  type ConnectionTest,
} from "@perch/ui";
import * as React from "react";
import { aborted, messageOf } from "./helpers";

/** Replaces a summary in place, keeping the server's order for anything it did not touch. */
function upsertSummary(
  list: readonly ConnectionSummary[],
  summary: ConnectionSummary,
): readonly ConnectionSummary[] {
  return list.some((c) => c.id === summary.id)
    ? list.map((c) => (c.id === summary.id ? summary : c))
    : [...list, summary];
}

export type ConnectionsApi = {
  connections: Async<readonly ConnectionSummary[]>;
  connectionId: string | null;
  connection: ConnectionSummary | undefined;
  database: string | null;
  databases: Async<readonly string[]>;
  connect: (id: string, database?: string) => Promise<void>;
  selectDatabase: (database: string | null) => Promise<void>;
  addConnection: (input: ConnectionInput) => Promise<ConnectionSummary>;
  updateConnection: (
    id: string,
    patch: Partial<ConnectionInput>,
  ) => Promise<ConnectionSummary>;
  removeConnection: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<ConnectionTest>;
  discoverServers: () => Promise<DiscoveryResult>;
};

export function useConnections(getClient: () => PerchClient, enabled: boolean): ConnectionsApi {
  const [connections, setConnections] =
    React.useState<Async<readonly ConnectionSummary[]>>(asyncLoading);
  const [connectionId, setConnectionId] = React.useState<string | null>(null);
  const [database, setDatabase] = React.useState<string | null>(null);
  const [fetchedDatabases, setFetchedDatabases] = React.useState<{
    connectionId: string;
    value: Async<readonly string[]>;
  } | null>(null);

  const load = React.useCallback(
    async (signal: AbortSignal): Promise<readonly ConnectionSummary[] | undefined> => {
      setConnections((prev) => asyncRefreshing(prev));
      try {
        const list = await getClient().connections.list({ signal });
        setConnections(asyncReady(list));
        return list;
      } catch (error) {
        if (!aborted(error)) setConnections((prev) => asyncError(messageOf(error), prev));
        return undefined;
      }
    },
    [getClient],
  );

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const { signal } = controller;
    void (async () => {
      const list = await load(signal);
      if (signal.aborted || !list) return;
      // Prefer one the server already has open: it is the one the CLI or a previous session used.
      const first = list.find((c) => c.status === "connected") ?? list[0];
      if (!first) return;
      setConnectionId(first.id);
      setDatabase(first.database);
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
    })();
    return () => controller.abort();
  }, [enabled, getClient, load]);

  const connection = React.useMemo(
    () => asyncData(connections)?.find((c) => c.id === connectionId),
    [connections, connectionId],
  );

  const summaryDatabases = connection?.databases;

  React.useEffect(() => {
    if (!enabled || !connectionId || summaryDatabases) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const list = await getClient().connections.databases(connectionId, {
          signal: controller.signal,
        });
        setFetchedDatabases({ connectionId, value: asyncReady(list) });
      } catch (error) {
        if (aborted(error)) return;
        setFetchedDatabases({ connectionId, value: asyncError(messageOf(error)) });
      }
    })();
    return () => controller.abort();
  }, [enabled, connectionId, summaryDatabases, getClient]);

  const databases = React.useMemo<Async<readonly string[]>>(() => {
    if (!connectionId) return asyncIdle;
    if (summaryDatabases) return asyncReady(summaryDatabases);
    if (fetchedDatabases?.connectionId === connectionId) return fetchedDatabases.value;
    return asyncLoading;
  }, [connectionId, summaryDatabases, fetchedDatabases]);

  const connect = React.useCallback(
    async (nextId: string, nextDatabase?: string): Promise<void> => {
      try {
        const summary = await getClient().connections.connect(nextId);
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        setConnectionId(nextId);
        setDatabase(nextDatabase ?? summary.database);
      } catch (error) {
        setConnections((prev) => asyncError(messageOf(error), prev));
      }
    },
    [getClient],
  );

  const addConnection = React.useCallback(
    async (input: ConnectionInput): Promise<ConnectionSummary> => {
      try {
        const summary = await getClient().connections.create({ ...input });
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        return summary;
      } catch (error) {
        const message = messageOf(error);
        setConnections((prev) => asyncError(message, prev));
        throw new Error(message);
      }
    },
    [getClient],
  );

  const updateConnection = React.useCallback(
    async (id: string, patch: Partial<ConnectionInput>): Promise<ConnectionSummary> => {
      try {
        const summary = await getClient().connections.update(id, { ...patch });
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        return summary;
      } catch (error) {
        const message = messageOf(error);
        setConnections((prev) => asyncError(message, prev));
        throw new Error(message);
      }
    },
    [getClient],
  );

  const removeConnection = React.useCallback(
    async (id: string): Promise<void> => {
      try {
        await getClient().connections.remove(id);
        setConnections((prev) => asyncReady((asyncData(prev) ?? []).filter((c) => c.id !== id)));
        if (connectionId === id) {
          setConnectionId(null);
          setDatabase(null);
        }
      } catch (error) {
        setConnections((prev) => asyncError(messageOf(error), prev));
      }
    },
    [connectionId, getClient],
  );

  /** Rejects on purpose: the contract says so, and a dialog needs the message. */
  const testConnection = React.useCallback(
    async (id: string): Promise<ConnectionTest> => {
      try {
        return await getClient().connections.test(id);
      } catch (error) {
        throw new Error(messageOf(error));
      }
    },
    [getClient],
  );

  /** Also rejects: the result is the whole answer, so there is nothing to degrade to. */
  const discoverServers = React.useCallback(async (): Promise<DiscoveryResult> => {
    try {
      return await getClient().discover();
    } catch (error) {
      throw new Error(messageOf(error));
    }
  }, [getClient]);

  const selectDatabase = React.useCallback(
    async (next: string | null): Promise<void> => setDatabase(next),
    [],
  );

  return {
    connections,
    connectionId,
    connection,
    database,
    databases,
    connect,
    selectDatabase,
    addConnection,
    updateConnection,
    removeConnection,
    testConnection,
    discoverServers,
  };
}
