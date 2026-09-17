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
