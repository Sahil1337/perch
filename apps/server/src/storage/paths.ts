// Where perch keeps everything on disk. One directory holds all of it (default ~/.perch, override
// with PERCH_HOME): connections.json (0600), settings.json, history.jsonl, server.json —
// plus queries/, the workspace folder created on first run. Nothing perch writes lives anywhere
// else.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export function configDir(): string {
  return process.env.PERCH_HOME ?? path.join(os.homedir(), ".perch");
}

/** The workspace root created on first run: ~/.perch/queries, where .sql files live by default. */
export function defaultQueriesDir(): string {
  return path.join(configDir(), "queries");
}

/** Creates perch home if it is missing and returns its path. */
export async function ensureDir(): Promise<string> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  return dir;
}

/** Absolute path of one file inside perch home. */
export function configFile(name: string): string {
  return path.join(configDir(), name);
}

export const CONNECTIONS_FILE = "connections.json";
export const SETTINGS_FILE = "settings.json";
export const HISTORY_FILE = "history.jsonl";
export const SERVER_INFO_FILE = "server.json";
