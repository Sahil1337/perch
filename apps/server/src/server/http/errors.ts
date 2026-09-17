// The one error the API throws on purpose, and the envelope every failure comes back in.
// Anything else reaching the error handler is a bug and answers 500.

/** An error carrying the HTTP status and machine code the route should answer with. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  /**
   * Extra fields the envelope carries beside `error`, for the failures that answer with more than
   * a message: the stale-write 409 sends the file as it is on disk now, so the UI can show a diff
   * without a second round trip. The error handler spreads them; nothing may overwrite `error`.
   */
  readonly details: Record<string, unknown> | undefined;

  constructor(
    message: string,
    status = 400,
    code = "bad_request",
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (message: string, code = "bad_request"): HttpError =>
  new HttpError(message, 400, code);
export const notFound = (message: string): HttpError => new HttpError(message, 404, "not_found");
export const forbidden = (message: string): HttpError => new HttpError(message, 403, "forbidden");
export const conflict = (
  message: string,
  details?: Record<string, unknown>,
  code = "conflict",
): HttpError => new HttpError(message, 409, code, details);

/** The error body of every failed API response. */
export type ApiError = { message: string; code?: string };

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : String(err);
}
