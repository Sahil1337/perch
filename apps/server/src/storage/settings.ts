// settings.json — user preferences, merged over `defaultSettings` on every read.

import { promises as fs } from "node:fs";
import { type Settings } from "@perch/protocol";
import { SETTINGS_FILE, defaultQueriesDir } from "./paths.js";
import { JsonStore } from "./json-file.js";

const store = new JsonStore<Partial<Settings>>(SETTINGS_FILE, () => ({}));

export const defaultSettings: Settings = {
  autosave: true,
  autosaveDelayMs: 1200,
  maxRows: 1000,
  statementTimeoutMs: 0,
  workspaces: [],
  theme: "dark",
  keywordCase: "lower",
  onboarded: false,
  recentWorkspaces: [],
};

export async function getSettings(): Promise<Settings> {
  const stored = await store.read();
  // `system` was a third theme once. A settings.json written by that build is still on disk
  // somewhere, and nothing downstream knows what to paint for it, so anything that is not
  // `light` reads as the default rather than as a value the type says cannot exist.
  const theme = stored.theme === "light" ? "light" : defaultSettings.theme;
  return { ...defaultSettings, ...stored, theme };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await store.write(next);
  return next;
}

/**
 * First run: with no workspace, the file API, the watcher and the UI all have nothing to point at,
 * so perch creates ~/.perch/queries and adopts it as the only root. Called once at server start
 * (see server/start.ts) rather than from getSettings(), so a plain read of settings never has a
 * side effect and `perch serve --dir` simply appends to the root that is already there.
 */
export async function ensureDefaultWorkspace(): Promise<Settings> {
  // Made whether or not it is adopted as a root. perch offers this folder as the home for an
  // untitled query, and a machine that already had a workspace configured never created it — so
  // the one destination the save dialog can always offer was a path that did not exist.
  const dir = defaultQueriesDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const settings = await getSettings();
  if (settings.workspaces.length > 0) return settings;
  return saveSettings({ workspaces: [dir] });
}
