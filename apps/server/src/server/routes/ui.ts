// The non-/api surface: the built UI mounted as static assets with an SPA fallback, or — when no
// bundle is installed — a one-page placeholder listing the API. Registered last, because both
// halves end in a `*` route.
//
// Two mounts, because the bundle reaches us two ways. An installed package has ui/ next to dist/
// and serveStatic reads it off disk; a `bun build --compile` binary has no directory to read, only
// the files embedded in the executable (see util/embedded-ui). A directory that exists wins: it is
// either what the user named with --ui or a build sitting right there, and both are more current
// than whatever was embedded whenever the binary was cut.

import { existsSync } from "node:fs";
import path from "node:path";
import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, Hono } from "hono";
import { embeddedUiFile, hasEmbeddedUi } from "../../util/embedded-ui.js";
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
  } else if (hasEmbeddedUi()) {
    registerEmbeddedUiRoutes(app);
  } else {
    // No UI shipped next to this build: say so plainly rather than render a stand-in page.
    app.get("/", (c) =>
      c.text(
        "perch UI is not built. Run `bun run --filter @perch/web build`, then restart perch.",
        503,
      ),
    );
  }
}

/**
 * The request path as a key into the embedded manifest, which is keyed exactly as the files sat on
 * disk. A static file server answers a directory with its index.html and the manifest has no
 * directories at all, so that rewrite happens here instead.
 */
function embeddedKey(pathname: string): string {
  let key: string;
  try {
    key = decodeURIComponent(pathname);
  } catch {
    key = pathname; // a malformed escape is not a file either; let the lookup miss
  }
  key = key.replace(/^\/+/, "");
  return key === "" || key.endsWith("/") ? `${key}index.html` : key;
}

async function sendEmbedded(c: Context, file: Blob): Promise<Response> {
  const bytes = await file.arrayBuffer();
  // file.type is what Bun resolved from the extension at compile time; the fallback is for a file
  // whose extension it had no mapping for, where a guess would be worse than "some bytes".
  return c.body(bytes, 200, { "Content-Type": file.type || "application/octet-stream" });
}

/** The disk mount's shape, file-for-file, over the manifest instead of a directory. */
function registerEmbeddedUiRoutes(app: Hono): void {
  app.use("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    const file = embeddedUiFile(embeddedKey(c.req.path));
    return file ? sendEmbedded(c, file) : next();
  });
  // SPA fallback: any unmatched GET renders the shell.
  app.get("*", async (c, next) => {
    if (c.req.path.startsWith("/api/")) return next();
    const shell = embeddedUiFile("index.html");
    return shell ? sendEmbedded(c, shell) : next();
  });
}
