"use client";

// Editor font size.
//
// Not a server setting. `Settings` is the server's configuration — what it will read, write and
// run — and how large the type is on this screen is none of its business: the same account on a
// laptop and on a 27" display wants two different answers. So it lives in localStorage, shared
// through a tiny store so the Settings dialog and the editor cannot disagree about it.

import * as React from "react";
import { createExternalStore } from "../lib/external-store";
import { readRaw, writeRaw } from "../lib/storage";

const KEY = "perch.editor.fontSize";

/** Matches the workspace's 13px body. Anything outside the range is a typo or a bad restore. */
export const EDITOR_FONT_SIZES: readonly number[] = [11, 12, 13, 14, 16, 18];
const DEFAULT = 13;

/** What this session chose. Held here too, so a store that refuses the write still applies it. */
let chosen: number | null = null;

const store = createExternalStore(() => {
  if (chosen !== null) return chosen;
  const stored = Number(readRaw(KEY));
  return EDITOR_FONT_SIZES.includes(stored) ? stored : DEFAULT;
}, DEFAULT);

/**
 * The editor's font size in px, and a setter that persists it.
 *
 * Returned as a tuple so a consumer that only renders text can write `const [fontSize] =
 * useEditorFontSize()` and ignore the rest.
 */
export function useEditorFontSize(): [number, (size: number) => void] {
  const size = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const set = React.useCallback((next: number) => {
    chosen = EDITOR_FONT_SIZES.includes(next) ? next : DEFAULT;
    writeRaw(KEY, String(chosen));
    store.invalidate();
  }, []);

  return [size, set];
}
