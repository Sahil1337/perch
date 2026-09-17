"use client";

// The five writes against `/api/connections`, and what each does to the list on screen.
//
// Two rejection policies, on purpose. A write that only changes the list degrades into
// `connections` as an error over the last good list, because there is a picker still showing it.
// `testConnection` and `discoverServers` reject instead: their result *is* the answer, so there is
// nothing to degrade to and a dialog is waiting on the message.

import type { PerchClient } from "@perch/client";
import type { ConnectionSummary, DiscoveryResult } from "@perch/protocol";
import { asyncData, asyncError, asyncReady, type Async, type ConnectionInput, type ConnectionTest } from "@perch/ui";
import * as React from "react";
import { messageOf } from "./helpers";

/** Replaces a summary in place, keeping the server's order for anything it did not touch. */
export function upsertSummary(
  list: readonly ConnectionSummary[],
  summary: ConnectionSummary,
): readonly ConnectionSummary[] {
  return list.some((c) => c.id === summary.id)
    ? list.map((c) => (c.id === summary.id ? summary : c))
    : [...list, summary];
}

export type ConnectionCrud = {
  connect: (id: string, database?: string) => Promise<void>;
  addConnection: (input: ConnectionInput) => Promise<ConnectionSummary>;
  updateConnection: (id: string, patch: Partial<ConnectionInput>) => Promise<ConnectionSummary>;
  removeConnection: (id: string) => Promise<void>;
  testConnection: (id: string) => Promise<ConnectionTest>;
  discoverServers: () => Promise<DiscoveryResult>;
};

export function useConnectionCrud(
  getClient: () => PerchClient,
  setConnections: React.Dispatch<React.SetStateAction<Async<readonly ConnectionSummary[]>>>,
  selection: {
    connectionId: string | null;
    /** Points the workspace at a connection, and at a database on it when one was asked for. */
    select: (connectionId: string | null, database: string | null) => void;
  },
): ConnectionCrud {
  const { connectionId, select } = selection;

  const connect = React.useCallback(
    async (nextId: string, nextDatabase?: string): Promise<void> => {
      try {
        const summary = await getClient().connections.connect(nextId);
        setConnections((prev) => asyncReady(upsertSummary(asyncData(prev) ?? [], summary)));
        select(nextId, nextDatabase ?? null);
      } catch (error) {
        setConnections((prev) => asyncError(messageOf(error), prev));
      }
    },
    [getClient, select, setConnections],
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
    [getClient, setConnections],
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
    [getClient, setConnections],
  );

  const removeConnection = React.useCallback(
    async (id: string): Promise<void> => {
      try {
        await getClient().connections.remove(id);
        setConnections((prev) => asyncReady((asyncData(prev) ?? []).filter((c) => c.id !== id)));
        if (connectionId === id) select(null, null);
      } catch (error) {
        setConnections((prev) => asyncError(messageOf(error), prev));
      }
    },
    [connectionId, getClient, select, setConnections],
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

  return {
    connect,
    addConnection,
    updateConnection,
    removeConnection,
    testConnection,
    discoverServers,
  };
}
