import type { ServerInfo } from "@perch/protocol";
import { NOT_API, PerchError } from "./errors";
import { createTransport, type CallOptions, type ClientOptions, type Transport } from "./http";
import { connectionsApi, type ConnectionsApi } from "./connections";
import { browseApi, type BrowseApi } from "./browse";
import { discoverApi, type DiscoverApi } from "./discover";
import { queryApi, type QueryApi } from "./query";
import { runsApi, type RunsApi } from "./runs";
import { historyApi, type HistoryApi } from "./history";
import { settingsApi, type SettingsApi } from "./settings";
import { filesApi, type FilesApi } from "./files";
import { eventsApi, type EventsApi } from "./events";

export type PerchClient = {
  readonly baseUrl: string;
  /** Cheap liveness probe: "is the server up, and is it this server?" */
  health(opts?: CallOptions): Promise<ServerInfo>;
  connections: ConnectionsApi;
  /** What databases this machine already runs, for onboarding and the connection editor. */
  discover: DiscoverApi;
  /** Folders on this machine, for picking a workspace. */
  browse: BrowseApi;
  query: QueryApi;
  runs: RunsApi;
  history: HistoryApi;
  settings: SettingsApi;
  files: FilesApi;
  events: EventsApi;
  /** The underlying transport, for a route this package has not wrapped yet. */
  http: Transport;
};

/**
 * `health` is used as a "is the server up?" probe, so a 200 from something that is merely *at*
 * this address — another app on the port, a proxy, a dev server with a catch-all route — must
 * fail rather than pass. `name` is the cheapest thing that only this server sends.
 */
async function health(http: Transport, opts?: CallOptions): Promise<ServerInfo> {
  const info = await http.json<ServerInfo>("/api/health", { signal: opts?.signal });
  if (info?.name !== "perch") {
    throw new PerchError("answered, but it is not an perch server", {
      status: 200,
      route: "GET /api/health",
      code: NOT_API,
      body: info,
    });
  }
  return info;
}

export function createClient(options: ClientOptions): PerchClient {
  const http = createTransport(options);
  return {
    baseUrl: http.baseUrl,
    health: (opts) => health(http, opts),
    connections: connectionsApi(http),
    discover: discoverApi(http),
    browse: browseApi(http),
    query: queryApi(http),
    runs: runsApi(http),
    history: historyApi(http),
    settings: settingsApi(http),
    files: filesApi(http),
    events: eventsApi(http),
    http,
  };
}
