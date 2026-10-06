import type { PerchClient } from "@perch/client";
import type { DatabaseSchema } from "@perch/protocol";
import { asyncError, asyncIdle, asyncLoading, asyncReady, asyncRefreshing, type Async } from "@perch/ui";
import * as React from "react";
import { aborted, messageOf } from "./helpers";

export type SchemaApi = {
  schema: Async<DatabaseSchema>;
  /**
   * Re-introspects the current connection and database. Resolves once the fetch it asked for has
   * landed, loaded or failed, and never rejects; `refreshSchema` is the same function.
   */
  reintrospect: () => Promise<void>;
  refreshSchema: () => Promise<void>;
};

export function useSchema(
  getClient: () => PerchClient,
  enabled: boolean,
  connectionId: string | null,
  database: string | null,
): SchemaApi {
  // Staleness is a comparison, not a stored flag. A different database gets a skeleton, because
  // another database's tables would be a lie; the same one refetching stays up and reads stale.
  const schemaKey = connectionId && database ? `${connectionId}/${database}` : null;
  const [nonce, setNonce] = React.useState(0);
  const [loaded, setLoaded] = React.useState<{
    key: string;
    nonce: number;
    value: Async<DatabaseSchema>;
  } | null>(null);
  /** What the in-flight (or last) fetch was for, so a nonce bump can ask for `refresh=1`. */
  const fetching = React.useRef<{ key: string; nonce: number } | null>(null);
  /** The last nonce asked for; `nonce` catches up to it on the next render. */
  const requested = React.useRef(0);
  /**
   * Refreshes waiting to land, by the nonce each asked for. Two bumps in one tick render once and
   * fetch once, for the later nonce, so a landing settles every waiter at or below its nonce.
   */
  const waiters = React.useRef(new Map<number, (() => void)[]>());
  /** Once unmounted no fetch will ever land, so a late refresh resolves at once. */
  const mounted = React.useRef(false);

  const settle = React.useCallback((upTo: number): void => {
    for (const [target, resolvers] of waiters.current) {
      if (target > upTo) continue;
      waiters.current.delete(target);
      for (const resolve of resolvers) resolve();
    }
  }, []);

  React.useEffect(() => {
    // Nothing will be fetched, so nothing is coming for a waiter to wait on.
    if (!enabled || !schemaKey || !connectionId || !database) {
      settle(Number.POSITIVE_INFINITY);
      return;
    }
    const previous = fetching.current;
    // Only a bump on the same connection/database is a "refresh"; a new key has nothing cached.
    const refreshCache = previous?.key === schemaKey && previous.nonce !== nonce;
    fetching.current = { key: schemaKey, nonce };

    const controller = new AbortController();
    void getClient()
      .connections.schema(connectionId, {
        database,
        refresh: refreshCache,
        signal: controller.signal,
      })
      .then((value) => {
        if (controller.signal.aborted) return;
        setLoaded({ key: schemaKey, nonce, value: asyncReady(value) });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || aborted(error)) return;
        setLoaded((prev) => ({
          key: schemaKey,
          nonce,
          value: asyncError(messageOf(error), prev?.key === schemaKey ? prev.value : undefined),
        }));
      });
    return () => controller.abort();
  }, [enabled, schemaKey, connectionId, database, nonce, getClient, settle]);

  // After the commit rather than beside `setLoaded`, so an awaiting caller's next render already
  // holds the schema it waited for.
  React.useEffect(() => {
    if (loaded) settle(loaded.nonce);
  }, [loaded, settle]);

  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      settle(Number.POSITIVE_INFINITY);
    };
  }, [settle]);

  const schema = React.useMemo<Async<DatabaseSchema>>(() => {
    if (!schemaKey) return asyncIdle;
    if (!loaded || loaded.key !== schemaKey) return asyncLoading;
    if (loaded.nonce !== nonce) return asyncRefreshing(loaded.value);
    return loaded.value;
  }, [schemaKey, loaded, nonce]);

  const reintrospect = React.useCallback((): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    const target = ++requested.current;
    const landed = new Promise<void>((resolve) => {
      waiters.current.set(target, [...(waiters.current.get(target) ?? []), resolve]);
    });
    setNonce(target);
    return landed;
  }, []);

  return { schema, reintrospect, refreshSchema: reintrospect };
}
