// The one error the API throws on purpose, and the envelope every failure comes back in.
// Anything else reaching the error handler is a bug and answers 500.

/** An error carrying the HTTP status and machine code the route should answer with. */
export class HttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 400, code = "bad_request") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}

export const badRequest = (message: string, code = "bad_request"): HttpError =>
  new HttpError(message, 400, code);
export const notFound = (message: string): HttpError => new HttpError(message, 404, "not_found");
export const forbidden = (message: string): HttpError => new HttpError(message, 403, "forbidden");
export const conflict = (message: string): HttpError => new HttpError(message, 409, "conflict");

/** The error body of every failed API response. */
export type ApiError = { message: string; code?: string };

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === "string" ? err : String(err);
}
