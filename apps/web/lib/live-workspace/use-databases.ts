"use client";

// Which databases the current connection has.
//
// Two sources, in order of cost: the connection summary already carries the list for a server that
// has been dialled, and only when it does not is there a request. The fetch is keyed by connection
// id rather than replaced wholesale, so a list that arrives after the user has moved on is
// recognisably not about the connection now on screen.

import type { PerchClient } from "@perch/client";
import { asyncError, asyncIdle, asyncLoading, asyncReady, type Async } from "@perch/ui";
import * as React from "react";
import { aborted, messageOf } from "./helpers";

export function useDatabases(
  getClient: () => PerchClient,
  enabled: boolean,
  connectionId: string | null,
  /** What the connection summary already knows, when it has been dialled. */
  summaryDatabases: readonly string[] | undefined,
): Async<readonly string[]> {
  const [fetched, setFetched] = React.useState<{
    connectionId: string;
    value: Async<readonly string[]>;
  } | null>(null);

  React.useEffect(() => {
    if (!enabled || !connectionId || summaryDatabases) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const list = await getClient().connections.databases(connectionId, {
          signal: controller.signal,
        });
        setFetched({ connectionId, value: asyncReady(list) });
      } catch (error) {
        if (aborted(error)) return;
        setFetched({ connectionId, value: asyncError(messageOf(error)) });
      }
    })();
    return () => controller.abort();
  }, [enabled, connectionId, summaryDatabases, getClient]);

  return React.useMemo<Async<readonly string[]>>(() => {
    if (!connectionId) return asyncIdle;
    if (summaryDatabases) return asyncReady(summaryDatabases);
    if (fetched?.connectionId === connectionId) return fetched.value;
    return asyncLoading;
  }, [connectionId, summaryDatabases, fetched]);
}
