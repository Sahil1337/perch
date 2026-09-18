"use client";

// One server-backed value, read when the gate opens and re-read on demand.
//
// Three hooks were writing the same eight lines: mark the current value as refetching, await the
// read, store it or store the failure with whatever was already on screen, and hang the whole thing
// off an effect that aborts on teardown. The rule that made them identical is the one in
// `types.ts` — a refetch never blanks a populated view — so it belongs in one place rather than
// three, where a fourth surface could get it subtly wrong.
//
// Not every reader fits: `useConnections` and `useSchema` key their effects on more than `enabled`
// (a connection id, a database, a refresh nonce), so they keep their own effects and reuse
// `applyError` alone.

import { asyncError, asyncLoading, asyncReady, asyncRefreshing, type Async } from "@perch/ui";
import * as React from "react";
import { aborted, detached, messageOf } from "./helpers";

export type AsyncResource<T> = {
  readonly value: Async<T>;
  /** Re-reads without anything to await. For buttons, events and callbacks. */
  refresh: () => void;
  /** The same read, awaitable — the shape the workspace contract asks for. */
  reload: () => Promise<void>;
  /** For a write that already has the new value, or a failure from outside the read. */
  set: React.Dispatch<React.SetStateAction<Async<T>>>;
};

/**
 * @param enabled gates the mount read. Nothing is requested until the server has answered.
 * @param read must be a stable callback: its identity is what re-runs the read.
 */
export function useAsyncResource<T>(
  enabled: boolean,
  read: (signal: AbortSignal) => Promise<T>,
): AsyncResource<T> {
  const [value, set] = React.useState<Async<T>>(asyncLoading);

  const load = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      set((previous) => asyncRefreshing(previous));
      try {
        set(asyncReady(await read(signal)));
      } catch (error) {
        applyError(set, error);
      }
    },
    [read],
  );

  useAbortable(enabled, load);

  const refresh = React.useCallback((): void => void load(detached()), [load]);
  const reload = React.useCallback((): Promise<void> => load(detached()), [load]);

  return { value, refresh, reload, set };
}

/**
 * How every read here writes a failure: an abort is the caller's own teardown rather than something
 * gone wrong, and a failure keeps the last good data so the view degrades instead of emptying.
 */
export function applyError<T>(
  set: React.Dispatch<React.SetStateAction<Async<T>>>,
  error: unknown,
): void {
  if (aborted(error)) return;
  set((previous) => asyncError(messageOf(error), previous));
}

/**
 * Runs `work` with a signal while `enabled`, and aborts it on teardown. `work` must be a stable
 * callback — its identity is the effect's only other key, so whatever it closes over belongs in
 * its own dependency list.
 */
export function useAbortable(
  enabled: boolean,
  work: (signal: AbortSignal) => void | Promise<void>,
): void {
  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void work(controller.signal);
    return () => controller.abort();
  }, [enabled, work]);
}
