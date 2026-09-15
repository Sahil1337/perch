// A tiny TTL cache of introspected schemas, keyed by connection + database. Schema reads are the
// most expensive thing the UI does on every panel open, and a schema rarely changes between two
// clicks — so cache it, and let an explicit `?refresh=1` (or a config change) drop it.

import type { DatabaseSchema } from "@perch/protocol";

const KEY_SEP = "::";

export const DEFAULT_SCHEMA_TTL_MS = 30_000;

export class SchemaCache {
  readonly ttlMs: number;
  private readonly entries = new Map<string, { at: number; schema: DatabaseSchema }>();

  constructor(ttlMs: number = DEFAULT_SCHEMA_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  private static key(connectionId: string, database?: string): string {
    return connectionId + KEY_SEP + (database ?? "");
  }

  /** The cached schema, or undefined when absent or older than the TTL. */
  get(connectionId: string, database?: string): DatabaseSchema | undefined {
    const hit = this.entries.get(SchemaCache.key(connectionId, database));
    if (!hit) return undefined;
    if (Date.now() - hit.at >= this.ttlMs) return undefined;
    return hit.schema;
  }

  set(connectionId: string, database: string | undefined, schema: DatabaseSchema): void {
    this.entries.set(SchemaCache.key(connectionId, database), { at: Date.now(), schema });
  }

  /** Forgets every database cached for one connection (its config changed, or it went away). */
  dropConnection(connectionId: string): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(connectionId + KEY_SEP)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
