// GET /api/discover — the database servers this machine already has, so the UI can offer a
// connection instead of asking the user to type one. Served from the service's 30s memo unless
// `?rescan=1` says otherwise; the scan itself never fails, it just finds less.

import type { Hono } from "hono";
import type { RouteDeps } from "../create-server.js";

export function registerDiscoverRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/discover", async (c) => {
    const rescan = c.req.query("rescan");
    const force = rescan === "1" || rescan === "true";
    return c.json(await deps.discovery.scan({ force }));
  });
}
