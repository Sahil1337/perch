import type { PerchClient } from "@perch/client";
import type { Settings } from "@perch/protocol";
import { asyncError, asyncReady, type Async } from "@perch/ui";
import * as React from "react";
import { messageOf } from "./helpers";
import { useAsyncResource } from "./use-async-resource";

export type SettingsState = {
  settings: Async<Settings>;
  refresh: () => void;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
};

export function useSettings(getClient: () => PerchClient, enabled: boolean): SettingsState {
  const read = React.useCallback(
    (signal: AbortSignal): Promise<Settings> => getClient().settings.get({ signal }),
    [getClient],
  );
  const { value: settings, refresh, set } = useAsyncResource(enabled, read);

  const updateSettings = React.useCallback(
    async (patch: Partial<Settings>): Promise<void> => {
      try {
        set(asyncReady(await getClient().settings.update(patch)));
      } catch (error) {
        // Not `applyError`: this is a write, not a read, so there is no signal and nothing to
        // abort — and the rethrow below means the error has a caller either way.
        set((previous) => asyncError(messageOf(error), previous));
        // Rethrown, unlike the others: a form is waiting on this one, and swallowing a rejected
        // workspace path would show a "Saved" tick over a patch the server refused.
        throw error;
      }
    },
    [getClient, set],
  );

  return { settings, refresh, updateSettings };
}
