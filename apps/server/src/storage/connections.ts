// connections.json — the saved connection list, written 0600 because it may hold passwords.

import { randomUUID } from "node:crypto";
import { type ConnectionConfig } from "@perch/protocol";
import { CONNECTIONS_FILE } from "./paths.js";
import { JsonStore } from "./json-file.js";

/** 0600: this is the one file perch writes that can hold a password. */
const store = new JsonStore<ConnectionConfig[]>(CONNECTIONS_FILE, () => [], 0o600);

/**
 * The connection without its password — the shape both the API's ConnectionSummary and the CLI's
 * `--json` output are built from. Secrets never leave this module by accident.
 */
export function redactConnection(config: ConnectionConfig): Omit<ConnectionConfig, "password"> {
  const rest: Partial<ConnectionConfig> = { ...config };
  delete rest.password;
  return rest as Omit<ConnectionConfig, "password">;
}

export const listConnections = (): Promise<ConnectionConfig[]> => store.read();

export const saveConnections = (list: ConnectionConfig[]): Promise<void> => store.write(list);

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
