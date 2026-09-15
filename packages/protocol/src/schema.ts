export type Column = {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  pk: boolean;
  position: number;
};

export type Table = {
  schema: string;
  name: string;
  kind: "table" | "view" | "materialized_view";
  columns: Column[];
  /** Planner estimate when cheap to get, else undefined. */
  rowEstimate?: number;
};

export type Schema = { name: string; tables: Table[] };

export type DatabaseSchema = {
  database: string;
  schemas: Schema[];
  fetchedAt: string;
};
