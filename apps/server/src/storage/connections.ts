// connections.json — the saved connection list, written 0600 because it may hold passwords.

import path from "node:path";
import { randomUUID } from "node:crypto";
import { type ConnectionConfig } from "@perch/protocol";
import { CONNECTIONS_FILE, ensureDir } from "./paths.js";
import { readJson, writeJsonAtomic } from "./json-file.js";

/**
 * The connection without its password — the shape both the API's ConnectionSummary and the CLI's
 * `--json` output are built from. Secrets never leave this module by accident.
 */
export function redactConnection(config: ConnectionConfig): Omit<ConnectionConfig, "password"> {
  const rest: Partial<ConnectionConfig> = { ...config };
  delete rest.password;
  return rest as Omit<ConnectionConfig, "password">;
}

export async function listConnections(): Promise<ConnectionConfig[]> {
  const dir = await ensureDir();
  return readJson<ConnectionConfig[]>(path.join(dir, CONNECTIONS_FILE), []);
}

export async function saveConnections(list: ConnectionConfig[]): Promise<void> {
  const dir = await ensureDir();
  await writeJsonAtomic(path.join(dir, CONNECTIONS_FILE), list, 0o600);
}

export async function getConnection(idOrName: string): Promise<ConnectionConfig | undefined> {
  const list = await listConnections();
  return list.find((c) => c.id === idOrName) ?? list.find((c) => c.name === idOrName);
}

export async function upsertConnection(
  input: Omit<ConnectionConfig, "id" | "createdAt"> & { id?: string },
): Promise<ConnectionConfig> {
  const list = await listConnections();
  const existing = input.id ? list.find((c) => c.id === input.id) : undefined;
  const record: ConnectionConfig = {
    ...(existing ?? { id: randomUUID(), createdAt: new Date().toISOString() }),
    ...input,
    id: existing?.id ?? input.id ?? randomUUID(),
  };
  const next = existing ? list.map((c) => (c.id === record.id ? record : c)) : [...list, record];
  await saveConnections(next);
  return record;
}

export async function removeConnection(idOrName: string): Promise<boolean> {
  const list = await listConnections();
  const next = list.filter((c) => c.id !== idOrName && c.name !== idOrName);
  if (next.length === list.length) return false;
  await saveConnections(next);
  return true;
}
