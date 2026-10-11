import type { WorkspaceApi } from "@perch/ui";
import * as React from "react";
import { createReplayWorkspace } from "./store";
import type { ReplayInput, ReplayWorkspace } from "./types";

/**
 * The replayed workspace for one component's lifetime: the store is created on first render from
 * `input` (later changes to `input` are ignored, like a provider's initial props) and its snapshot
 * is the `WorkspaceApi` to hand to `WorkspaceProvider`.
 */
export function useReplayWorkspace(input: ReplayInput): { api: WorkspaceApi; store: ReplayWorkspace } {
  const [store] = React.useState(() => createReplayWorkspace(input));
  const api = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return { api, store };
}
