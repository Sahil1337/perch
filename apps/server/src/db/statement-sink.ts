// Everything one statement produces, on its way to the client. A dialect pushes columns, rows,
// notices and counts in whatever order its API hands them over; the sink owns what is common to
// all of them: the maxRows cut, the batching of rows into `rows` events, and the StatementResult.

import type { ResultColumn, Row, RunEvent, StatementResult } from "@perch/protocol";

export type StatementSinkOptions = {
  runId: string;
  index: number;
  sql: string;
  maxRows: number;
  batchSize: number;
  emit: (event: RunEvent) => void;
};

export class StatementSink {
  readonly #opts: StatementSinkOptions;
  readonly #startedAt = Date.now();
  readonly #rows: Row[] = [];
  readonly #notices: string[] = [];
  #columns: ResultColumn[] = [];
  #pending: Row[] = [];
  #stop: (() => void) | undefined;
  #affected: number | null = null;
  #command: string | null = null;
  #truncated = false;

  constructor(opts: StatementSinkOptions) {
    this.#opts = opts;
  }

  /**
   * Registers what to call the moment maxRows is reached, so a dialect that is being pushed rows
   * (a mysql2 stream) can destroy its source. A dialect that pulls (a pg cursor) can instead
   * check `truncated` after handing rows over.
   */
  onStop(fn: () => void): void {
    this.#stop = fn;
  }

  /** True once rows were cut at maxRows; the dialect should stop reading. */
  get truncated(): boolean {
    return this.#truncated;
  }

  /** Rows kept so far — a cursor uses it, with `maxRows`, to size its next read. */
  get rowCount(): number {
    return this.#rows.length;
  }

  get maxRows(): number {
    return this.#opts.maxRows;
  }

  /** True once a result set was announced: what tells a DML statement from a SELECT. */
  get hasColumns(): boolean {
    return this.#columns.length > 0;
  }

  /** The first non-empty column list wins; later calls (a second result set) are ignored. */
  columns(columns: ResultColumn[]): void {
    if (this.#columns.length > 0 || columns.length === 0) return;
    this.#columns = columns;
    const { runId, index } = this.#opts;
    this.#opts.emit({ type: "columns", runId, index, columns });
  }

  row(row: Row): void {
    if (this.#rows.length >= this.#opts.maxRows) {
      if (!this.#truncated) {
        this.#truncated = true;
        this.flush();
        this.#stop?.();
      }
      return;
    }
    this.#rows.push(row);
    this.#pending.push(row);
    if (this.#pending.length >= this.#opts.batchSize) this.flush();
  }

  rows(batch: readonly Row[]): void {
    for (const row of batch) this.row(row);
  }

  notice(message: string): void {
    this.#notices.push(message);
    const { runId, index } = this.#opts;
    this.#opts.emit({ type: "notice", runId, index, message });
  }

  affected(rows: number | null): void {
    this.#affected = rows;
  }

  command(command: string | null): void {
    if (command) this.#command = command;
  }

  /** Emits whatever rows are queued. Called automatically at the batch size and on finish. */
  flush(): void {
    if (this.#pending.length === 0) return;
    const { runId, index } = this.#opts;
    this.#opts.emit({ type: "rows", runId, index, rows: this.#pending });
    this.#pending = [];
  }

  /** Flushes, emits the `result` event, and returns the record the run log keeps. */
  finish(): StatementResult {
    this.flush();
    const result: StatementResult = {
      index: this.#opts.index,
      sql: this.#opts.sql,
      columns: this.#columns,
      rows: this.#rows,
      rowCount: this.#rows.length,
      // A statement that returned a result set reports rowCount, never affectedRows.
      affectedRows: this.#columns.length > 0 ? null : this.#affected,
      command: this.#command,
      durationMs: Date.now() - this.#startedAt,
      truncated: this.#truncated,
      notices: this.#notices,
    };
    this.#opts.emit({ type: "result", runId: this.#opts.runId, result });
    return result;
  }
}
