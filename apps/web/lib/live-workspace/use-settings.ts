"use client";

import type { PerchClient } from "@perch/client";
import type { Settings } from "@perch/protocol";
import { asyncError, asyncLoading, asyncReady, asyncRefreshing, type Async } from "@perch/ui";
import * as React from "react";
import { aborted, detached, messageOf } from "./helpers";

export type SettingsApi = {
  settings: Async<Settings>;
  refresh: () => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
};

export function useSettings(getClient: () => PerchClient, enabled: boolean): SettingsApi {
  const [settings, setSettings] = React.useState<Async<Settings>>(asyncLoading);

  const load = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      setSettings((prev) => asyncRefreshing(prev));
      try {
        setSettings(asyncReady(await getClient().settings.get({ signal })));
      } catch (error) {
        if (!aborted(error)) setSettings((prev) => asyncError(messageOf(error), prev));
      }
    },
    [getClient],
  );

  React.useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [enabled, load]);

  const refresh = React.useCallback((): void => void load(detached()), [load]);

  const updateSettings = React.useCallback(
    async (patch: Partial<Settings>): Promise<void> => {
      try {
        setSettings(asyncReady(await getClient().settings.update(patch)));
      } catch (error) {
        setSettings((prev) => asyncError(messageOf(error), prev));
        // Rethrown, unlike the others: a form is waiting on this one, and swallowing a rejected
        // workspace path would show a "Saved" tick over a patch the server refused.
        throw error;
      }
    },
    [getClient],
  );

  return { settings, refresh, updateSettings };
}
