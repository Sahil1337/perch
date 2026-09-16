// PostgreSQL dialect: a small pool (max 4) plus pg-cursor so large result sets stream in batches
// instead of being buffered by pg. The run loop itself lives in BaseDriver.

import pg from "pg";
import Cursor from "pg-cursor";
import {
  type ConnectionConfig,
  type DatabaseSchema,
  type QueryError,
  type ResultColumn,
} from "@perch/protocol";
import { BaseDriver, type StatementContext } from "../base-driver.js";
import { baseDriverOptions } from "../driver.js";
import { type StatementSink } from "../statement-sink.js";
import { ColumnSourceCache, type Querier } from "./column-source.js";
import { readSchema } from "./introspect.js";
import { looksRowReturning, toQueryError, toRow } from "./types.js";

/** The handle a cancel needs: the backend pid of the client currently executing. */
type Pid = number;

export class PostgresDriver extends BaseDriver<pg.Pool, Pid> {
  readonly dialect = "postgres" as const;

  constructor(private readonly config: ConnectionConfig) {
    super();
  }

  // ---- lifecycle ---------------------------------------------------------------------------

  private clientConfig(database?: string): pg.ClientConfig {
    const opts = this.config.options ?? {};
    return {
      ...baseDriverOptions(this.config, database),
      application_name: typeof opts.application_name === "string" ? opts.application_name : "perch",
    };
  }

  protected async openPool(): Promise<pg.Pool> {
    const pool = new pg.Pool({ ...this.clientConfig(), max: 4 });
    // A pool with no listener re-throws background client errors as uncaught exceptions.
    pool.on("error", () => {});
    try {
      const client = await pool.connect();
      client.release();
    } catch (err) {
      await pool.end().catch(() => {});
      throw err;
    }
    return pool;
  }

  /**
   * Pools for databases other than the connection's own, keyed by name.
   *
   * A run carries the database the user picked in the topbar, and until now nothing read it: the
   * schema tree switched (introspection takes the name) while every statement kept running against
   * the database the connection was configured with. Picking another database and running a query
   * therefore queried the wrong one — silently, and with the history record naming the database
   * you had chosen rather than the one it ran on.
   *
   * A pool rather than `set search_path` or a per-statement reconnect: the database is fixed at
   * connection time in PostgreSQL, so switching means another connection either way, and keeping
   * it lets a session that hops between two databases stop paying the handshake every statement.
   */
  readonly #databasePools = new Map<string, pg.Pool>();

  /** oid+attnum → table and column names, per database, kept for the connection's lifetime. */
  readonly #columnSources = new ColumnSourceCache();

  private async poolFor(database?: string): Promise<pg.Pool> {
    if (!database || database === this.config.database) return this.requirePool();
    const existing = this.#databasePools.get(database);
    if (existing) return existing;
    const pool = new pg.Pool({ ...this.clientConfig(database), max: 2 });
    pool.on("error", () => {});
    this.#databasePools.set(database, pool);
    return pool;
  }

  protected async closePool(pool: pg.Pool): Promise<void> {
    const extras = [...this.#databasePools.values()];
    this.#databasePools.clear();
    await Promise.all(extras.map((extra) => extra.end().catch(() => {})));
    await pool.end();
  }

  protected async queryScalar(sql: string): Promise<string> {
    const pool = await this.requirePool();
    const res = await pool.query<Record<string, string>>(sql);
    return Object.values(res.rows[0] ?? {})[0] ?? "unknown";
  }

  async listDatabases(): Promise<string[]> {
    const pool = await this.requirePool();
    const res = await pool.query<{ datname: string }>(
      "select datname from pg_database where not datistemplate order by 1",
    );
    return res.rows.map((r) => r.datname);
  }

  // ---- schema ------------------------------------------------------------------------------

  async getSchema(database?: string): Promise<DatabaseSchema> {
    const target = database ?? this.config.database;
    if (database && database !== this.config.database) {
      const client = new pg.Client(this.clientConfig(database));
      await client.connect();
      try {
        return await readSchema(client, target);
      } finally {
        await client.end();
      }
    }
    const pool = await this.requirePool();
    const client = await pool.connect();
    try {
      return await readSchema(client, target);
    } finally {
      client.release();
    }
  }

  // ---- running -----------------------------------------------------------------------------

  protected async executeStatement(sql: string, ctx: StatementContext<Pid>): Promise<void> {
    const { sink, options } = ctx;
    const pool = await this.poolFor(options.database);
    const client = await pool.connect();
    const onNotice = (notice: { message?: string }): void => {
      sink.notice(notice?.message ?? String(notice));
    };
    client.on("notice", onNotice);

    try {
      const pidRes = await client.query<{ pid: number }>("select pg_backend_pid() as pid");
      ctx.setHandle(pidRes.rows[0]?.pid ?? null);
      ctx.throwIfCancelled();
      if (options.timeoutMs > 0) await client.query(`set statement_timeout = ${options.timeoutMs}`);
      // Per statement, like the timeout: the next statement gets another pooled client.
      if (options.readOnly) await client.query("set default_transaction_read_only = on");

      const database = options.database ?? this.config.database;
      const describe = (fields: pg.FieldDef[], query: Querier) =>
        this.#columnSources.resolve(database, fields, query);
      if (looksRowReturning(sql)) {
        // The open cursor is this client's active query, so a lookup queued behind it would wait
        // for the cursor while the read loop waits for the lookup. Borrow another client from the
        // pool instead — and only when one can be had, or two concurrent runs could pin each other.
        const viaPool: Querier = (text, values) =>
          pool.idleCount > 0 || pool.totalCount < (pool.options.max ?? 1)
            ? pool.query(text, values)
            : Promise.reject(new Error("pool busy"));
        await readThroughCursor(client, sql, sink, options.batchSize, (f) => describe(f, viaPool));
      } else {
        const viaClient: Querier = (text, values) => client.query(text, values);
        await readDirect(client, sql, sink, options.batchSize, (f) => describe(f, viaClient));
      }
    } finally {
      client.removeListener("notice", onNotice);
      if (options.timeoutMs > 0) await client.query("set statement_timeout = default").catch(() => {});
      if (options.readOnly) {
        await client.query("set default_transaction_read_only = default").catch(() => {});
      }
      client.release();
    }
  }

  protected async killHandle(pid: Pid): Promise<void> {
    const pool = await this.requirePool();
    await pool.query("select pg_cancel_backend($1)", [pid]);
  }

  /** 57014 is `query_canceled`; statement timeouts share it, so those stay errors. */
  protected isCancellation(err: unknown, requested: boolean): boolean {
    const e = err as { code?: string; message?: string };
    if (e?.code !== "57014") return false;
    if (requested) return true;
    return !/statement timeout/i.test(e.message ?? "");
  }

  protected toQueryError(err: unknown, sql: string): QueryError {
    return toQueryError(err, sql);
  }
}

/** Turns pg's field descriptions into result columns, resolving each one's base table. */
type Describe = (fields: pg.FieldDef[]) => Promise<ResultColumn[]>;

/** Row-returning statements stream through a cursor, so a huge table never lands in memory. */
async function readThroughCursor(
  client: pg.PoolClient,
  sql: string,
  sink: StatementSink,
  batchSize: number,
  describe: Describe,
): Promise<void> {
  const cursor = client.query(new Cursor<unknown[]>(sql, undefined, { rowMode: "array" }));
  let sawFields = false;
  for (;;) {
    // One row past the limit, so the sink can tell "exactly maxRows" from "truncated".
    const want = Math.min(batchSize, Math.max(1, sink.maxRows - sink.rowCount + 1));
    const read = await readCursor(cursor, want);
    if (!sawFields) {
      sawFields = true;
      sink.columns(await describe(read.result.fields ?? []));
    }
    sink.command(read.result.command ?? null);
    sink.rows(read.rows.map(toRow));
    if (sink.truncated) {
      await cursor.close();
      return;
    }
    if (read.rows.length < want) {
      if (!sink.hasColumns) sink.affected(read.result.rowCount ?? null);
      return;
    }
  }
}

/** Everything else goes through the simple protocol: a cursor cannot run e.g. VACUUM. */
async function readDirect(
  client: pg.PoolClient,
  sql: string,
  sink: StatementSink,
  batchSize: number,
  describe: Describe,
): Promise<void> {
  const res = await client.query<unknown[]>({ text: sql, rowMode: "array" });
  sink.command(res.command ?? null);
  if (res.fields && res.fields.length > 0) {
    sink.columns(await describe(res.fields));
    const all = res.rows.map(toRow);
    for (let i = 0; i < all.length && !sink.truncated; i += batchSize) {
      sink.rows(all.slice(i, i + batchSize));
    }
  } else {
    sink.affected(res.rowCount ?? null);
  }
}

function readCursor(
  cursor: Cursor<unknown[]>,
  want: number,
): Promise<{ rows: unknown[][]; result: pg.QueryResult }> {
  return new Promise((resolve, reject) => {
    cursor.read(want, (err, rows, result) => {
      if (err) reject(err);
      else resolve({ rows, result });
    });
  });
}
