// GET /api/health — the one public route. Also what `perch status` polls to decide whether the
// server in server.json is still alive.

import type { Hono } from "hono";
import type { ServerInfo } from "@perch/protocol";
import { configDir, defaultQueriesDir } from "../../storage/index.js";
import type { RouteDeps } from "../create-server.js";

export function registerHealthRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/health", (c) => {
    const info: ServerInfo = {
      name: "perch",
      version: deps.version,
      pid: process.pid,
      url: deps.url ?? new URL(c.req.url).origin,
      startedAt: deps.startedAt,
      configDir: configDir(),
      queriesDir: defaultQueriesDir(),
    };
    return c.json(info);
  });
}
