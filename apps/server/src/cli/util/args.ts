// Turning the outside world into arguments: stdin, and the connection lookup every command that
// takes a <conn> positional has to do first.

import { createDriver } from "../../db/index.js";
import { getConnection } from "../../storage/index.js";
import type { ConnectionConfig } from "@perch/protocol";
import type { Driver } from "../../db/driver.js";
import { die } from "./errors.js";

/** Looks up a connection by name or id, or throws a CliError with a helpful message. */
export async function requireConnection(nameOrId: string): Promise<ConnectionConfig> {
  const conn = await getConnection(nameOrId);
  if (!conn) {
    die(
      `no connection named "${nameOrId}" — run "perch conn ls" to see connections, or "perch conn add" to create one`,
    );
  }
  return conn;
}

/** Connects a driver for `config`, runs `fn`, and always disconnects afterwards. */
export async function withDriver<T>(
  config: ConnectionConfig,
  fn: (driver: Driver) => Promise<T>,
): Promise<T> {
  const driver = createDriver(config);
  await driver.connect();
  try {
    return await fn(driver);
  } finally {
    await driver.disconnect().catch(() => {
      /* best-effort */
    });
  }
}

/** Reads all of stdin as a utf8 string. */
export async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Reads a single trimmed line from stdin (used for --password-stdin). */
export async function readStdinLine(): Promise<string> {
  const text = await readStdin();
  return (text.split(/\r?\n/)[0] ?? "").trim();
}
