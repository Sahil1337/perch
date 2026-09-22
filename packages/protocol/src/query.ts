export type ResultColumn = {
  name: string;
  /** Driver type name normalised to lower-case (int8, text, timestamptz, varchar, ...). */
  type: string;
  /** Hint for the UI: numbers/dates align right. */
  align: "left" | "right";
  /**
   * The base table and column a value comes from, when the driver can tell (Postgres resolves
   * the field's tableID/columnID; MySQL reports orgTable/orgName). Absent for expressions and
   * aggregates. `table` is the unqualified table name.
   */
  source?: { table: string; column: string };
};

export type Cell = string | number | boolean | null;
export type Row = Cell[];

/** One statement's outcome. A multi-statement run yields several. */
export type StatementResult = {
  index: number;
  sql: string;
  /** SELECT-like statements have columns; DML/DDL have none and use affectedRows. */
  columns: ResultColumn[];
  rows: Row[];
  rowCount: number;
  affectedRows: number | null;
  /** e.g. "SELECT", "INSERT", "CREATE TABLE" */
  command: string | null;
  durationMs: number;
  /** True when rows were cut at maxRows. */
  truncated: boolean;
  notices: string[];
};

export type RunStatus = "running" | "done" | "error" | "cancelled";

export type QueryError = {
  message: string;
  code?: string;
  /** 0-based character offset into the statement when the driver reports one. */
  position?: number;
  line?: number;
  detail?: string;
  hint?: string;
};

export type RunRecord = {
  id: string;
  connectionId: string;
  database: string;
  sql: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  results?: StatementResult[];
  error?: QueryError;
  /** Set for CLI runs vs UI runs; purely informational. */
  source: "ui" | "cli";
  /**
   * The workspace root the query came from, when it came from a file in one. Absent means the run
   * belongs to no folder — an untitled buffer, perch's own queries directory, or the CLI — which
   * the History tab calls global.
   */
  workspace?: string;
};

/**
 * Which runs a history page is asking for. `workspace` means this root *and* the global ones,
 * which is the view that matches how people work: the project in front of them, plus the scratch
 * queries that belong to no project.
 */
export type HistoryScope = "all" | "workspace" | "global";

/** Events streamed (NDJSON) while a run executes. */
export type RunEvent =
  | { type: "start"; runId: string; statements: number }
  | { type: "statement"; runId: string; index: number; sql: string }
  | { type: "columns"; runId: string; index: number; columns: ResultColumn[] }
  | { type: "rows"; runId: string; index: number; rows: Row[] }
  | { type: "notice"; runId: string; index: number; message: string }
  | { type: "result"; runId: string; result: StatementResult }
  | { type: "error"; runId: string; index: number; error: QueryError }
  | { type: "done"; runId: string; status: RunStatus; durationMs: number };

export type QueryOptions = {
  runId: string;
  database?: string;
  /** Rows per statement to keep; further rows are discarded and `truncated` set. Default 1000. */
  maxRows?: number;
  /** Batch size for `rows` events. Default 200. */
  batchSize?: number;
  /** Server-side statement timeout in ms; 0 = none. */
  timeoutMs?: number;
  /**
   * Whether the run is appended to history and announced on the event bus. Default true. Probe
   * runs (the query walk's step queries) pass false so they never show up in History.
   */
  record?: boolean;
  /**
   * Run every statement in a read-only session, so a probe can never write. Postgres:
   * `set default_transaction_read_only = on` for the statement; MySQL:
   * `set session transaction_read_only = 1`. Default false.
   */
  readOnly?: boolean;
  /** The workspace root this run belongs to; see `RunRecord.workspace`. */
  workspace?: string;
};
