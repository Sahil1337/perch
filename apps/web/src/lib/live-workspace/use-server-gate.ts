// Whether the server answers at all. `GET /api/health` decides between `ready` and `unreachable`,
// re-probing on a 1s→10s backoff so a server started a minute later is picked up without a reload.
// Nothing else is requested until it is `ready`, so eleven panels cannot each render their own copy
// of the same failure.

import type { PerchClient } from "@perch/client";
import type { ServerState, ServerStatus } from "@perch/ui";
import * as React from "react";
import { serverBaseUrl } from "../server-client";
import { aborted, RECONNECT_MAX_MS, RECONNECT_MIN_MS, sleep } from "./helpers";

export function useServerGate(
  getClient: () => PerchClient,
  injected: PerchClient | undefined,
): { server: ServerState; enabled: boolean } {
  const [status, setStatus] = React.useState<ServerStatus>("connecting");
  /** From the health reply: perch's own queries folder, for "save this untitled query". */
  const [queriesDir, setQueriesDir] = React.useState<string | null>(null);
  /** Bumped by `retry()` to restart the probe loop from its shortest delay. */
  const [probeNonce, setProbeNonce] = React.useState(0);

  // `probing`, not `status`, or settling to `unreachable` restarts the loop and resets the
  // backoff to zero on every failure — a hot spin against a port nobody is listening on.
  const probing = status === "connecting" || status === "unreachable";
  React.useEffect(() => {
    if (!probing) return;
    const controller = new AbortController();
    const { signal } = controller;
    // Chained rather than a `while` + `await`, so every state write sits behind its own
    // `signal.aborted` check: the probe in flight when the gate closes must not land.
    const probe = (delay: number): void => {
      void getClient()
        .health({ signal })
        .then((info) => {
          if (signal.aborted) return;
          setQueriesDir(info.queriesDir ?? null);
          setStatus("ready");
        })
        .catch((error: unknown) => {
          if (signal.aborted || aborted(error)) return;
          setStatus("unreachable");
          void sleep(delay, signal).then(() => {
            if (!signal.aborted) probe(Math.min(delay * 2, RECONNECT_MAX_MS));
          });
        });
    };
    probe(RECONNECT_MIN_MS);
    return () => controller.abort();
  }, [probing, probeNonce, getClient]);

  const retry = React.useCallback((): void => {
    setStatus((previous) => (previous === "ready" ? previous : "connecting"));
    setProbeNonce((n) => n + 1);
  }, []);

  const server = React.useMemo<ServerState>(
    // Building a client during render to read its `baseUrl` is not allowed; this is the same answer.
    () => ({ status, url: injected?.baseUrl ?? serverBaseUrl(), retry, queriesDir }),
    [status, injected, retry, queriesDir],
  );

  return { server, enabled: status === "ready" };
}
