// /api/settings — read and patch settings.json. Changing `workspaces` re-roots the watcher and
// tells every connected UI about the new roots.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Hono } from "hono";
import type { Settings } from "@perch/protocol";
import { defaultQueriesDir, getSettings, saveSettings } from "../../storage/index.js";
import { bool, num, readJsonBody, str } from "../http/body.js";
import { badRequest } from "../http/errors.js";
import type { RouteDeps } from "../create-server.js";

/**
 * A workspace root has to be a directory that exists, because every other failure it causes is
 * reported somewhere far away from the typo that caused it: the file list is empty, the watcher
 * has nothing to watch, and saving a file fails with a path error. Checking here turns all of
 * that into one message next to the field.
 */
/** How many folders the "Recent" list remembers. A short list you scan beats a long one you read. */
const RECENT_MAX = 10;

/** Newest first, no duplicates, capped. */
function recents(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())].slice(0, RECENT_MAX);
}

async function checkRoots(roots: readonly string[]): Promise<void> {
  for (const root of roots) {
    if (!path.isAbsolute(root)) {
      throw badRequest(`Workspace path must be absolute: ${root}`);
    }
    // perch's own queries folder is perch's to make. Refusing to open it because it is not there
    // yet would be refusing to do the one thing that creates it.
    if (path.resolve(root) === path.resolve(defaultQueriesDir())) {
      await fs.mkdir(root, { recursive: true, mode: 0o700 });
    }
    let stat;
    try {
      stat = await fs.stat(root);
    } catch {
      throw badRequest(`No such folder: ${root}`);
    }
    if (!stat.isDirectory()) throw badRequest(`Not a folder: ${root}`);
  }
}

export function registerSettingsRoutes(app: Hono, deps: RouteDeps): void {
  app.get("/api/settings", async (c) => c.json(await getSettings()));

  app.put("/api/settings", async (c) => {
    const body = await readJsonBody(c);
    const patch: Partial<Settings> = {};
    if (bool(body.autosave) !== undefined) patch.autosave = bool(body.autosave);
    if (num(body.autosaveDelayMs) !== undefined) patch.autosaveDelayMs = num(body.autosaveDelayMs);
    if (num(body.maxRows) !== undefined) patch.maxRows = num(body.maxRows);
    if (num(body.statementTimeoutMs) !== undefined) {
      patch.statementTimeoutMs = num(body.statementTimeoutMs);
    }
    if (Array.isArray(body.workspaces)) {
      const next = body.workspaces.filter((w): w is string => typeof w === "string");
      const current = await getSettings();
      // Only what is being added: an existing root whose folder has since been deleted should
      // still be removable, and re-saving unrelated settings should not fail because of it.
      const added = next.filter((root) => !current.workspaces.includes(root));
      await checkRoots(added);
      patch.workspaces = next;
      // Both ends of the change are worth remembering: a folder just opened, and one just closed
      // — the second is the one you will want back.
      const removed = current.workspaces.filter((root) => !next.includes(root));
      patch.recentWorkspaces = recents(added, removed, current.recentWorkspaces);
    }
    const theme = str(body.theme);
    if (theme === "dark" || theme === "light") patch.theme = theme;
    const keywordCase = str(body.keywordCase);
    if (keywordCase === "preserve" || keywordCase === "upper" || keywordCase === "lower") {
      patch.keywordCase = keywordCase;
    }
    if (bool(body.onboarded) !== undefined) patch.onboarded = bool(body.onboarded);
    const saved = await saveSettings(patch);
    if (patch.workspaces) {
      const roots = await deps.workspaceRoots();
      await deps.watcher?.setRoots(roots);
      deps.bus.emit({ type: "roots", roots });
    }
    return c.json(saved);
  });
}
