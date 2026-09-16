"use client";

// Editor font size.
//
// Not a server setting. `Settings` is the server's configuration — what it will read, write and
// run — and how large the type is on this screen is none of its business: the same account on a
// laptop and on a 27" display wants two different answers. So it lives in localStorage, shared
// through a tiny store so the Settings dialog and the editor cannot disagree about it.

import * as React from "react";

const KEY = "perch.editor.fontSize";

/** Matches the workspace's 13px body. Anything outside the range is a typo or a bad restore. */
export const EDITOR_FONT_SIZES: readonly number[] = [11, 12, 13, 14, 16, 18];
export const EDITOR_FONT_SIZE_DEFAULT = 13;

const listeners = new Set<() => void>();
let cached: number | null = null;

function read(): number {
  if (cached !== null) return cached;
  let value = EDITOR_FONT_SIZE_DEFAULT;
  try {
    const stored = Number(globalThis.localStorage?.getItem(KEY));
    if (EDITOR_FONT_SIZES.includes(stored)) value = stored;
  } catch {
    // Storage unavailable — the default is a perfectly good answer.
  }
  cached = value;
  return value;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * The editor's font size in px, and a setter that persists it.
 *
 * Returned as a tuple so a consumer that only renders text can write `const [fontSize] =
 * useEditorFontSize()` and ignore the rest.
 */
export function useEditorFontSize(): [number, (size: number) => void] {
  const size = React.useSyncExternalStore(subscribe, read, () => EDITOR_FONT_SIZE_DEFAULT);

  const set = React.useCallback((next: number) => {
    cached = EDITOR_FONT_SIZES.includes(next) ? next : EDITOR_FONT_SIZE_DEFAULT;
    try {
      globalThis.localStorage?.setItem(KEY, String(cached));
    } catch {
      // In-memory only for this session.
    }
    for (const listener of listeners) listener();
  }, []);

  return [size, set];
}
