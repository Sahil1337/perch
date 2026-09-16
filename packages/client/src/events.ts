import type { ServerEvent } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";
import { readSse } from "./sse";

/** One long-lived subscription to GET /api/events. See sse.ts for why EventSource is out. */
export type EventsApi = (opts?: CallOptions) => AsyncIterable<ServerEvent>;

export function eventsApi(http: Transport): EventsApi {
  return function events(opts: CallOptions = {}): AsyncIterable<ServerEvent> {
    return (async function* stream(): AsyncGenerator<ServerEvent> {
      const response = await http.send("/api/events", {
        accept: "text/event-stream",
        signal: opts.signal,
      });
      if (!response.body) return;
      yield* readSse<ServerEvent>(response.body, opts.signal);
    })();
  };
}
