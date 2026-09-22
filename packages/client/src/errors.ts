import type { ConnectFailureCode } from "@perch/protocol";

// One error type for every failure that came back from the server, so a caller never has to
// sniff a bare Error's message to find out what happened.

/**
 * Codes this package raises itself, for the two failures that never reach a route handler. They
 * share the `code` field with the server's own codes, so a caller branches on one thing.
 *
 * `NETWORK` — nothing answered: wrong port, server not started, DNS, a refused connection.
 * `NOT_API` — something answered, but it is not an perch server: a dev server's 404 page,
 * a proxy, a captive portal. The distinction matters because the fix is different for each.
 */
export const NETWORK = "network";
export const NOT_API = "not_api";

/** The body every failing route returns: `{ error: { message, code? } }`. */
export type ApiErrorBody = { error: { message: string; code?: string } };

/**
 * The 409 body from `PUT /api/files/content`. The server sends the file as it is on disk *now*
 * (when it is small enough), so the UI can show a diff without a second round trip.
 */
export type StaleWriteBody = {
  error: { message: string; code?: string };
  modifiedAt: string | null;
  size?: number;
  content?: string;
};

export type PerchErrorInit = {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number;
  /** Method and path, e.g. `PUT /api/files/content`. */
  route: string;
  /** The server's machine-readable code when it sent one: `not_found`, `stale_write`, … */
  code?: string;
  /** The parsed response body, for routes that put more than a message in it. */
  body?: unknown;
  cause?: unknown;
};

export class PerchError extends Error {
  override readonly name = "PerchError";
  readonly status: number;
  readonly route: string;
  readonly code?: string;
  readonly body?: unknown;

  constructor(message: string, init: PerchErrorInit) {
    super(message, { cause: init.cause });
    this.status = init.status;
    this.route = init.route;
    this.code = init.code;
    this.body = init.body;
  }
}

export function isPerchError(err: unknown): err is PerchError {
  return err instanceof PerchError;
}

/** Nothing answered at all — as opposed to answering with a failure. */
export function isNetworkError(err: unknown): boolean {
  return isPerchError(err) && err.code === NETWORK;
}

/** Something answered, but it is not this API. See {@link NOT_API}. */
export function isNotApiError(err: unknown): boolean {
  return isPerchError(err) && err.code === NOT_API;
}

/**
 * Narrows a rejected `files.write` to the optimistic-concurrency conflict, handing back the
 * server's view of the file. Anything else returns undefined.
 */
export function staleWrite(err: unknown): StaleWriteBody | undefined {
  if (!isPerchError(err) || err.status !== 409 || err.code !== "stale_write") return undefined;
  return err.body as StaleWriteBody;
}

/**
 * The reason a connect or test failed, when the server classified it. `undefined` for anything
 * that is not one of those two routes failing — a 404 for a deleted connection, a malformed body,
 * or a rejection this package raised itself.
 */
export function connectFailureCode(err: unknown): ConnectFailureCode | undefined {
  if (!isPerchError(err) || err.code === undefined) return undefined;
  return CONNECT_FAILURE_CODES.has(err.code) ? (err.code as ConnectFailureCode) : undefined;
}

const CONNECT_FAILURE_CODES = new Set<string>([
  "password_required",
  "auth_failed",
  "unknown_user",
  "unknown_database",
  "unreachable",
  "tls_required",
  "connect_failed",
] satisfies ConnectFailureCode[]);
