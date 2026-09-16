"use client";

// Which provider the app runs on: the live one, always. There is no fixture mode, because a SQL
// client that quietly shows invented tables is worse than one that says it cannot reach its server.
// Every row on screen came off the wire, and failures are rendered as failures — see `<ServerGate>`
// and the `server` field of the contract.
//
// The indirection stays so the app has one place that names what it runs on, and so every surface
// imports `useAppWorkspace` rather than the provider itself.

import type { WorkspaceApi } from "@perch/ui";
import { useLiveWorkspace } from "./live-workspace";

/** The provider the app runs on. One call, at the top of the tree. */
export function useAppWorkspace(): WorkspaceApi {
  return useLiveWorkspace();
}
