// The non-/api surface: the built UI mounted as static assets with an SPA fallback, or — when no
// bundle is installed — a one-page placeholder listing the API. Registered last, because both
// halves end in a `*` route.

import { existsSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Hono } from "hono";
import type { RouteDeps } from "../create-server.js";


export function registerUiRoutes(app: Hono, deps: RouteDeps): void {
  const uiDir = deps.uiDir && existsSync(deps.uiDir) ? path.resolve(deps.uiDir) : undefined;
  if (uiDir) {
    const assets = serveStatic({ root: uiDir });
    const indexHtml = serveStatic({ path: "index.html", root: uiDir });
    app.use("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      return assets(c, next);
    });
    // SPA fallback: any unmatched GET renders the shell.
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      return indexHtml(c, next);
    });
  } else {
    // No UI shipped next to this build: say so plainly rather than render a stand-in page.
    app.get("/", (c) =>
      c.text("perch UI is not built. Run `bun run --filter @perch/web build`, then restart perch.", 503),
    );
  }
}
