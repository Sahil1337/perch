// Server-sent events, parsed by hand: the stream is read with fetch rather than EventSource, so it
// shares one transport (and one abort signal) with every other route. Frames are separated by a
// blank line; a `: ping` comment is keep-alive only.

import { readLines } from "./ndjson";

export async function* readSse<T>(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  let data: string[] = [];
  const flush = (): T | undefined => {
    const payload = data.join("\n");
    data = [];
    return payload === "" ? undefined : (JSON.parse(payload) as T);
  };

  for await (const line of readLines(stream, signal)) {
    if (line === "") {
      const event = flush();
      if (event !== undefined) yield event;
      continue;
    }
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? "" : line.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    // `event:` and `id:` are dropped: every ServerEvent already carries its own `type`.
    if (field === "data") data.push(value);
  }
  // A stream cut mid-frame leaves a complete payload behind more often than not.
  const last = flush();
  if (last !== undefined) yield last;
}
