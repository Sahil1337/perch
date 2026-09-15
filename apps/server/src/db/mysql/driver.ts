// MySQL dialect. mysql2's promise API covers everything except streaming, which only the core
// (callback) connection exposes — `connection.query(...).stream()` — so we reach through
// `PoolConnection.connection` for the streaming path. The run loop itself lives in BaseDriver.

import mysql from "mysql2/promise";
import type { Connection as CoreConnection, FieldPacket, Query } from "mysql2";
import { type ConnectionConfig, type DatabaseSchema, type QueryError } from "@perch/protocol";
import { BaseDriver, type StatementContext } from "../base-driver.js";
import { baseDriverOptions } from "../driver.js";
import { type StatementSink } from "../statement-sink.js";
import { readSchema } from "./introspect.js";
import { commandOf, toQueryError, toResultColumn, toRow, type MysqlError } from "./types.js";

/** The handle a cancel needs: the connection's thread id. */
type ThreadId = number;

export class MysqlDriver extends BaseDriver<mysql.Pool, ThreadId> {
  readonly dialect = "mysql" as const;

  constructor(private readonly config: ConnectionConfig) {
    super();
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  private poolOptions(database?: string): mysql.PoolOptions {
    return {
      ...baseDriverOptions(this.config, database),
      connectionLimit: 4,
      // We split statements ourselves, so never let the server run several at once.
      multipleStatements: false,
      dateStrings: false,
      supportBigNumbers: true,
      bigNumberStrings: true,
    };
  }

  /**
   * Pools for databases other than the connection's own, keyed by name. See the note on the
   * Postgres driver: a run carries the database the user picked, and running it anywhere else is
   * a query against the wrong data.
   *
   * A separate pool rather than `USE db` on a pooled connection, which would outlive the
   * statement and quietly redirect whatever ran next on that connection.
   */
  readonly #databasePools = new Map<string, mysql.Pool>();

  private async poolFor(database?: string): Promise<mysql.Pool> {
    if (!database || database === this.config.database) return this.requirePool();
    const existing = this.#databasePools.get(database);
    if (existing) return existing;
    const pool = mysql.createPool({ ...this.poolOptions(database), connectionLimit: 2 });
    this.#databasePools.set(database, pool);
    return pool;
  }

  protected async openPool(): Promise<mysql.Pool> {
    const pool = mysql.createPool(this.poolOptions());
    try {
      const conn = await pool.getConnection();
      conn.release();
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
    return pool;
  }

  protected async closePool(pool: mysql.Pool): Promise<void> {
    const extras = [...this.#databasePools.values()];
    this.#databasePools.clear();
    await Promise.all(extras.map((extra) => extra.end().catch(() => {})));
    await pool.end();
  }

  protected async queryScalar(sql: string): Promise<string> {
    const pool = await this.requirePool();
    const [rows] = await pool.query<mysql.RowDataPacket[]>(sql);
    return String(Object.values(rows[0] ?? {})[0] ?? "unknown");
  }

  async listDatabases(): Promise<string[]> {
    const pool = await this.requirePool();
    const [rows] = await pool.query<mysql.RowDataPacket[]>("show databases");
    const hidden = new Set(["information_schema", "performance_schema", "mysql", "sys"]);
    return rows
      .map((r) => String(Object.values(r)[0] ?? ""))
      .filter((name) => name && !hidden.has(name.toLowerCase()))
      .sort();
  }

  // ---- schema ------------------------------------------------------------------------------

  async getSchema(database?: string): Promise<DatabaseSchema> {
    const pool = await this.requirePool();
    return readSchema(pool, database ?? this.config.database);
  }

  // ---- running -----------------------------------------------------------------------------

  protected async executeStatement(sql: string, ctx: StatementContext<ThreadId>): Promise<void> {
    const { sink, options } = ctx;
    const pool = await this.poolFor(options.database);
    const conn = await pool.getConnection();
    try {
      ctx.setHandle(conn.threadId ?? null);
      ctx.throwIfCancelled();
      if (options.timeoutMs > 0) {
        // MySQL 5.7.8+ / MariaDB: server-side cap for SELECTs.
        await conn.query(`set session max_execution_time = ${options.timeoutMs}`).catch(() => {});
      }
      await streamInto(conn, sql, sink, options.batchSize);
      sink.command(commandOf(sql));
    } finally {
      if (options.timeoutMs > 0) await conn.query("set session max_execution_time = 0").catch(() => {});
      conn.release();
    }
  }

  protected async killHandle(threadId: ThreadId): Promise<void> {
    if (!Number.isInteger(threadId)) return;
    const pool = await this.requirePool();
    // KILL does not accept placeholders; threadId is a validated integer.
    await pool.query(`kill query ${threadId}`);
  }

  /** ER_QUERY_INTERRUPTED (1317) is what KILL QUERY raises in the victim connection. */
  protected isCancellation(err: unknown, requested: boolean): boolean {
    const e = err as MysqlError;
    const interrupted = e?.errno === 1317 || e?.code === "ER_QUERY_INTERRUPTED";
    if (interrupted) return true;
    // max_execution_time expiry (3024) counts as a timeout error, not a cancellation.
    return requested && e?.errno !== 3024;
  }

  protected toQueryError(err: unknown, sql: string): QueryError {
    return toQueryError(err, sql);
  }
}

/**
 * Feeds one statement's result stream into the sink. `end` and `close` both settle the promise
 * because destroying the stream on truncation emits only `close`.
 */
function streamInto(
  conn: mysql.PoolConnection,
  sql: string,
  sink: StatementSink,
  batchSize: number,
): Promise<void> {
  const core = conn.connection as unknown as CoreConnection;
  const query = core.query({ sql, rowsAsArray: true }) as Query;
  const stream = query.stream({ highWaterMark: batchSize });
  sink.onStop(() => stream.destroy());

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (err?: unknown): void => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve();
    };

    stream.on("fields", (fields: FieldPacket[] | undefined) => {
      if (fields) sink.columns(fields.map(toResultColumn));
    });

    stream.on("data", (row: unknown) => {
      if (Array.isArray(row)) {
        sink.row(toRow(row));
        return;
      }
      // A ResultSetHeader/OkPacket: a statement that returned no result set.
      const ok = row as { affectedRows?: number; info?: string };
      sink.affected(typeof ok?.affectedRows === "number" ? ok.affectedRows : null);
      if (ok?.info) sink.notice(ok.info);
    });

    stream.on("error", (err: unknown) => finish(err));
    stream.on("end", () => finish());
    stream.on("close", () => finish());
  });
}
