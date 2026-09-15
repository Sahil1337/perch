// GET /api/connections/:id/schema — the introspected schema tree, served from the connection
// pool's TTL cache unless `?refresh=1` says otherwise.

import type { Hono } from "hono";
import type { RouteDeps } from "../create-server.js";

export function registerSchemaRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/connections/:id/schema", async (c) => {
    const database = c.req.query("database");
    const refresh = c.req.query("refresh") === "1" || c.req.query("refresh") === "true";
    return c.json(await deps.pool.getSchema(c.req.param("id"), database || undefined, refresh));
  });
}
