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

export type Table = {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  columns: Column[];
  /** FOREIGN KEY constraints declared on this table; empty when none, and always empty for views. */
  foreignKeys: ForeignKey[];
  /** Planner estimate when cheap to get, else undefined. */
  rowEstimate?: number;
};

export type Schema = { name: string; tables: Table[] };

export type DatabaseSchema = {
  database: string;
  schemas: Schema[];
  fetchedAt: string;
};
