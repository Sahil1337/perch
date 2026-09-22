import { connectFailureCode, isPerchError } from "@perch/client";
import { ConnectFailed, baseName, messageOf as textOf } from "@perch/ui";

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 10_000;

export { dirName } from "@perch/ui";

/** Named for what it is here: every path this app splits is a file the server opened. */
export const fileName = baseName;

/**
 * The app-side reading of a failure, which knows one thing the package cannot: `@perch/client`
 * throws a `PerchError` carrying the server's own message, and that message is better than
 * anything this side could write. Everything else falls through to the shared reading.
 */
export function messageOf(error: unknown): string {
  return isPerchError(error) ? error.message : textOf(error, "the request failed");
}

export function aborted(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/** Fire-and-forget loads from callbacks and events, where there is no effect to cancel. */
export function detached(): AbortSignal {
  return new AbortController().signal;
}

/**
 * A rejection from a connect or test, re-thrown as the error type the UI branches on. The code the
 * server sent is what turns "it failed" into a password field on the row that failed, so it has to
 * survive the trip from the transport to the component.
 */
export function connectFailure(error: unknown): ConnectFailed {
  return new ConnectFailed(messageOf(error), connectFailureCode(error) ?? "connect_failed", {
    cause: error,
  });
}
