// GET /api/browse?path=… — folders under a path, for the workspace picker.

import type { Hono } from "hono";
import { browseDirectory } from "../services/browse.js";

export function registerBrowseRoutes(app: Hono): void {
  app.get("/api/browse", async (c) => c.json(await browseDirectory(c.req.query("path"))));
}
