import type { PerchClient } from "@perch/client";
import type { DatabaseSchema } from "@perch/protocol";
import { asyncError, asyncIdle, asyncLoading, asyncReady, asyncRefreshing, type Async } from "@perch/ui";
import * as React from "react";
import { aborted, messageOf } from "./helpers";

export type SchemaApi = {
  schema: Async<DatabaseSchema>;
  /** Re-introspects the current connection and database. */
  reintrospect: () => void;
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

  React.useEffect(() => {
    if (!enabled || !schemaKey || !connectionId || !database) return;
    const previous = fetching.current;
    // Only a bump on the same connection/database is a "refresh"; a new key has nothing cached.
    const refreshCache = previous?.key === schemaKey && previous.nonce !== nonce;
    fetching.current = { key: schemaKey, nonce };

    const controller = new AbortController();
    void (async () => {
      try {
        const value = await getClient().connections.schema(connectionId, {
          database,
          refresh: refreshCache,
          signal: controller.signal,
        });
        setLoaded({ key: schemaKey, nonce, value: asyncReady(value) });
      } catch (error) {
        if (aborted(error)) return;
        setLoaded((prev) => ({
          key: schemaKey,
          nonce,
          value: asyncError(messageOf(error), prev?.key === schemaKey ? prev.value : undefined),
        }));
      }
    })();
    return () => controller.abort();
  }, [enabled, schemaKey, connectionId, database, nonce, getClient]);

  const schema = React.useMemo<Async<DatabaseSchema>>(() => {
    if (!schemaKey) return asyncIdle;
    if (!loaded || loaded.key !== schemaKey) return asyncLoading;
    if (loaded.nonce !== nonce) return asyncRefreshing(loaded.value);
    return loaded.value;
  }, [schemaKey, loaded, nonce]);

  const reintrospect = React.useCallback((): void => setNonce((n) => n + 1), []);
  const refreshSchema = React.useCallback(async (): Promise<void> => setNonce((n) => n + 1), []);

  return { schema, reintrospect, refreshSchema };
}
