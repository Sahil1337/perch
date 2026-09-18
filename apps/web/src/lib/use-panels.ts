// Panel geometry: which surfaces are open and how big they are. Per-machine appearance state, so it
// lives in localStorage; behavioural settings (autosave, keywordCase) belong to the server instead.
//
// An external store rather than state seeded from an effect: reading localStorage during render
// would produce markup the static export disagrees with, and reading it in an effect is a setState
// cascade on every mount. `useSyncExternalStore` gives the defaults to the first paint, re-reads
// after hydration, and keeps two tabs in agreement through the `storage` event.

import {
  RESULTS_PANE,
  createExternalStore,
  readJson,
  writeRaw,
  type EditorLayout,
  sanitizeLayout,
} from "@perch/ui";
import type { PanelState } from "@perch/ui";
import * as React from "react";

const STORAGE_KEY = "perch.panels.v1";

/**
 * The grid a first-run user gets: queries above, results below. Every id is spelled out rather than
 * generated, because the export prerenders this layout and a random id would differ between the
 * server's HTML and the client's first render.
 */
const DEFAULT_LAYOUT: EditorLayout = {
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

/**
 * What this session chose, kept beside the store as well as in it: a private window refuses the
 * write, and the panels still have to move when you drag them.
 */
let pending: PanelState | null = null;

/** From a store the user can edit and a release can outgrow: a malformed tree costs an arrangement, not the app. */
function validate(parsed: unknown): PanelState | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const stored = parsed as Partial<PanelState>;
  return {
    ...DEFAULT_PANELS,
    ...stored,
    paletteOpen: false,
    layout: sanitizeLayout(stored.layout, DEFAULT_LAYOUT),
  };
}

const store = createExternalStore<PanelState>(
  () => pending ?? readJson(STORAGE_KEY, validate, DEFAULT_PANELS),
  // The static export renders with defaults; anything else would not match the prerendered HTML.
  DEFAULT_PANELS,
  (invalidate) => {
    const onStorage = (event: StorageEvent): void => {
      if (event.key !== null && event.key !== STORAGE_KEY) return;
      pending = null; // another tab is now the source of truth
      invalidate();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  },
);

function write(next: PanelState): void {
  pending = next;
  const persistable = Object.fromEntries(
    Object.entries(next).filter(([key]) => !TRANSIENT.includes(key as "paletteOpen")),
  );
  writeRaw(STORAGE_KEY, JSON.stringify(persistable));
  store.invalidate();
}

export function usePanels(): {
  panels: PanelState;
  setPanel: <K extends keyof PanelState>(key: K, value: PanelState[K]) => void;
  togglePanel: (key: "sidebarOpen" | "outputOpen" | "paletteOpen") => void;
} {
  const panels = React.useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );

  const setPanel = React.useCallback(
    <K extends keyof PanelState>(key: K, value: PanelState[K]): void => {
      const current = store.getSnapshot();
      if (current[key] === value) return;
      write({ ...current, [key]: value });
    },
    [],
  );

  const togglePanel = React.useCallback(
    (key: "sidebarOpen" | "outputOpen" | "paletteOpen"): void => {
      const current = store.getSnapshot();
      write({ ...current, [key]: !current[key] });
    },
    [],
  );

  return { panels, setPanel, togglePanel };
}
