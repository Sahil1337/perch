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

/**
 * Why a connection could not be opened, as the `code` on the server's error envelope. The UI
 * branches on it: a server that asked for a password gets a password prompt rather than the whole
 * form back, and a server that is not running gets told so instead of "authentication failed".
 *
 * `password_required` — the server asked for a password and this connection has none.
 * `auth_failed` — it has one and the server refused it.
 * `unknown_user` — no such role, or no rule that would let this login in from here.
 * `unknown_database` — the server is there, the database on it is not.
 * `unreachable` — nothing answered at host:port: not running, wrong port, no such host.
 * `tls_required` — the two ends disagree about TLS, or the certificate did not check out.
 * `connect_failed` — anything else; the message is the driver's own.
 */
export type ConnectFailureCode =
  | "password_required"
  | "auth_failed"
  | "unknown_user"
  | "unknown_database"
  | "unreachable"
  | "tls_required"
  | "connect_failed";
