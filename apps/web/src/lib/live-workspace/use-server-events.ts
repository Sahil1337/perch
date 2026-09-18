import type { PerchClient } from "@perch/client";
import type { ServerEvent } from "@perch/protocol";
import * as React from "react";
import { RECONNECT_MAX_MS, RECONNECT_MIN_MS, sleep } from "./helpers";
import { useAbortable } from "./use-async-resource";

export function useServerEvents(
  getClient: () => PerchClient,
  enabled: boolean,
  onEvent: (event: ServerEvent) => void,
): void {
  // Held in a ref so the subscription below is opened once and not torn down on every keystroke.
  const handler = React.useRef(onEvent);
  React.useEffect(() => {
    handler.current = onEvent;
  }, [onEvent]);

  const subscribe = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      let delay = RECONNECT_MIN_MS;
      while (!signal.aborted) {
        try {
          for await (const event of getClient().events({ signal })) {
            delay = RECONNECT_MIN_MS; // a frame arrived, so the connection is healthy again
            handler.current(event);
          }
        } catch {
          /* the stream dropped — a restarted server, a sleeping laptop, a proxy timeout */
        }
        if (signal.aborted) return;
        await sleep(delay, signal);
        delay = Math.min(delay * 2, RECONNECT_MAX_MS);
      }
    },
    [getClient],
  );

  useAbortable(enabled, subscribe);
}
