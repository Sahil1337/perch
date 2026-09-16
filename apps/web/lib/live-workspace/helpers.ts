import { isPerchError } from "@perch/client";

export const RECONNECT_MIN_MS = 1_000;
export const RECONNECT_MAX_MS = 10_000;

/** Server paths are native, so a Windows server sends backslashes. Split on both. */
const SEPARATORS = /[\\/]/;

export function fileName(path: string): string {
  const parts = path.split(SEPARATORS);
  return parts[parts.length - 1] ?? path;
}

export function dirName(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return cut <= 0 ? path : path.slice(0, cut);
}

export function messageOf(error: unknown): string {
  if (isPerchError(error)) return error.message;
  return error instanceof Error ? error.message : "the request failed";
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
