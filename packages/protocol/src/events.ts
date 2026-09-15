import type { FileEvent } from "./files.js";
import type { RunStatus } from "./query.js";

/** Pushed to every connected UI over the SSE stream at GET /api/events. */
export type ServerEvent =
  | { type: "hello"; serverStartedAt: string }
  | { type: "file"; event: FileEvent }
  | { type: "run"; runId: string; status: RunStatus }
  | { type: "roots"; roots: string[] };
