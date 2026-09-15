// The three services the routes are built on, wired together. Created once per server (the CLI's
// `serve`, a test harness) and handed to `createServer`, which never builds its own.

import type { RunRecord } from "@perch/protocol";
import { ConnectionPool, type CreateDriver } from "./connection-pool.js";
import { QueryRunner } from "./query-runner.js";
import { RunLog } from "./run-log.js";

export type ServerServices = {
  pool: ConnectionPool;
  runLog: RunLog;
  runner: QueryRunner;
};

export type ServicesOptions = {
  /** Injected by an embedder or a test rig; otherwise `../db` is imported lazily on first use. */
  createDriver?: CreateDriver;
  /** In-memory run cap (oldest first out). */
  maxRuns?: number;
  /** Schema cache lifetime per connection+database. */
  schemaTtlMs?: number;
  onRunFinished?: (record: RunRecord) => void;
};

export function createServices(opts: ServicesOptions = {}): ServerServices {
  const pool = new ConnectionPool({
    createDriver: opts.createDriver,
    schemaTtlMs: opts.schemaTtlMs,
  });
  const runLog = new RunLog(opts.maxRuns);
  const runner = new QueryRunner({ pool, log: runLog, onRunFinished: opts.onRunFinished });
  return { pool, runLog, runner };
}
