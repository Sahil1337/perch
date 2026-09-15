// GET /api/events — one long-lived SSE stream per UI, carrying file changes, finished runs and
// workspace-root changes.

import type { Hono } from "hono";
import { streamServerEvents } from "../http/sse.js";
import type { RouteDeps } from "../create-server.js";

export function registerEventsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/events", (c) =>
    streamServerEvents(c, async (session) => {
      session.onClose(deps.bus.subscribe(session.send));
      deps.openStreams.add(session.end);
      session.onClose(() => deps.openStreams.delete(session.end));

      session.send({ type: "hello", serverStartedAt: deps.startedAt });
      session.send({ type: "roots", roots: await deps.workspaceRoots() });
    }),
  );
}
