export type Dialect = "postgres" | "mysql";

export type ConnectionConfig = {
  id: string;
  name: string;
  dialect: Dialect;
  host: string;
  port: number;
  user: string;
  /** Stored in the config file (0600). Optional: prompt/env can supply it. */
  password?: string;
  database: string;
  ssl?: boolean;
  /** Free-form driver options (e.g. { application_name }). */
  options?: Record<string, string | number | boolean>;
  createdAt: string;
};

export type ConnectionStatus = "connected" | "disconnected" | "error";

/** Wire shape for the UI list: no secrets. */
export type ConnectionSummary = Omit<ConnectionConfig, "password"> & {
  status: ConnectionStatus;
  error?: string;
  databases?: string[];
};
