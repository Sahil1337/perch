// One error envelope for the whole API: `{ error: { message, code? } }`. An HttpError (or Hono's
// own HTTPException) answers with the status it carries; everything else is a bug, so it is a 500
// and gets logged.

import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HttpError, errorMessage, type ApiError } from "../http/errors.js";

export function httpStatus(status: number): ContentfulStatusCode {
  return status as ContentfulStatusCode;
}

export function registerErrorHandler(app: Hono): void {
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const error: ApiError = { message: err.message || "request failed" };
      return c.json({ error }, err.status);
    }
    if (err instanceof HttpError) {
      return c.json({ error: { message: err.message, code: err.code } }, httpStatus(err.status));
    }
    console.error("[perch]", err);
    return c.json({ error: { message: errorMessage(err) } }, 500);
  });

  app.notFound((c) =>
    c.json({ error: { message: `not found: ${c.req.path}`, code: "not_found" } }, 404),
  );
}
