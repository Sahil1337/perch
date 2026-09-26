import type { ConnectFailureCode } from "@perch/protocol";

/**
 * The one place a thrown value becomes something a user can read.
 *
 * Every action in the workspace contract rejects with an `Error`, but a `catch` binding is `unknown`
 * and a bad promise can carry anything, so this is written once rather than as a ternary at each of
 * the dozen call sites that render a failure.
 *
 * A value that is neither an `Error` nor a string has no readable message in it — stringifying it
 * puts `[object Object]` in front of the user — so callers pass the sentence that fits their
 * surface instead.
 */
export function messageOf(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : fallback;
}

/**
 * A connect or test that failed for a reason the server named. The code is what lets a surface
 * answer the failure instead of only reporting it: a refused password becomes a password field on
 * the row that failed, and a server that is not running becomes a sentence about starting it.
 *
 * Thrown by the workspace provider, which is the only thing that talks to the server; every
 * surface in here receives it.
 */
export class ConnectFailed extends Error {
  override readonly name = "ConnectFailed";
  readonly code: ConnectFailureCode;

  constructor(message: string, code: ConnectFailureCode, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

/** The code off a rejection, when it carries one. */
export function failureCodeOf(error: unknown): ConnectFailureCode | undefined {
  return error instanceof ConnectFailed ? error.code : undefined;
}

/** Whether the failure is one more password would fix. */
export function isPasswordFailure(error: unknown): boolean {
  const code = failureCodeOf(error);
  return code === "password_required" || code === "auth_failed";
}
