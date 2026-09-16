// Line-oriented reading of a response body. A chunk boundary can land anywhere — mid-line, or
// mid multi-byte character — so the decoder runs in streaming mode and whatever follows the last
// newline stays in `buffer` until the chunk that completes it arrives.

/** Yields one line at a time, without its terminator. A final line without a "\n" still counts. */
export async function* readLines(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  // The server has no way to be told "stop mid-line": dropping the reader is what ends the run.
  const onAbort = (): void => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  let buffer = "";
  try {
    signal?.throwIfAborted();
    for (;;) {
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        newline = buffer.indexOf("\n");
      }
    }
    buffer += decoder.decode(); // flush a dangling multi-byte sequence
    if (buffer !== "") yield buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    // Also reached when the consumer `break`s out of a `for await`, which is how a UI cancels a
    // run: closing the body makes the server see a disconnect and cancel the query.
    await reader.cancel().catch(() => {});
  }
}

/** The NDJSON stream from `POST /api/query`: one JSON value per line, blank lines ignored. */
export async function* readNdjson<T>(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<T> {
  for await (const line of readLines(stream, signal)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    yield JSON.parse(trimmed) as T;
  }
}
