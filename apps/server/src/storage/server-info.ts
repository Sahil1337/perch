// server.json — how `perch status` / `perch stop` find a running instance. 0600, like the other
// files here: nothing else needs to read where this machine's server is listening.

import { promises as fs } from "node:fs";
import path from "node:path";
import { type ServerInfo } from "@perch/protocol";
import { SERVER_INFO_FILE, configFile, ensureDir } from "./paths.js";
import { readJson, writeJsonAtomic } from "./json-file.js";

export async function writeServerInfo(info: ServerInfo): Promise<void> {
  const dir = await ensureDir();
  await writeJsonAtomic(path.join(dir, SERVER_INFO_FILE), info, 0o600);
}

export async function readServerInfo(): Promise<ServerInfo | undefined> {
  const dir = await ensureDir();
  return readJson<ServerInfo | undefined>(path.join(dir, SERVER_INFO_FILE), undefined);
}

export async function clearServerInfo(): Promise<void> {
  try {
    await fs.unlink(configFile(SERVER_INFO_FILE));
  } catch {
    /* already gone */
  }
}
