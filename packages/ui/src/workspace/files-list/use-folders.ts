"use client";

import * as React from "react";
import { messageOf } from "../../lib/errors";
import { useWorkspace } from "../context";

/**
 * Opening and closing workspace folders. Shared by the three places that do it: the empty state,
 * the panel header, and the close button on each open folder — so opening the wrong folder is not
 * a one-way door out to a trash icon in Settings.
 */
export function useFolders(): {
  open: (folder: string) => Promise<void>;
  close: (folder: string) => Promise<void>;
  busy: string | null;
  error: string | null;
  clearError: () => void;
} {
  const { roots, updateSettings } = useWorkspace();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const write = React.useCallback(
    async (folder: string, next: string[]): Promise<void> => {
      setBusy(folder);
      setError(null);
      try {
        await updateSettings({ workspaces: next });
      } catch (cause) {
        setError(messageOf(cause));
      } finally {
        setBusy(null);
      }
    },
    [updateSettings],
  );

  return {
    open: React.useCallback(
      async (folder: string) => {
        const value = folder.trim();
        if (value.length === 0 || roots.includes(value)) return;
        await write(value, [...roots, value]);
      },
      [roots, write],
    ),
    // Closing stops perch reading the folder; the path stays under Recent.
    close: React.useCallback(
      async (folder: string) =>
        write(
          folder,
          roots.filter((root) => root !== folder),
        ),
      [roots, write],
    ),
    busy,
    error,
    clearError: React.useCallback(() => setError(null), []),
  };
}
