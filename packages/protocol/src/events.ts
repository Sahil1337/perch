import type { FileEvent } from "./files.js";
import type { RunStatus } from "./query.js";

/** Pushed to every connected UI over the SSE stream at GET /api/events. */
export type ServerEvent =
  | { type: "hello"; serverStartedAt: string }
  | { type: "file"; event: FileEvent }
  | { type: "run"; runId: string; status: RunStatus }
  | { type: "roots"; roots: string[] }
  | TransactionEvent;

/**
 * A transaction a session key held ended without a run ending it: rolled back after 15 minutes
 * idle, released (the tab closed), on a disconnect, or with the connection lost under it.
 */
export type TransactionEvent = {
  type: "transaction";
  connectionId: string;
  sessionKey: string;
  database: string;
  state: "closed";
  reason: "idle" | "released" | "disconnected" | "lost";
};
