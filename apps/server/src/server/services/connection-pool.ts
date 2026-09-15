// Live drivers keyed by connection id: the one piece of shared mutable state the API keeps about
// databases. A driver is created and connected lazily on first use and stays until the connection
// is edited, disconnected or the server shuts down.

import { getConnection, listConnections, redactConnection } from "../../storage/index.js";
import type {
  ConnectionConfig,
  ConnectionStatus,
  ConnectionSummary,
  DatabaseSchema,
} from "@perch/protocol";
import type { Driver } from "../../db/driver.js";
import { badRequest, errorMessage, notFound } from "../http/errors.js";
import { DEFAULT_SCHEMA_TTL_MS, SchemaCache } from "./schema-cache.js";

export type CreateDriver = (config: ConnectionConfig) => Driver;

export type ConnectionPoolOptions = {
  /** Injected by an embedder or a test rig; otherwise `../db` is imported lazily on first use. */
  createDriver?: CreateDriver;
  /** Schema cache lifetime per connection+database. */
  schemaTtlMs?: number;
};

type Entry = {
  config: ConnectionConfig;
  driver: Driver;
  status: ConnectionStatus;
  error?: string;
  databases?: string[];
};

export class ConnectionPool {
  readonly schemaTtlMs: number;
  private createDriver: CreateDriver | undefined;
  private readonly entries = new Map<string, Entry>();
  private readonly schemaCache: SchemaCache;

  constructor(opts: ConnectionPoolOptions = {}) {
    this.createDriver = opts.createDriver;
    this.schemaTtlMs = opts.schemaTtlMs ?? DEFAULT_SCHEMA_TTL_MS;
    this.schemaCache = new SchemaCache(this.schemaTtlMs);
  }

  async config(idOrName: string): Promise<ConnectionConfig> {
    const config = await getConnection(idOrName);
    if (!config) throw notFound(`no such connection: ${idOrName}`);
    return config;
  }

  private async factory(): Promise<CreateDriver> {
    if (!this.createDriver) {
      const mod = await import("../../db/index.js");
      this.createDriver = mod.createDriver;
    }
    return this.createDriver;
  }

  private async entry(config: ConnectionConfig): Promise<Entry> {
    const existing = this.entries.get(config.id);
    if (existing) {
      existing.config = config;
      return existing;
    }
    const driver = (await this.factory())(config);
    const entry: Entry = { config, driver, status: "disconnected" };
    this.entries.set(config.id, entry);
    return entry;
  }

  /** Returns a connected driver, creating and connecting it lazily on first use. */
  async driverFor(idOrName: string): Promise<Driver> {
    const entry = await this.entry(await this.config(idOrName));
    if (!entry.driver.isConnected()) {
      try {
        await entry.driver.connect();
        entry.status = "connected";
        delete entry.error;
      } catch (err) {
        entry.status = "error";
        entry.error = errorMessage(err);
        throw badRequest(entry.error, "connect_failed");
      }
    } else {
      entry.status = "connected";
    }
    return entry.driver;
  }

  summary(config: ConnectionConfig): ConnectionSummary {
    const entry = this.entries.get(config.id);
    const connected = entry?.driver.isConnected() ?? false;
    const status: ConnectionStatus = connected
      ? "connected"
      : entry?.status === "error"
        ? "error"
        : "disconnected";
    const summary: ConnectionSummary = { ...redactConnection(config), status };
    if (entry?.error) summary.error = entry.error;
    if (connected && entry?.databases) summary.databases = entry.databases;
    return summary;
  }

  async summaries(): Promise<ConnectionSummary[]> {
    return (await listConnections()).map((config) => this.summary(config));
  }

  async connect(idOrName: string): Promise<ConnectionSummary> {
    const config = await this.config(idOrName);
    await this.driverFor(config.id);
    const entry = this.entries.get(config.id);
    if (entry) {
      try {
        entry.databases = await entry.driver.listDatabases();
      } catch {
        /* not every server lets us enumerate databases; the connection is still usable */
      }
    }
    return this.summary(config);
  }

  async disconnect(idOrName: string): Promise<ConnectionSummary> {
    const config = await this.config(idOrName);
    const entry = this.entries.get(config.id);
    if (entry) {
      try {
        await entry.driver.disconnect();
      } finally {
        entry.status = "disconnected";
        delete entry.databases;
        delete entry.error;
      }
    }
    this.schemaCache.dropConnection(config.id);
    return this.summary(config);
  }

  /** Forgets any live driver for a connection — call after its config changes or it is deleted. */
  async forget(connectionId: string): Promise<void> {
    const entry = this.entries.get(connectionId);
    this.entries.delete(connectionId);
    this.schemaCache.dropConnection(connectionId);
    if (entry) {
      try {
        await entry.driver.disconnect();
      } catch {
        /* going away anyway */
      }
    }
  }

  async test(idOrName: string): Promise<{ serverVersion: string; latencyMs: number }> {
    const driver = await this.driverFor(idOrName);
    try {
      return await driver.test();
    } catch (err) {
      throw badRequest(errorMessage(err), "test_failed");
    }
  }

  async databases(idOrName: string): Promise<string[]> {
    const config = await this.config(idOrName);
    const driver = await this.driverFor(config.id);
    const databases = await driver.listDatabases();
    const entry = this.entries.get(config.id);
    if (entry) entry.databases = databases;
    return databases;
  }

  async getSchema(idOrName: string, database?: string, refresh = false): Promise<DatabaseSchema> {
    const config = await this.config(idOrName);
    if (!refresh) {
      const hit = this.schemaCache.get(config.id, database);
      if (hit) return hit;
    }
    const driver = await this.driverFor(config.id);
    const schema = await driver.getSchema(database);
    this.schemaCache.set(config.id, database, schema);
    return schema;
  }

  /** Disconnects every live driver (used on shutdown). */
  async shutdown(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    this.schemaCache.clear();
    await Promise.all(
      entries.map(async (entry) => {
        try {
          await entry.driver.disconnect();
        } catch {
          /* shutting down */
        }
      }),
    );
  }
}
