import type { PerchClient } from "@perch/client";
import type { FileEntry, Settings } from "@perch/protocol";
import { asyncError, type Async } from "@perch/ui";
import * as React from "react";
import { walkWorkspace } from "./walk-workspace";
import { useAsyncResource } from "./use-async-resource";

export type WorkspaceFilesState = {
  workspace: Async<readonly FileEntry[]>;
  roots: readonly string[];
  refresh: () => void;
  refreshWorkspace: () => Promise<void>;
  /** Somewhere to report a file error that has no state channel of its own, such as `openFile`. */
  reportError: (message: string) => void;
};

export function useWorkspaceFiles(
  getClient: () => PerchClient,
  enabled: boolean,
  settings: Settings | undefined,
): WorkspaceFilesState {
  const [serverRoots, setServerRoots] = React.useState<readonly string[]>([]);

  const read = React.useCallback(
    async (signal: AbortSignal): Promise<readonly FileEntry[]> => {
      const files = getClient().files;
      // With no `dir` the server hands back the roots themselves, which is the authority:
      // `perch serve --dir` adds roots that Settings.workspaces never sees.
      const reported = await files.list(undefined, { signal });
      const walked = await walkWorkspace(
        files,
        reported.map((entry) => entry.path),
        signal,
      );
      setServerRoots(walked.roots);
      return walked.entries;
    },
    [getClient],
  );

  const { value: workspace, refresh, reload, set } = useAsyncResource(enabled, read);

  const reportError = React.useCallback(
    (message: string): void => {
      set((previous) => asyncError(message, previous));
    },
    [set],
  );

  return {
    workspace,
    // The roots the server actually serves — `--dir` adds roots Settings.workspaces never sees.
    roots: serverRoots.length > 0 ? serverRoots : (settings?.workspaces ?? []),
    refresh,
    refreshWorkspace: reload,
    reportError,
  };
}
