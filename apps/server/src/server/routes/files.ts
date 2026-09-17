// /api/files — workspace file access for the UI. Every client-supplied path goes through
// `deps.safePath`, which realpaths the roots and the target before anything touches the disk.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import type { FileEntry } from "@perch/protocol";
import { readJsonBody, str } from "../http/body.js";
import { conflict } from "../http/errors.js";
import {
  assertNotStale,
  entryFor,
  exists,
  listDir,
  readTextFile,
  writeSqlFile,
} from "../services/workspace-files.js";
import { safeFileName } from "../services/workspace-paths.js";
import type { RouteDeps } from "../create-server.js";

export function registerFilesRoutes(app: Hono, deps: RouteDeps): void {
  const { safePath, watcher, workspaceRoots } = deps;

  app.get("/api/files", async (c) => {
    const dir = c.req.query("dir");
    if (!dir) {
      // No dir given: hand back the workspace roots themselves.
      const entries: FileEntry[] = [];
      for (const root of await workspaceRoots()) {
        try {
          entries.push(await entryFor(root));
        } catch {
          /* a workspace that no longer exists */
        }
      }
      return c.json(entries);
    }
    return c.json(await listDir(await safePath(dir, "dir")));
  });

  app.get("/api/files/content", async (c) => {
    const full = await safePath(c.req.query("path"));
    const { content, modifiedAt } = await readTextFile(full);
    return c.json({ path: full, content, modifiedAt });
  });

  app.put("/api/files/content", async (c) => {
    const body = await readJsonBody(c);
    const full = await safePath(str(body.path));
    const content = typeof body.content === "string" ? body.content : "";
    const ifModifiedAt = str(body.ifModifiedAt);
    if (ifModifiedAt) {
      const stale = await assertNotStale(full, ifModifiedAt);
      if (stale) throw conflict("the file changed on disk since it was read", stale, "stale_write");
    }
    const modifiedAt = await writeSqlFile(full, content);
    // Our own write must not come back to the client as an external change.
    watcher?.expectWrite(full, modifiedAt);
    return c.json({ path: full, modifiedAt });
  });

  app.post("/api/files", async (c) => {
    const body = await readJsonBody(c);
    const dir = await safePath(str(body.dir), "dir");
    const name = safeFileName(String(body.name ?? ""));
    const full = await safePath(path.join(dir, name));
    if (await exists(full)) throw conflict(`${name} already exists`);
    const modifiedAt = await writeSqlFile(full, "");
    watcher?.expectWrite(full, modifiedAt);
    return c.json(await entryFor(full), 201);
  });

  app.post("/api/files/rename", async (c) => {
    const body = await readJsonBody(c);
    const full = await safePath(str(body.path));
    const name = safeFileName(String(body.name ?? ""));
    const target = await safePath(path.join(path.dirname(full), name));
    if (target !== full && (await exists(target))) throw conflict(`${name} already exists`);
    const { content } = await readTextFile(full);
    if (target !== full) watcher?.expectDelete(full);
    const modifiedAt = await writeSqlFile(target, content);
    watcher?.expectWrite(target, modifiedAt);
    if (target !== full) await fs.rm(full, { force: true });
    return c.json(await entryFor(target));
  });

  app.delete("/api/files", async (c) => {
    const full = await safePath(c.req.query("path"));
    watcher?.expectDelete(full);
    await fs.rm(full, { force: true });
    return c.json({ ok: true });
  });
}
