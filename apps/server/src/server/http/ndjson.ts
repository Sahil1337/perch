// NDJSON response framing: one JSON value per line, flushed in order, with the headers that stop
// proxies from buffering the stream. `POST /api/query` is the only caller today.

import type { Context } from "hono";
import { stream } from "hono/streaming";

export type NdjsonWriter = {
  /** Queues one line. Silently dropped once the client has gone away. */
  write(value: unknown): void;
  /** True once the client disconnected. */
  readonly aborted: boolean;
};

export function ndjsonHeaders(c: Context): void {
  c.header("Content-Type", "application/x-ndjson; charset=utf-8");
  c.header("Cache-Control", "no-cache, no-transform");
  c.header("X-Accel-Buffering", "no");
}

/**
 * Runs `body` with a writer whose lines cannot interleave (every write is chained onto the last)
 * and waits for the queue to drain before the response ends. `onAbort` fires once if the client
 * disconnects first — both Hono's own signal and the raw request signal are watched, because
 * only one of the two fires depending on how the response is being consumed.
 */
export function streamNdjson(
  c: Context,
  body: (out: NdjsonWriter) => Promise<void>,
  onAbort?: () => void,
): Response {
  ndjsonHeaders(c);
  return stream(c, async (s) => {
    let aborted = false;
    let writes: Promise<unknown> = Promise.resolve();
    const abort = (): void => {
      if (aborted) return;
      aborted = true;
      onAbort?.();
    };
    const out: NdjsonWriter = {
      write(value: unknown): void {
        if (aborted) return;
        writes = writes.then(() => s.write(JSON.stringify(value) + "\n"));
      },
      get aborted(): boolean {
        return aborted;
      },
    };
    s.onAbort(abort);
    c.req.raw.signal.addEventListener("abort", abort, { once: true });
    await body(out);
    await writes;
  });
}
