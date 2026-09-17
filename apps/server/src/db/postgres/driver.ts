// PostgreSQL dialect: a small pool (max 4) plus pg-cursor so large result sets stream in batches
// instead of being buffered by pg. The run loop itself lives in BaseDriver.

import pg from "pg";
import Cursor from "pg-cursor";
import { type DatabaseSchema, type QueryError, type ResultColumn } from "@perch/protocol";
import { BaseDriver, type StatementContext } from "../base-driver.js";
import { toRow } from "../cell.js";
import { baseDriverOptions } from "../driver.js";
import { type StatementSink } from "../statement-sink.js";
import { ColumnSourceCache, type Querier } from "./column-source.js";
import { readSchema } from "./introspect.js";
import { looksRowReturning, toQueryError } from "./types.js";

/** The handle a cancel needs: the backend pid of the client currently executing. */
type Pid = number;

export class PostgresDriver extends BaseDriver<pg.Pool, Pid> {
  readonly dialect = "postgres" as const;

  /** oid+attnum → table and column names, per database, kept for the connection's lifetime. */
  readonly #columnSources = new ColumnSourceCache();

  private clientConfig(database?: string): pg.ClientConfig {
    const opts = this.config.options ?? {};
    return {
      ...baseDriverOptions(this.config, database),
      application_name: typeof opts.application_name === "string" ? opts.application_name : "perch",
    };
  }

  protected async createPool(database: string | undefined, max: number): Promise<pg.Pool> {
    const pool = new pg.Pool({ ...this.clientConfig(database), max });
    // A pool with no listener re-throws background client errors as uncaught exceptions.
    pool.on("error", () => {});
    return pool;
  }

  protected async checkPool(pool: pg.Pool): Promise<void> {
    const client = await pool.connect();
    client.release();
  }

  protected async closePool(pool: pg.Pool): Promise<void> {
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
      if (options.timeoutMs > 0)
        await client.query("set statement_timeout = default").catch(() => {});
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
