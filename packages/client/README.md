# @perch/client

The typed HTTP client for the `perch` server. **This is the only module in a frontend allowed to
know the server exists** — components take data and callbacks, never a URL or a `fetch`.
Browser-safe: no `node:` imports, no Node globals, and zero runtime dependencies (`@perch/protocol`
is types only and erases at compile time).

```ts
import { createClient, type RunEvent } from "@perch/client";

const client = createClient({ baseUrl: "http://127.0.0.1:4600" });

for await (const event of client.query.run({ connectionId, sql: "select 1" })) {
  if (event.type === "rows") append(event.rows);
  if (event.type === "error") show(event.error);
}
```

- `health()`, `connections`, `query` (`run` / `runSync`), `runs`, `history`, `settings`, `files`,
  and `events()` for the SSE stream. Every method takes an optional `{ signal }`.
- `createClient` accepts an injectable `fetch`, for tests and for a Tauri build.
- Non-2xx replies reject with a `PerchError` carrying `status`, `code`, `route` and the parsed
  `body`; `staleWrite(err)` pulls the current file out of a 409 from `files.write`.
- `runs.exportUrl(id)` is a URL, not a fetch: a download has to be a browser navigation.
- Protocol types are re-exported, so `import type { RunEvent } from "@perch/client"` is enough.

From the repo root: `bun run --filter @perch/client test`, `bun run --filter @perch/client typecheck`.
