// /api/connections — CRUD plus the lifecycle verbs (test, connect, disconnect, databases).
// The schema tree hanging off a connection lives in routes/schema.ts.

import type { Hono } from "hono";
import type { ConnectionConfig, Dialect } from "@perch/protocol";
import { defaultPort, parseConnectionUrl } from "../../db/url.js";
import { listConnections, removeConnection, upsertConnection } from "../../storage/index.js";
import { bool, num, readJsonBody, str, type JsonBody } from "../http/body.js";
import { badRequest, conflict, errorMessage } from "../http/errors.js";
import type { RouteDeps } from "../create-server.js";

/** `db/url.ts` throws plain Errors; the API has to answer them in its own envelope. */
function configFromUrl(raw: string): Partial<ConnectionConfig> {
  try {
    return parseConnectionUrl(raw);
  } catch (err) {
    throw badRequest(errorMessage(err));
  }
}

/** Builds the stored config from a create/update body, merging over `existing` for PUT. */
function connectionFromBody(
  body: JsonBody,
  existing?: ConnectionConfig,
): Omit<ConnectionConfig, "id" | "createdAt"> {
  const fromUrl = str(body.url) ? configFromUrl(String(body.url)) : {};
  const merged: Partial<ConnectionConfig> = { ...existing, ...fromUrl };

  const name = str(body.name) ?? merged.name;
  if (!name) throw badRequest("name is required");

  const dialect = (str(body.dialect) as Dialect | undefined) ?? merged.dialect ?? "postgres";
  if (dialect !== "postgres" && dialect !== "mysql") {
    throw badRequest(`unsupported dialect: ${dialect}`);
  }

  const config: Omit<ConnectionConfig, "id" | "createdAt"> = {
    name,
    dialect,
    host: str(body.host) ?? merged.host ?? "localhost",
    port: num(body.port) ?? merged.port ?? defaultPort(dialect),
    user: str(body.user) ?? merged.user ?? "",
    database: str(body.database) ?? merged.database ?? (dialect === "mysql" ? "" : "postgres"),
  };
  const password = typeof body.password === "string" ? body.password : merged.password;
  if (password !== undefined) config.password = password;
  const ssl = bool(body.ssl) ?? merged.ssl;
  if (ssl !== undefined) config.ssl = ssl;
  const options = (body.options ?? merged.options) as ConnectionConfig["options"];
  if (options !== undefined) config.options = options;
  return config;
}

export function registerConnectionsRoutes(app: Hono, deps: RouteDeps): void {
  const { pool } = deps;

  app.get("/api/connections", async (c) => c.json(await pool.summaries()));

  app.post("/api/connections", async (c) => {
    const body = await readJsonBody(c);
    const input = connectionFromBody(body);
    const existing = (await listConnections()).find((conn) => conn.name === input.name);
    if (existing) throw conflict(`a connection named ${input.name} already exists`);
    const saved = await upsertConnection(input);
    return c.json(pool.summary(saved), 201);
  });

  app.put("/api/connections/:id", async (c) => {
    const current = await pool.config(c.req.param("id"));
    const body = await readJsonBody(c);
    const saved = await upsertConnection({ ...connectionFromBody(body, current), id: current.id });
    await pool.forget(current.id);
    return c.json(pool.summary(saved));
  });

  app.delete("/api/connections/:id", async (c) => {
    const current = await pool.config(c.req.param("id"));
    await pool.forget(current.id);
    return c.json({ ok: await removeConnection(current.id) });
  });

  app.post("/api/connections/:id/test", async (c) => c.json(await pool.test(c.req.param("id"))));

  app.post("/api/connections/:id/connect", async (c) =>
    c.json(await pool.connect(c.req.param("id"))),
  );

  app.post("/api/connections/:id/disconnect", async (c) =>
    c.json(await pool.disconnect(c.req.param("id"))),
  );

  app.get("/api/connections/:id/databases", async (c) =>
    c.json(await pool.databases(c.req.param("id"))),
  );
}
