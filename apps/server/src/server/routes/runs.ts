// /api/runs — the in-memory run log: cancel, list, fetch one with its rows, and export a
// statement's rows as CSV or JSON.

import type { Hono } from "hono";
import { num } from "../http/body.js";
import { badRequest, notFound } from "../http/errors.js";
import { toCsv } from "../http/csv.js";
import type { RouteDeps } from "../create-server.js";

export function registerRunsRoutes(app: Hono, deps: RouteDeps): void {
  const { runLog, runner } = deps;

  app.post("/api/runs/:id/cancel", async (c) =>
    c.json({ cancelled: await runner.cancelRun(c.req.param("id")) }),
  );

  app.get("/api/runs", (c) => c.json(runLog.list()));

  app.get("/api/runs/:id", (c) => {
    const run = runLog.get(c.req.param("id"));
    if (!run) throw notFound(`no such run: ${c.req.param("id")}`);
    return c.json(run);
  });

  app.get("/api/runs/:id/export", (c) => {
    const run = runLog.get(c.req.param("id"));
    if (!run) throw notFound(`no such run: ${c.req.param("id")}`);
    const format = (c.req.query("format") ?? "csv").toLowerCase();
    const index = num(c.req.query("statement")) ?? 0;
    const result = run.results?.[index];
    if (!result) throw notFound(`run has no statement ${index}`);
    const names = result.columns.map((column) => column.name);
    const stamp = `${run.id.slice(0, 8)}-${index}`;
    if (format === "json") {
      const rows = result.rows.map((row) =>
        Object.fromEntries(names.map((name, i) => [name, row[i] ?? null])),
      );
      c.header("Content-Type", "application/json; charset=utf-8");
      c.header("Content-Disposition", `attachment; filename="perch-${stamp}.json"`);
      return c.body(JSON.stringify(rows, null, 2) + "\n");
    }
    if (format !== "csv") throw badRequest(`unsupported export format: ${format}`);
    c.header("Content-Type", "text/csv; charset=utf-8");
    c.header("Content-Disposition", `attachment; filename="perch-${stamp}.csv"`);
    return c.body(toCsv(names, result.rows));
  });
}
