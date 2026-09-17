// localStorage, with the two facts about it that every call site otherwise repeats: it throws in a
// private window or with site data blocked, and what comes out of it is whatever a previous release
// (or the user's devtools) left behind. So reads are validated by the caller and both directions
// are wrapped — a store that is missing, full or blocked costs the convenience it held, never the
// app.
//
// Only per-viewer conveniences belong here. Anything the server owns is a setting, and goes over
// HTTP instead.

/**
 * Reads and parses a key, handing the parsed value to `validate` to accept or reject. Anything
 * unreadable, unparseable or rejected yields `fallback`.
 */
export function readJson<T>(
  key: string,
  validate: (value: unknown) => T | undefined,
  fallback: T,
): T {
  try {
    const raw = globalThis.localStorage?.getItem(key);
    if (raw === null || raw === undefined) return fallback;
    return validate(JSON.parse(raw) as unknown) ?? fallback;
  } catch {
    return fallback;
  }
}

/** Reads a key without parsing it. `null` for absent, unreadable, or a throwing store. */
export function readRaw(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Persists a value as JSON. A store that is full or blocked simply does not remember it. */
export function writeJson(key: string, value: unknown): void {
  writeRaw(key, JSON.stringify(value));
}

/** Persists an already-serialised value. */
export function writeRaw(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Storage unavailable — the session still works, it just will not be remembered.
  }
}

/** Forgets a key. Nothing to clear, or nowhere to clear it from, is the same outcome. */
export function remove(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    // Nothing to clear, or nowhere to clear it from.
  }
}
