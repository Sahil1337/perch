"use client";

// The implementation of WorkspaceApi, backed by `perch serve` through @perch/client. There is no
// fixture provider and no offline mode, so everything any surface renders came off the wire.
// Derived-not-stored is the rule throughout: schema staleness is computed from what loaded versus
// what is wanted, never written into state by an effect.
//
// Actions report failures through state rather than rejecting. The exceptions are the ones whose
// return value *is* the answer and so have no state channel to fail into: `testConnection`,
// `addConnection`/`updateConnection`, and `discoverServers`.
//
// Each concern below is its own hook; this file is where they are wired to each other — the server
// gate that enables them all, and the three seams between them: a run's DDL re-introspects the
// schema, a save-as relists the workspace, and a file event reaches whichever buffer holds it.

import type { PerchClient } from "@perch/client";
import type { BrowseResult, ServerEvent } from "@perch/protocol";
import { asyncData, type WorkspaceApi } from "@perch/ui";
import * as React from "react";
import { serverClient } from "../server-client";
import { usePanels } from "../use-panels";
import { useBuffers } from "./use-buffers";
import { useConnections } from "./use-connections";
import { useRuns } from "./use-runs";
import { useSchema } from "./use-schema";
import { useServerEvents } from "./use-server-events";
import { useServerGate } from "./use-server-gate";
import { useSettings } from "./use-settings";
import { useWorkspaceFiles } from "./use-workspace-files";

export type LiveWorkspaceOptions = {
  /** Injected by tests; the shared singleton otherwise. */
  client?: PerchClient;
};

export function useLiveWorkspace(options: LiveWorkspaceOptions = {}): WorkspaceApi {
  const { client: injected } = options;
  // Built on first use: it reads `window.location.origin`, absent when the export is prerendered.
  const getClient = React.useCallback((): PerchClient => injected ?? serverClient(), [injected]);

  /** Every load and effect below is gated on this, so a gated app makes exactly one request. */
  const { server, enabled } = useServerGate(getClient, injected);

  const { settings, refresh: refreshSettings, updateSettings } = useSettings(getClient, enabled);
  const settingsData = asyncData(settings);

  const {
    workspace,
    roots,
    refresh: refreshFiles,
    refreshWorkspace,
    reportError: reportFileError,
  } = useWorkspaceFiles(getClient, enabled, settingsData);

  const connections = useConnections(getClient, enabled);
  const { schema, reintrospect, refreshSchema } = useSchema(
    getClient,
    enabled,
    connections.connectionId,
    connections.database,
  );

  const { syncExternalFile, ...buffers } = useBuffers(getClient, enabled, {
    autosave: settingsData?.autosave ?? true,
    autosaveDelayMs: settingsData?.autosaveDelayMs ?? 1200,
    reportFileError,
    refreshWorkspace: refreshFiles,
  });

  const { panels, setPanel, togglePanel } = usePanels();
  const openOutput = React.useCallback((): void => setPanel("outputOpen", true), [setPanel]);

  const runs = useRuns(getClient, enabled, {
    connectionId: connections.connectionId,
    database: connections.database,
    connectionDatabase: connections.connection?.database,
    activeSql: buffers.activeBuffer?.content,
    settings: settingsData,
    onSchemaChanged: reintrospect,
    openOutput,
  });

  const onServerEvent = React.useCallback(
    (event: ServerEvent): void => {
      // A `run` event is this client's own run coming back; the record is already held.
      if (event.type === "roots") {
        refreshSettings();
        refreshFiles();
        return;
      }
      if (event.type !== "file") return;
      const change = event.event;
      if (change.type !== "change") {
        // The listing moved. An open buffer stays open: its text is the last copy that exists.
        refreshFiles();
        return;
      }
      if (change.created) refreshFiles();
      syncExternalFile(change.path, change.modifiedAt);
    },
    [refreshFiles, refreshSettings, syncExternalFile],
  );

  useServerEvents(getClient, enabled, onServerEvent);

  const browse = React.useCallback(
    (path?: string): Promise<BrowseResult> =>
      getClient().browse(path === undefined ? {} : { path }),
    [getClient],
  );

  return {
    connections: connections.connections,
    connectionId: connections.connectionId,
    connection: connections.connection,
    database: connections.database,
    databases: connections.databases,
    connect: connections.connect,
    selectDatabase: connections.selectDatabase,
    addConnection: connections.addConnection,
    updateConnection: connections.updateConnection,
    removeConnection: connections.removeConnection,
    testConnection: connections.testConnection,
    discoverServers: connections.discoverServers,

    schema,
    refreshSchema,

    buffers: buffers.buffers,
    activeBufferId: buffers.activeBufferId,
    activeBuffer: buffers.activeBuffer,
    saveState: buffers.saveState,
    newScratch: buffers.newScratch,
    openFile: buffers.openFile,
    closeBuffer: buffers.closeBuffer,
    focusBuffer: buffers.focusBuffer,
    editBuffer: buffers.editBuffer,
    setBufferView: buffers.setBufferView,
    save: buffers.save,
    saveAs: buffers.saveAs,
    resolveConflict: buffers.resolveConflict,

    workspace,
    roots,
    refreshWorkspace,

    cursor: buffers.cursor,
    setCursor: buffers.setCursor,

    runs: runs.runs,
    activeRun: runs.activeRun,
    run: runs.run,
    exportUrl: runs.exportUrl,
    cancelRun: runs.cancelRun,
    selectRun: runs.selectRun,
    probe: runs.probe,

    settings,
    updateSettings,

    server,
    browse,

    panels,
    setPanel,
    togglePanel,
  };
}
