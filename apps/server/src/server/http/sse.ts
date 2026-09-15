// Server-sent events framing. Every ServerEvent goes out as `event: <type>` with the JSON
// payload; a `: ping` comment on an interval keeps proxies and browsers from deciding the
// connection died. Detection itself is push-based (see services/watcher.ts) — the ping is pure
// keep-alive.

import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import type { ServerEvent } from "@perch/protocol";

/** SSE keep-alive comment interval. Proxies and browsers drop a stream that says nothing. */
export const SSE_PING_MS = 25_000;

export type SseSession = {
  /** Queues one event. Frames can never interleave; a no-op once the stream has ended. */
  send(event: ServerEvent): void;
  /** Ends the stream. Stable identity, so it can be held in a set of open streams. */
  end(): void;
  /** Registers a teardown callback run exactly once when the stream ends. */
  onClose(fn: () => void): void;
};

export function streamServerEvents(
  c: Context,
  setup: (session: SseSession) => void | Promise<void>,
  opts: { pingMs?: number } = {},
): Response {
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (sse) => {
    let done = false;
    // Chained so two events can never interleave inside one frame.
    let writes: Promise<unknown> = Promise.resolve();
    const cleanups: (() => void)[] = [];

    let finish = (): void => {};
    const ended = new Promise<void>((resolve) => {
      finish = () => {
        if (done) return;
        done = true;
        for (const fn of cleanups.splice(0)) {
          try {
            fn();
          } catch {
            /* a teardown callback must never strand the stream */
          }
        }
        clearInterval(ping);
        resolve();
      };
    });

    const session: SseSession = {
      send(event: ServerEvent): void {
        if (done) return;
        writes = writes
          .then(() => sse.writeSSE({ event: event.type, data: JSON.stringify(event) }))
          .catch(() => {
            done = true; // the client went away mid-write
          });
      },
      end: () => finish(),
      onClose(fn: () => void): void {
        cleanups.push(fn);
      },
    };

    const ping = setInterval(() => {
      if (done) return;
      writes = writes.then(() => sse.write(": ping\n\n")).catch(() => {
        done = true;
      });
    }, opts.pingMs ?? SSE_PING_MS);
    ping.unref();
    sse.onAbort(finish);
    c.req.raw.signal.addEventListener("abort", finish, { once: true });

    await setup(session);
    await ended;
    await writes;
  });
}
