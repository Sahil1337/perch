"use client";

// Panel geometry: which surfaces are open and how big they are. Per-machine appearance state, so it
// lives in localStorage; behavioural settings (autosave, keywordCase) belong to the server instead.
//
// An external store rather than state seeded from an effect: reading localStorage during render
// would produce markup the static export disagrees with, and reading it in an effect is a setState
// cascade on every mount. `useSyncExternalStore` gives the defaults to the first paint, re-reads
// after hydration, and keeps two tabs in agreement through the `storage` event.

import { RESULTS_PANE, type EditorLayout, sanitizeLayout } from "@perch/ui";
import type { PanelState } from "@perch/ui";
import * as React from "react";

const STORAGE_KEY = "perch.panels.v1";

/**
 * The grid a first-run user gets: queries above, results below. Every id is spelled out rather than
 * generated, because the export prerenders this layout and a random id would differ between the
 * server's HTML and the client's first render.
 */
export const DEFAULT_LAYOUT: EditorLayout = {
  root: {
    kind: "branch",
    id: "branch-root",
    direction: "column",
    children: [
      { kind: "group", id: "group-editor", panes: [], activePane: null },
      { kind: "group", id: "group-results", panes: [RESULTS_PANE], activePane: RESULTS_PANE },
    ],
    sizes: [62, 38],
  },
  focusedGroup: "group-editor",
};

export const DEFAULT_PANELS: PanelState = {
  sidebarOpen: true,
  sidebarWidth: 256,
  sidebarTab: "schema",
  outputOpen: true,
  resultsView: "results",
  paletteOpen: false,
  layout: DEFAULT_LAYOUT,
};

/** Never persisted: reopening the app inside a command palette would be a surprise. */
const TRANSIENT = ["paletteOpen"] as const satisfies readonly (keyof PanelState)[];

const listeners = new Set<() => void>();

/**
 * getSnapshot must return a referentially stable value while nothing has changed, or React
 * re-renders forever. Keyed on the raw string so a parse only happens when the storage actually
 * differs — including when another tab wrote it.
 */
let cache: { raw: string | null; value: PanelState } = { raw: null, value: DEFAULT_PANELS };

/** Panel state the user changed this session but has not been flushed into `cache` yet. */
let pending: PanelState | null = null;

function rawFromStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private windows and blocked site data both throw. Defaults are a fine outcome.
    return null;
  }
}

function parse(raw: string | null): PanelState {
  if (!raw) return DEFAULT_PANELS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PANELS;
    const stored = parsed as Partial<PanelState>;
    // From a store the user can edit and a release can outgrow: a malformed tree costs an
    // arrangement, not the app.
    return {
      ...DEFAULT_PANELS,
      ...stored,
      paletteOpen: false,
      layout: sanitizeLayout(stored.layout, DEFAULT_LAYOUT),
    };
  } catch {
    return DEFAULT_PANELS;
  }
}

function getSnapshot(): PanelState {
  if (pending) return pending;
  const raw = rawFromStorage();
  if (raw !== cache.raw) cache = { raw, value: parse(raw) };
  return cache.value;
}

/** The static export renders with defaults; anything else would not match the prerendered HTML. */
function getServerSnapshot(): PanelState {
  return DEFAULT_PANELS;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent): void => {
    if (event.key !== null && event.key !== STORAGE_KEY) return;
    pending = null; // another tab is now the source of truth
    for (const l of listeners) l();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function write(next: PanelState): void {
  pending = next;
  try {
    const persistable = Object.fromEntries(
      Object.entries(next).filter(([key]) => !TRANSIENT.includes(key as "paletteOpen")),
    );
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
  } catch {
    // Storage unavailable — the session still works, it just will not be remembered.
  }
  for (const l of listeners) l();
}

export function usePanels(): {
  panels: PanelState;
  setPanel: <K extends keyof PanelState>(key: K, value: PanelState[K]) => void;
  togglePanel: (key: "sidebarOpen" | "outputOpen" | "paletteOpen") => void;
} {
  const panels = React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPanel = React.useCallback(
    <K extends keyof PanelState>(key: K, value: PanelState[K]): void => {
      const current = getSnapshot();
      if (current[key] === value) return;
      write({ ...current, [key]: value });
    },
    [],
  );

  const togglePanel = React.useCallback((key: "sidebarOpen" | "outputOpen" | "paletteOpen"): void => {
    const current = getSnapshot();
    write({ ...current, [key]: !current[key] });
  }, []);

  return { panels, setPanel, togglePanel };
}
