import type { ConnectionConfig, ConnectionSummary, DatabaseSchema } from "@perch/protocol";
import type { CallOptions, Transport } from "./http";

/**
 * A create/update body. Every field is optional because the server merges: `url` fills in the
 * discrete fields, and a PUT merges over what is already stored.
 */
export type ConnectionInput = Partial<Omit<ConnectionConfig, "id" | "createdAt">> & {
  /** `postgres://user:pass@host:5432/db` or `mysql://…`. */
  url?: string;
};

/** Creating one needs a name: there is nothing stored yet to inherit it from. */
export type NewConnection = ConnectionInput & { name: string };

export type ConnectionTest = { serverVersion: string; latencyMs: number };

export type SchemaOptions = CallOptions & {
  database?: string;
  /** Bypasses the server's 30s schema cache. */
  refresh?: boolean;
};

export type ConnectionsApi = {
  list(opts?: CallOptions): Promise<ConnectionSummary[]>;
  create(input: NewConnection, opts?: CallOptions): Promise<ConnectionSummary>;
  update(id: string, input: ConnectionInput, opts?: CallOptions): Promise<ConnectionSummary>;
  remove(id: string, opts?: CallOptions): Promise<boolean>;
  test(id: string, opts?: CallOptions): Promise<ConnectionTest>;
  connect(id: string, opts?: CallOptions): Promise<ConnectionSummary>;
  disconnect(id: string, opts?: CallOptions): Promise<ConnectionSummary>;
  databases(id: string, opts?: CallOptions): Promise<string[]>;
  schema(id: string, opts?: SchemaOptions): Promise<DatabaseSchema>;
};

export function connectionsApi(http: Transport): ConnectionsApi {
  const at = (id: string, suffix = ""): string =>
    `/api/connections/${encodeURIComponent(id)}${suffix}`;

  return {
    list: (opts) => http.json<ConnectionSummary[]>("/api/connections", { signal: opts?.signal }),

    create: (input, opts) =>
      http.json<ConnectionSummary>("/api/connections", {
        method: "POST",
        body: input,
        signal: opts?.signal,
      }),

    update: (id, input, opts) =>
      http.json<ConnectionSummary>(at(id), { method: "PUT", body: input, signal: opts?.signal }),

    remove: async (id, opts) =>
      (await http.json<{ ok: boolean }>(at(id), { method: "DELETE", signal: opts?.signal })).ok,

    test: (id, opts) =>
      http.json<ConnectionTest>(at(id, "/test"), { method: "POST", signal: opts?.signal }),

    connect: (id, opts) =>
      http.json<ConnectionSummary>(at(id, "/connect"), { method: "POST", signal: opts?.signal }),

    disconnect: (id, opts) =>
      http.json<ConnectionSummary>(at(id, "/disconnect"), { method: "POST", signal: opts?.signal }),

    databases: (id, opts) => http.json<string[]>(at(id, "/databases"), { signal: opts?.signal }),

    schema: (id, opts) =>
      http.json<DatabaseSchema>(at(id, "/schema"), {
        query: { database: opts?.database, refresh: opts?.refresh ? "1" : undefined },
        signal: opts?.signal,
      }),
  };
}
