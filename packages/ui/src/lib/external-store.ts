// A module-scoped value shared by every component that asks for it, read through
// `useSyncExternalStore`.
//
// The pattern, once: state seeded from an effect is a setState cascade on every mount, and reading
// a browser store during render produces markup the static export disagrees with.
// `useSyncExternalStore` gives the server snapshot to the first paint, re-reads after hydration and
// re-renders every subscriber when the value changes.
//
// `getSnapshot` must return a referentially stable value while nothing has changed, or React
// re-renders forever — so the snapshot is cached and only recomputed when the store says it is
// dirty.

export type ExternalStore<T> = {
  /** For `useSyncExternalStore`'s first argument. */
  subscribe: (listener: () => void) => () => void;
  /** For its second. Cached, so repeated calls between changes return the same reference. */
  getSnapshot: () => T;
  /** For its third: what the static export renders, which must not depend on the browser. */
  getServerSnapshot: () => T;
  /** Drops the cached snapshot and re-renders every subscriber. */
  invalidate: () => void;
};

/**
 * @param read computes the current value. Called only when the cache is cold.
 * @param serverValue what the first, pre-hydration paint sees.
 * @param onActive optional side effect kept alive while at least one subscriber exists.
 */
export function createExternalStore<T>(
  read: () => T,
  serverValue: T,
  onActive?: (invalidate: () => void) => () => void,
): ExternalStore<T> {
  const listeners = new Set<() => void>();
  let cached: { value: T } | null = null;
  let stop: (() => void) | null = null;

  const invalidate = (): void => {
    cached = null;
    for (const listener of listeners) listener();
  };

  const getSnapshot = (): T => {
    cached ??= { value: read() };
    return cached.value;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    if (onActive && stop === null) stop = onActive(invalidate);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && stop) {
        stop();
        stop = null;
      }
    };
  };

  return { subscribe, getSnapshot, getServerSnapshot: () => serverValue, invalidate };
}
