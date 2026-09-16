"use client";

import type { PerchClient } from "@perch/client";
import type { FileEntry, Settings } from "@perch/protocol";
import { asyncError, asyncLoading, asyncReady, asyncRefreshing, type Async } from "@perch/ui";
import * as React from "react";
import { aborted, detached, messageOf } from "./helpers";
import { walkWorkspace } from "./walk-workspace";

export type WorkspaceFilesApi = {
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
): WorkspaceFilesApi {
  const [workspace, setWorkspace] = React.useState<Async<readonly FileEntry[]>>(asyncLoading);
  const [serverRoots, setServerRoots] = React.useState<readonly string[]>([]);

  const load = React.useCallback(
    async (signal: AbortSignal): Promise<void> => {
      setWorkspace((prev) => asyncRefreshing(prev));
      try {
        const files = getClient().files;
        // With no `dir` the server hands back the roots themselves, which is the authority:
        // `perch serve --dir` adds roots that Settings.workspaces never sees.
        const reported = await files.list(undefined, { signal });
        const walked = await walkWorkspace(files, reported.map((entry) => entry.path), signal);
        setServerRoots(walked.roots);
        setWorkspace(asyncReady(walked.entries));
      } catch (error) {
        if (!aborted(error)) setWorkspace((prev) => asyncError(messageOf(error), prev));
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
  const refreshWorkspace = React.useCallback((): Promise<void> => load(detached()), [load]);

  const reportError = React.useCallback((message: string): void => {
    setWorkspace((prev) => asyncError(message, prev));
  }, []);

  return {
    workspace,
    // The roots the server actually serves — `--dir` adds roots Settings.workspaces never sees.
    roots: serverRoots.length > 0 ? serverRoots : (settings?.workspaces ?? []),
    refresh,
    refreshWorkspace,
    reportError,
  };
}
