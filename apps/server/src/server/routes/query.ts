// POST /api/query (NDJSON stream) and POST /api/query/sync (one JSON reply). Both build the same
// run input; only the way the events reach the client differs.

import { randomUUID } from "node:crypto";
import type { Context, Hono } from "hono";
import type { RunEvent } from "@perch/protocol";
import { bool, num, readJsonBody, str } from "../http/body.js";
import { streamNdjson } from "../http/ndjson.js";
import { badRequest, errorMessage } from "../http/errors.js";
import type { StartRunInput } from "../services/query-runner.js";
import type { RouteDeps } from "../create-server.js";

/** How hard we chase a cancel for a client that disconnected mid-run. */
const CANCEL_ATTEMPTS = 40;
const CANCEL_RETRY_MS = 25;

export function registerQueryRoutes(app: Hono, deps: RouteDeps): void {
  const { pool, runner } = deps;

  async function runInputFrom(c: Context): Promise<StartRunInput & { runId: string }> {
    const body = await readJsonBody(c);
    const connectionId = str(body.connectionId);
    if (!connectionId) throw badRequest("connectionId is required");
    const sql = typeof body.sql === "string" ? body.sql : "";
    if (sql.trim() === "") throw badRequest("sql is required");
    // Surfaces an unknown connection as a 404 before we commit to a streaming response.
    const config = await pool.config(connectionId);
    return {
      connectionId: config.id,
      sql,
      database: str(body.database),
      runId: str(body.runId) ?? randomUUID(),
      maxRows: num(body.maxRows),
      timeoutMs: num(body.timeoutMs),
      batchSize: num(body.batchSize),
      record: bool(body.record),
      readOnly: bool(body.readOnly),
      source: (str(body.source) === "cli" ? "cli" : "ui") as "ui" | "cli",
    };
  }

  app.post("/api/query", async (c) => {
    const input = await runInputFrom(c);
    let finished = false;
    /**
     * The client went away. The run may not have reached the driver yet, so keep asking until
     * the cancel lands or the run ends on its own.
     */
    const cancel = async (): Promise<void> => {
      for (let attempt = 0; attempt < CANCEL_ATTEMPTS && !finished; attempt++) {
        if (await runner.cancelRun(input.runId)) return;
        await new Promise((resolve) => setTimeout(resolve, CANCEL_RETRY_MS));
      }
    };
    return streamNdjson(
      c,
      async (out) => {
        const emit = (event: RunEvent): void => out.write(event);
        try {
          await runner.startRun(input, emit);
        } catch (err) {
          const error = { message: errorMessage(err) };
          emit({ type: "error", runId: input.runId, index: 0, error });
          emit({ type: "done", runId: input.runId, status: "error", durationMs: 0 });
        } finally {
          finished = true;
        }
      },
      () => void cancel(),
    );
  });

  app.post("/api/query/sync", async (c) => c.json(await runner.startRun(await runInputFrom(c))));
}
