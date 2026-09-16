"use client";

import * as React from "react";
import { applyTheme, storedTheme } from "../lib/theme";
import { useWorkspace } from "../workspace/context";
import { asyncData } from "../workspace/types";

/**
 * Keeps the document on the theme the server says, and the paint hint on what the document shows.
 *
 * Renders nothing and lives above every screen — the gate, the welcome flow and the workspace are
 * all painted in whatever the boot script decided, and this is what corrects it once settings
 * land. Nothing happens until they do: writing the default into the DOM while the request is in
 * flight would undo the hint and flash dark at exactly the person who chose light.
 */
export function ThemeSync(): null {
  const { settings } = useWorkspace();
  const theme = asyncData(settings)?.theme;

  // Strict Mode remounts once in development, and on that remount React resets <html> to the
  // attributes it manages from JSX — taking the class the boot script set with it. Re-applying the
  // hint before paint puts it back. In production this runs once and agrees with the DOM already.
  React.useLayoutEffect(() => {
    const stored = storedTheme();
    if (stored) applyTheme(stored);
  }, []);

  React.useEffect(() => {
    if (theme) applyTheme(theme);
  }, [theme]);

  return null;
}
