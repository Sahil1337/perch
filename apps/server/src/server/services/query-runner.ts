// Running SQL on behalf of a client: builds the RunRecord, forwards every driver event to the
// caller while accumulating the same events into that record, guarantees exactly one `done`, and
// appends the run to the on-disk history when it ends.

import { randomUUID } from "node:crypto";
import { appendHistory, getSettings } from "../../storage/index.js";
import type { QueryOptions, Row, RunEvent, RunRecord, RunStatus } from "@perch/protocol";
import type { Driver } from "../../db/driver.js";
import { conflict, badRequest, errorMessage } from "../http/errors.js";
import type { ConnectionPool } from "./connection-pool.js";
import type { RunLog } from "./run-log.js";

export type StartRunInput = {
  connectionId: string;
  sql: string;
  database?: string;
  runId?: string;
  maxRows?: number;
  batchSize?: number;
  timeoutMs?: number;
  source: "ui" | "cli";
};

export type QueryRunnerDeps = {
  pool: ConnectionPool;
  log: RunLog;
  /** Called once a run reaches a terminal state; the server forwards it onto the event bus. */
  onRunFinished?: (record: RunRecord) => void;
};

export class QueryRunner {
  /** Mutable so `createServer` can chain the event bus onto whatever the caller already set. */
  onRunFinished: ((record: RunRecord) => void) | undefined;
  private readonly pool: ConnectionPool;
  private readonly log: RunLog;
  /** Runs currently executing, so a cancel knows which driver to ask. */
  private readonly running = new Map<string, Driver>();

  constructor(deps: QueryRunnerDeps) {
    this.pool = deps.pool;
    this.log = deps.log;
    this.onRunFinished = deps.onRunFinished;
  }

  /**
   * Executes `sql`, forwarding every driver event to `emit` as it happens while accumulating the
   * same events into a RunRecord kept in the run log (so /runs/:id and the exports can serve
   * rows). Resolves with the finished record; it does not reject for SQL errors.
   */
  async startRun(input: StartRunInput, emit: (e: RunEvent) => void = () => {}): Promise<RunRecord> {
    if (typeof input.sql !== "string" || input.sql.trim() === "") {
      throw badRequest("sql is required");
    }
    const config = await this.pool.config(input.connectionId);
    const settings = await getSettings();
    const runId = input.runId || randomUUID();
    if (this.running.has(runId)) throw conflict(`run ${runId} is already executing`);

    const startedAtMs = Date.now();
    const record: RunRecord = {
      id: runId,
      connectionId: config.id,
      database: input.database || config.database,
      sql: input.sql,
      status: "running",
      startedAt: new Date(startedAtMs).toISOString(),
      results: [],
      source: input.source,
    };
    this.log.remember(record);

    const driver = await this.pool.driverFor(config.id);
    this.running.set(runId, driver);

    const opts: QueryOptions = {
      runId,
      database: input.database || undefined,
      maxRows: input.maxRows ?? settings.maxRows,
      batchSize: input.batchSize ?? 200,
      timeoutMs: input.timeoutMs ?? settings.statementTimeoutMs,
    };

    const capture = captureInto(record, emit);
    let status: RunStatus;
    try {
      status = await driver.run(input.sql, opts, capture.emit);
    } catch (err) {
      // The Driver contract reports SQL errors as events; a rejection means something worse.
      status = "error";
      record.error = record.error ?? { message: errorMessage(err) };
      emit({ type: "error", runId, index: record.results?.length ?? 0, error: record.error });
    } finally {
      this.running.delete(runId);
    }

    record.status = status;
    record.durationMs = Date.now() - startedAtMs;
    record.finishedAt = new Date().toISOString();
    // Guarantees the NDJSON stream always ends with exactly one `done` line.
    if (!capture.sawDone()) emit({ type: "done", runId, status, durationMs: record.durationMs });

    try {
      await appendHistory(record);
    } catch {
      /* history is best-effort; never fail a run because the log could not be written */
    }
    try {
      this.onRunFinished?.(record);
    } catch {
      /* a notification listener must never change the outcome of a run */
    }
    return record;
  }

  async cancelRun(runId: string): Promise<boolean> {
    const driver = this.running.get(runId);
    if (!driver) return false;
    try {
      return await driver.cancel(runId);
    } catch {
      return false;
    }
  }
}

/**
 * Wraps `emit` so the record grows as the events stream past. A driver may emit a statement's rows
 * only as `rows` events (streaming) and leave them out of its `result`, so buffer them per
 * statement index and fold them back in.
 */
function captureInto(
  record: RunRecord,
  emit: (e: RunEvent) => void,
): { emit: (e: RunEvent) => void; sawDone: () => boolean } {
  const buffers = new Map<number, Row[]>();
  let done = false;
  return {
    sawDone: () => done,
    emit(event: RunEvent): void {
      switch (event.type) {
        case "rows": {
          const buffer = buffers.get(event.index) ?? [];
          buffer.push(...event.rows);
          buffers.set(event.index, buffer);
          break;
        }
        case "result": {
          const buffered = buffers.get(event.result.index);
          const result = { ...event.result };
          if (result.rows.length === 0 && buffered && buffered.length > 0) result.rows = buffered;
          buffers.delete(event.result.index);
          record.results = [...(record.results ?? []), result];
          break;
        }
        case "error":
          record.error = event.error;
          break;
        case "done":
          done = true;
          break;
        default:
          break;
      }
      emit(event);
    },
  };
}
