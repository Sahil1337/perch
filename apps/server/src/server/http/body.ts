// Reading and coercing request bodies and query parameters. HTTP hands everything over as
// strings (or as whatever JSON.parse made of it), so every route needs the same three coercions
// and the same "was that actually a JSON object?" check — written once, here.

import { badRequest } from "./errors.js";

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function bool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

export type JsonBody = Record<string, unknown>;

export async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<JsonBody> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw badRequest("a JSON body is required");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw badRequest("the body must be a JSON object");
  }
  return parsed as JsonBody;
}
