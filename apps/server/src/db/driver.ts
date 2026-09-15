// The contract every database driver implements. Server-internal: nothing here crosses the wire,
// so it lives beside the drivers rather than in @perch/protocol.

import type {
  ConnectionConfig,
  DatabaseSchema,
  Dialect,
  QueryOptions,
  RunEvent,
  RunStatus,
} from "@perch/protocol";

export interface Driver {
  readonly dialect: Dialect;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  /** Cheap round trip; throws with a readable message on failure. */
  test(): Promise<{ serverVersion: string; latencyMs: number }>;
  listDatabases(): Promise<string[]>;
  getSchema(database?: string): Promise<DatabaseSchema>;
  /**
   * Executes `sql` (may contain several statements). Emits events in order and resolves when
   * the run finishes (done/error/cancelled). Must never reject for SQL errors: report them as
   * `error` events and resolve with the RunRecord status.
   */
  run(sql: string, opts: QueryOptions, emit: (e: RunEvent) => void): Promise<RunStatus>;
  /** Cancels the run with that id if it is executing on this driver. Resolves false if not found. */
  cancel(runId: string): Promise<boolean>;
}

/** The connection fields pg and mysql2 spell the same way, including the permissive TLS shape. */
export type BaseDriverOptions = {
  host: string;
  port: number;
  user: string;
  password: string | undefined;
  database: string;
  ssl: { rejectUnauthorized: false } | undefined;
};

export function baseDriverOptions(
  config: ConnectionConfig,
  database?: string,
): BaseDriverOptions {
  return {
    host: config.host,
    port: config.port,
    user: config.user,
    password: config.password,
    database: database ?? config.database,
    ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
  };
}
