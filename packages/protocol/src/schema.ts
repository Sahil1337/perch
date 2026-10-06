export type Column = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  pk: boolean;
  position: number;
};

/** One FOREIGN KEY constraint. Composite keys carry several columns, paired by index. */
export type ForeignKey = {
  /** The constraint name as the database reports it. */
  name: string;
  /** Columns on this table, in constraint order. */
  columns: string[];
  refSchema: string;
  refTable: string;
  /** Columns on the referenced table, paired with `columns` by index. */
  refColumns: string[];
  /** "NO ACTION" | "CASCADE" | "SET NULL" | "SET DEFAULT" | "RESTRICT" as the database spells it. */
  onDelete: string;
  onUpdate: string;
};

export type TriggerTiming = "before" | "after" | "instead_of";

/** What a trigger fires on. Not `TriggerEvent`: an `*Event` type is a wire message here. */
export type TriggerOperation = "insert" | "update" | "delete" | "truncate";

export type TriggerLevel = "row" | "statement";

/**
 * `pg_trigger.tgenabled` O, D, R and A. A `replica` trigger fires only while
 * `session_replication_role` is `replica`; an `always` trigger fires whatever it is.
 */
export type TriggerState = "enabled" | "disabled" | "replica" | "always";

export type TriggerFunctionRef = { schema: string; name: string };

/** A user-defined trigger. Internal ones (foreign keys) and partition clones are left out. */
export type Trigger = {
  /** The raw name; quote it whenever it goes into SQL. */
  name: string;
  timing: TriggerTiming;
  /** Always in the order insert, update, delete, truncate, whatever order the DDL used. */
  operations: TriggerOperation[];
  /** The UPDATE OF columns in declared order; empty when any update fires it. */
  columns: string[];
  level: TriggerLevel;
  /**
   * The WHEN condition as Postgres prints it, without the outer parentheses; null when there is
   * none. Statement triggers can have one too.
   */
  condition: string | null;
  function: TriggerFunctionRef;
  /** The literal arguments the function sees as `TG_ARGV`; any of them can be the empty string. */
  arguments: string[];
  state: TriggerState;
  /** A CONSTRAINT TRIGGER. */
  constraint: boolean;
  /** A constraint trigger declared INITIALLY DEFERRED, so it runs at COMMIT. */
  initiallyDeferred: boolean;
  /** Declares REFERENCING OLD TABLE or NEW TABLE. */
  transitionTables: boolean;
  /** COMMENT ON TRIGGER, or null. */
  comment: string | null;
  /**
   * `pg_get_triggerdef(oid, false)`: the table is always schema-qualified, the function only when
   * it is not on the search path. Not byte-for-byte what was typed, so compare fields, not text.
   */
  definition: string;
};

/** A function that returns `trigger`. How many triggers use it is counted from `Table.triggers`. */
export type TriggerFunction = {
  schema: string;
  name: string;
  /** `pg_language.lanname`: "plpgsql", "c", "internal", … */
  language: string;
  /** The extension that owns the function, or null. */
  extension: string | null;
};

export type Table = {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  columns: Column[];
  /** FOREIGN KEY constraints declared on this table; empty when none, and always empty for views. */
  foreignKeys: ForeignKey[];
  /**
   * In firing order: within one timing and level Postgres fires triggers in byte order of their
   * names, and the server sends them that way, so never re-sort. Empty when none, when the
   * trigger catalogs could not be read, and always on MySQL for now.
   */
  triggers: Trigger[];
  /** Planner estimate when cheap to get, else undefined. */
  rowEstimate?: number;
  /**
   * True for a partition of a partitioned table, else undefined. Its parent's row triggers fire
   * on it but are listed only on the parent.
   */
  isPartition?: boolean;
};

export type Schema = { name: string; tables: Table[] };

export type DatabaseSchema = {
  database: string;
  schemas: Schema[];
  /**
   * Every function returning `trigger` in the schemas above, used or not. Empty when none, when
   * the trigger catalogs could not be read, and on MySQL.
   */
  triggerFunctions: TriggerFunction[];
  /** `server_version_num`, e.g. 180004 for 18.4; null on MySQL or when the server won't say. */
  serverVersionNum: number | null;
  fetchedAt: string;
};
