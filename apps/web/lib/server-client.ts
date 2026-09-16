// The one place in the app that constructs a `@perch/client`.
//
// Two deployments have to work from the same bundle, and neither needs anything from this module
// beyond an origin:
//
//   **served by `perch serve`** — the static export is mounted at `/`, so the API is same-origin and
//   `serverBaseUrl()` is just the page's own origin.
//
//   **`next dev` on :3001 against the server on :4600** — different origins, so
//   `NEXT_PUBLIC_PERCH_URL` points at the server and `perch serve --allow-origin` lets the browser
//   read it. There is no credential either way: the server has no auth, and loopback is the
//   boundary.
//
// The client is built lazily and memoised: the static export prerenders this module in Node, where
// `window.location.origin` does not exist, and a client built then would cache the wrong base URL.

import { createClient, type PerchClient } from "@perch/client";

/** Same origin as the page unless the dev override says otherwise. */
export function serverBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_PERCH_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return typeof window === "undefined" ? "" : window.location.origin;
}

let client: PerchClient | undefined;

/** The shared client. One instance, so the SSE stream and every request agree on the base URL. */
export function serverClient(): PerchClient {
  if (client) return client;
  client = createClient({ baseUrl: serverBaseUrl() });
  return client;
}
