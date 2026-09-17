// Connection URL parsing: `postgres://`, `postgresql://`, `pg://`, `mysql://`, `mariadb://`.

import os from "node:os";
import { type ConnectionConfig, type Dialect } from "@perch/protocol";

export const defaultPort = (dialect: Dialect): number => (dialect === "mysql" ? 3306 : 5432);

const PROTOCOLS: Record<string, Dialect> = {
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "pg:": "postgres",
  "mysql:": "mysql",
  "mariadb:": "mysql",
};

/** Query parameters that configure the connection rather than the driver options bag. */
const RESERVED_PARAMS = new Set(["ssl", "sslmode", "dialect"]);

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseSsl(params: URLSearchParams): boolean | undefined {
  const sslmode = params.get("sslmode");
  if (sslmode) {
    const mode = sslmode.toLowerCase();
    if (mode === "disable" || mode === "allow") return false;
    return true;
  }
  const ssl = params.get("ssl");
  if (ssl === null) return undefined;
  const value = ssl.toLowerCase();
  if (value === "" || value === "1" || value === "true" || value === "require") return true;
  if (value === "0" || value === "false") return false;
  return true;
}

function osUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    return "postgres";
  }
}

/**
 * Parses `postgres://`, `postgresql://` and `mysql://` URLs into a connection config.
 * Missing pieces fall back to sensible defaults (the OS user and `postgres` for PostgreSQL,
 * `root` for MySQL). `?sslmode=require` / `?ssl=true` turn TLS on; any other query parameter is
 * kept in `options` for the driver.
 */
export function parseConnectionUrl(
  url: string,
): Omit<ConnectionConfig, "id" | "name" | "createdAt"> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`invalid connection url: ${url}`);
  }

  const dialect = PROTOCOLS[parsed.protocol.toLowerCase()];
  if (!dialect) {
    throw new Error(
      `unsupported connection url scheme "${parsed.protocol.replace(/:$/, "")}" — use postgres:// or mysql://`,
    );
  }

  const host = decode(parsed.hostname).replace(/^\[|\]$/g, "") || "localhost";
  const port = parsed.port ? Number(parsed.port) : defaultPort(dialect);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid port in connection url: ${parsed.port}`);
  }

  const user = decode(parsed.username) || (dialect === "mysql" ? "root" : osUser());
  const password = parsed.password ? decode(parsed.password) : undefined;
  const database =
    decode(parsed.pathname.replace(/^\//, "")) || (dialect === "postgres" ? "postgres" : "");

  const ssl = parseSsl(parsed.searchParams);
  const options: Record<string, string> = {};
  for (const [key, value] of parsed.searchParams) {
    if (!RESERVED_PARAMS.has(key.toLowerCase())) options[key] = value;
  }

  const config: Omit<ConnectionConfig, "id" | "name" | "createdAt"> = {
    dialect,
    host,
    port,
    user,
    database,
  };
  if (password !== undefined) config.password = password;
  if (ssl !== undefined) config.ssl = ssl;
  if (Object.keys(options).length > 0) config.options = options;
  return config;
}
