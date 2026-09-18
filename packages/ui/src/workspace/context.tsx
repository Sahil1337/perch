import * as React from "react";
import type { WorkspaceApi } from "./types";

const WorkspaceContext = React.createContext<WorkspaceApi | null>(null);

/**
 * Supplies the workspace contract to every surface below it.
 *
 * The implementation is deliberately not here: apps/web builds it over @perch/client, and this
 * package never learns how. That is what keeps every component in it testable against a shape
 * rather than against a server, and it is one prop to replace.
 */
export function WorkspaceProvider({
  value,
  children,
}: {
  value: WorkspaceApi;
  children: React.ReactNode;
}): React.ReactElement {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const api = React.useContext(WorkspaceContext);
  if (!api) throw new Error("useWorkspace must be called inside a <WorkspaceProvider>.");
  return api;
}
