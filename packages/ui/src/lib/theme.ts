// The theme, and the two places it has to be true at once.
//
// The preference lives on the server with the rest of settings, so a second browser opens into the
// same app. But <html> has to carry the class before the first frame, which happens long before an
// HTTP round trip comes back — and here a round trip costs a white flash on a dark app, not a
// spinner. So the resolved theme is mirrored into localStorage and replayed by a blocking script in
// <head>. The server stays the source of truth; the mirror is a paint hint, never read as the
// setting, and may be one load stale.

import type { Settings } from "@perch/protocol";

/** Where the paint hint lives. Written by `applyTheme`, read by `THEME_BOOT_SCRIPT`. */
export const THEME_STORAGE_KEY = "perch.theme";

/**
 * Puts a theme on the document and remembers it for the next load.
 *
 * A class, not an attribute: that is the variant Tailwind is configured with
 * (`@custom-variant dark`), so one class on <html> re-points every token underneath it — including
 * the editor's, which reads the same variables through `EditorView.theme`.
 */
export function applyTheme(theme: Settings["theme"]): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private windows and blocked site data. The theme still applies; it just is not remembered,
    // which costs one flash on the next load and nothing else.
  }
}

/** The hint, if this browser has one. Not the setting — the server owns that. */
export function storedTheme(): Settings["theme"] | undefined {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" ? stored : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Runs in <head> before the body paints, so it depends on nothing — not React, not the bundle, not
 * the server. The markup ships with `dark` already on <html>, so this only ever takes it *off*: a
 * stored `light` is corrected before the first frame, and JS-disabled (or throwing storage) lands
 * on the default rather than on whatever the last DOM write left behind.
 */
export const THEME_BOOT_SCRIPT =
  `try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="light")` +
  `document.documentElement.classList.remove("dark")}catch(e){}`;
