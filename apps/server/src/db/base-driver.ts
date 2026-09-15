// The half of a driver that has nothing to do with a dialect: the pool lifecycle, the run loop
// (one `start`, one `statement` per statement, one `done`), the cancellation flag, and the
// bookkeeping around each statement. A dialect supplies a pool, a way to run one statement into a
// StatementSink, and its own notion of what a cancellation looks like.

import type {
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
};

export function normalizeRunOptions(opts: QueryOptions): RunOptions {
  return {
    runId: opts.runId,
    ...(opts.database ? { database: opts.database } : {}),
    maxRows: Math.max(0, opts.maxRows ?? 1000),
    batchSize: Math.max(1, opts.batchSize ?? 200),
    timeoutMs: Math.max(0, Math.floor(opts.timeoutMs ?? 0)),
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

export abstract class BaseDriver<Pool, Handle> implements Driver {
  abstract readonly dialect: Dialect;

  #pool: Pool | null = null;
  readonly #runs = new Map<string, RunEntry<Handle>>();

  protected abstract openPool(): Promise<Pool>;
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
    this.#pool = await this.openPool();
  }

  async disconnect(): Promise<void> {
    const pool = this.#pool;
    this.#pool = null;
    this.#runs.clear();
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
