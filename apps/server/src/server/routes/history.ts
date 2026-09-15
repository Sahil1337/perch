// GET /api/history — the on-disk run log (history.jsonl), newest first.

import type { Hono } from "hono";
import { readHistory } from "../../storage/index.js";
import { num } from "../http/body.js";
import type { RouteDeps } from "../create-server.js";

export function registerHistoryRoutes(app: Hono, _deps: RouteDeps): void {
  app.get("/api/history", async (c) => {
    const limit = num(c.req.query("limit")) ?? 50;
    const connectionId = c.req.query("connectionId") || undefined;
    return c.json(await readHistory(Math.max(1, Math.min(1000, limit)), connectionId));
  });
}
