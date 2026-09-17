// The half of a driver that has nothing to do with a dialect: the pool lifecycle, the run loop
// (one `start`, one `statement` per statement, one `done`), the cancellation flag, and the
// bookkeeping around each statement, including the extra pools a run aimed at another database
// needs. A dialect supplies a way to build and check a pool, a way to run one statement into a
// StatementSink, and its own notion of what a cancellation looks like.

import type {
  ConnectionConfig,
  DatabaseSchema,
  Dialect,
  QueryError,
  QueryOptions,
  RunEvent,
  RunStatus,
} from "@perch/protocol";
import { splitStatements } from "../core/sql/split.js";
import { type Driver } from "./driver.js";
import { StatementSink } from "./statement-sink.js";

/** QueryOptions with every default filled in, so no dialect has to repeat the coercions. */
export type RunOptions = {
  runId: string;
  /**
   * The database this run is aimed at, when it is not the one the connection was configured with
   * — the topbar's database picker. Dropping it here is what made picking a database change the
   * schema tree and nothing else: every statement kept running against the original database.
   */
  database?: string;
  maxRows: number;
  batchSize: number;
  timeoutMs: number;
  /**
   * Run every statement in a read-only session. Each statement gets its own pooled client, so a
   * dialect sets it per statement (and resets it before releasing), never per run.
   */
  readOnly: boolean;
};

export function normalizeRunOptions(opts: QueryOptions): RunOptions {
  return {
    runId: opts.runId,
    ...(opts.database ? { database: opts.database } : {}),
    maxRows: Math.max(0, opts.maxRows ?? 1000),
    batchSize: Math.max(1, opts.batchSize ?? 200),
    timeoutMs: Math.max(0, Math.floor(opts.timeoutMs ?? 0)),
    readOnly: opts.readOnly === true,
  };
}

/** Thrown by `ctx.throwIfCancelled()` — the run was cancelled before the statement ran. */
export class CancelledError extends Error {
  constructor() {
    super("run cancelled");
    this.name = "CancelledError";
  }
}

/** What a dialect gets for the statement it is executing. */
export type StatementContext<Handle> = {
  readonly sink: StatementSink;
  readonly options: RunOptions;
  /** Position of this statement in the run, 0-based. */
  readonly index: number;
  /** Remembers what `cancel()` would have to kill (a pg backend pid, a mysql thread id). */
  setHandle(handle: Handle | null): void;
  isCancelled(): boolean;
  /** Abandons the statement when a cancel arrived while we were getting ready to run it. */
  throwIfCancelled(): void;
};

type RunEntry<Handle> = { handle: Handle | null; cancelled: boolean };

/** The connection's own pool. A statement holds one client at a time; four covers concurrent runs. */
const MAIN_POOL_MAX = 4;
/** A database other than the connection's own is a side trip, so it gets a smaller pool. */
const SECONDARY_POOL_MAX = 2;

export abstract class BaseDriver<Pool, Handle> implements Driver {
  abstract readonly dialect: Dialect;

  #pool: Pool | null = null;
  readonly #runs = new Map<string, RunEntry<Handle>>();

  /**
   * Pools for databases other than the connection's own, keyed by name.
   *
   * A run carries the database the user picked in the topbar, and it has to be honoured: the
   * schema tree takes the name for introspection, so without this every statement kept running
   * against the database the connection was configured with. Picking another database and running
   * a query therefore queried the wrong one — silently, and with the history record naming the
   * database you had chosen rather than the one it ran on.
   *
   * A pool rather than `set search_path` / `USE db`: in PostgreSQL the database is fixed at
   * connection time, so switching means another connection either way, and in MySQL a `USE` would
   * outlive the statement and quietly redirect whatever ran next on that pooled connection.
   * Keeping the pool lets a session that hops between two databases stop paying the handshake.
   */
  readonly #databasePools = new Map<string, Promise<Pool>>();

  constructor(protected readonly config: ConnectionConfig) {}

  /**
   * Builds (but does not verify) a pool for `database`, or for the connection's own when it is
   * undefined, holding at most `max` connections.
   */
  protected abstract createPool(database: string | undefined, max: number): Promise<Pool>;
  /** Borrows and returns one connection, so `connect()` fails loudly on an unusable config. */
  protected abstract checkPool(pool: Pool): Promise<void>;
  protected abstract closePool(pool: Pool): Promise<void>;
  /** Runs `sql` and returns its single value as text — the round trip behind `test()`. */
  protected abstract queryScalar(sql: string): Promise<string>;
  abstract listDatabases(): Promise<string[]>;
  abstract getSchema(database?: string): Promise<DatabaseSchema>;
  protected abstract executeStatement(sql: string, ctx: StatementContext<Handle>): Promise<void>;
  /** Asks the server to abort whatever `handle` is running. */
  protected abstract killHandle(handle: Handle): Promise<void>;
  /** Dialects disagree about which error codes mean "cancelled" rather than "failed". */
  protected abstract isCancellation(err: unknown, requested: boolean): boolean;
  protected abstract toQueryError(err: unknown, sql: string): QueryError;

  async connect(): Promise<void> {
    if (this.#pool) return;
    const pool = await this.createPool(undefined, MAIN_POOL_MAX);
    try {
      await this.checkPool(pool);
    } catch (err) {
      await this.closePool(pool).catch(() => {});
      throw err;
    }
    this.#pool = pool;
  }

  async disconnect(): Promise<void> {
    const pool = this.#pool;
    this.#pool = null;
    this.#runs.clear();
    const extras = [...this.#databasePools.values()];
    this.#databasePools.clear();
    await Promise.all(extras.map((extra) => extra.then((p) => this.closePool(p)).catch(() => {})));
    if (pool) await this.closePool(pool);
  }

  isConnected(): boolean {
    return this.#pool !== null;
  }

  protected async requirePool(): Promise<Pool> {
    if (!this.#pool) await this.connect();
    if (!this.#pool) throw new Error("not connected");
    return this.#pool;
  }

  /** The pool a statement aimed at `database` must run on. See `#databasePools`. */
  protected async poolFor(database?: string): Promise<Pool> {
    if (!database || database === this.config.database) return this.requirePool();
    const cached = this.#databasePools.get(database);
    if (cached) return cached;
    // The promise, not the pool: two statements starting at once must share one pool, and a
    // createPool that fails must not leave a broken entry behind.
    const pending = this.createPool(database, SECONDARY_POOL_MAX);
    this.#databasePools.set(database, pending);
    pending.catch(() => this.#databasePools.delete(database));
    return pending;
  }

  async test(): Promise<{ serverVersion: string; latencyMs: number }> {
    await this.requirePool();
    const started = Date.now();
    const serverVersion = await this.queryScalar("select version() as version");
    return { serverVersion, latencyMs: Date.now() - started };
  }

  async run(sql: string, opts: QueryOptions, emit: (e: RunEvent) => void): Promise<RunStatus> {
    await this.requirePool();
    const options = normalizeRunOptions(opts);
    const { runId } = options;
    const statements = splitStatements(sql);
    const startedAt = Date.now();
    const entry: RunEntry<Handle> = { handle: null, cancelled: false };
    this.#runs.set(runId, entry);

    emit({ type: "start", runId, statements: statements.length });
    let status: RunStatus = "done";

    try {
      for (let index = 0; index < statements.length; index++) {
        if (entry.cancelled) {
          status = "cancelled";
          break;
        }
        const statement = statements[index]!.sql;
        emit({ type: "statement", runId, index, sql: statement });
        const outcome = await this.#runStatement(entry, statement, index, options, emit);
        if (outcome !== "done") {
          status = outcome;
          break;
        }
      }
    } finally {
      this.#runs.delete(runId);
    }

    emit({ type: "done", runId, status, durationMs: Date.now() - startedAt });
    return status;
  }

  async cancel(runId: string): Promise<boolean> {
    const entry = this.#runs.get(runId);
    if (!entry) return false;
    entry.cancelled = true;
    const handle = entry.handle;
    if (handle === null || !this.isConnected()) return true;
    try {
      await this.killHandle(handle);
    } catch {
      /* the statement may have finished on its own; the flag already marks the run cancelled */
    }
    return true;
  }

  async #runStatement(
    entry: RunEntry<Handle>,
    sql: string,
    index: number,
    options: RunOptions,
    emit: (e: RunEvent) => void,
  ): Promise<RunStatus> {
    const sink = new StatementSink({
      runId: options.runId,
      index,
      sql,
      maxRows: options.maxRows,
      batchSize: options.batchSize,
      emit,
    });
    const ctx: StatementContext<Handle> = {
      sink,
      options,
      index,
      setHandle: (handle) => {
        entry.handle = handle;
      },
      isCancelled: () => entry.cancelled,
      throwIfCancelled: () => {
        if (entry.cancelled) throw new CancelledError();
      },
    };

    try {
      await this.executeStatement(sql, ctx);
    } catch (err) {
      if (err instanceof CancelledError) return "cancelled";
      if (this.isCancellation(err, entry.cancelled)) return "cancelled";
      emit({ type: "error", runId: options.runId, index, error: this.toQueryError(err, sql) });
      return "error";
    } finally {
      entry.handle = null;
    }

    sink.finish();
    return "done";
  }
}
