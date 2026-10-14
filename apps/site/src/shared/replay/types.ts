import type {
  ConnectionSummary,
  DatabaseSchema,
  DiscoveryResult,
  FileEntry,
  RunRecord,
  ServerInfo,
  Settings,
} from "@perch/protocol";
import type { ConnectionTest, PanelState, WorkspaceApi } from "@perch/ui";

/** One `.sql` file as `GET /api/files/content` returned it, path already scrubbed. */
export type FixtureFile = { path: string; content: string; modifiedAt: string };

/** A real `POST /api/query/sync` exchange. See README.md for how runs find one. */
export type Recording = {
  /** `normaliseSql(request.sql)`. Recomputed on load when empty, so hand-written ones may omit it. */
  key: string;
  kind: "run" | "probe";
  /** Which scene recorded it, for reading the fixture; the replay ignores it. */
  scene?: string;
  request: { sql: string; maxRows?: number; readOnly?: boolean; record?: boolean };
  record: RunRecord;
};

export type ReplayFixtures = {
  version: 1;
  recordedAt: string;
  perchVersion: string;
  server: ServerInfo;
  connections: ConnectionSummary[];
  /** By connection id. */
  databases: Record<string, string[]>;
  /** By `${connectionId}/${database}`. */
  schemas: Record<string, DatabaseSchema>;
  /** By connection id. */
  connectionTests: Record<string, ConnectionTest>;
  settings: Settings;
  roots: string[];
  workspace: FileEntry[];
  files: FixtureFile[];
  discovery: DiscoveryResult;
  recordings: Recording[];
};

export type ReplayInput = {
  fixtures: ReplayFixtures;
  /** Merged after `fixtures.recordings`; a later recording of the same key wins. */
  extraRecordings?: readonly Recording[];
  /** Paths open as tabs at the start, in order. */
  open?: readonly string[];
  /** Paths that open as notebooks (the view a notebook keeps once saved), not scripts. */
  notebook?: readonly string[];
  /** Which of `open` has focus; the last one when omitted. */
  active?: string;
  /** On-disk content overrides, by path: the state a scene starts from. */
  files?: Readonly<Record<string, string>>;
  panels?: Partial<PanelState>;
  /** How long a replayed run takes, given what the server took. */
  latency?: (recordedMs: number) => number;
};

/**
 * The replayed workspace as a store. `getSnapshot()` is the `WorkspaceApi`, replaced on every
 * change the way the live provider's value is, so it can be handed straight to
 * `WorkspaceProvider`; `useReplayWorkspace` does the subscribing.
 */
export type ReplayWorkspace = {
  getSnapshot(): WorkspaceApi;
  subscribe(listener: () => void): () => void;
  /** Back to the state the store was created in. */
  reset(): void;
};
