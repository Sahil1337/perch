// The HTTP API, assembled. This file owns only the wiring: middleware order, the shared `deps`
// every route closes over, and the lifetimes — event bus, filesystem watcher, open SSE streams —
// that outlive a single request. The routes themselves live one folder down.
//
// `createApp` is pure: no listening socket, so it can be driven with `app.request()`.

import { Hono } from "hono";
import { cors } from "hono/cors";
import { getSettings } from "../storage/index.js";
import { badRequest } from "./http/errors.js";
import { registerErrorHandler } from "./middleware/error-handler.js";
import { registerBrowseRoutes } from "./routes/browse.js";
import { registerConnectionsRoutes } from "./routes/connections.js";
import { registerDiscoverRoutes } from "./routes/discover.js";
import { registerEventsRoutes } from "./routes/events.js";
import { registerFilesRoutes } from "./routes/files.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerHistoryRoutes } from "./routes/history.js";
import { registerQueryRoutes } from "./routes/query.js";
import { registerRunsRoutes } from "./routes/runs.js";
import { registerSchemaRoutes } from "./routes/schema.js";
import { registerSettingsRoutes } from "./routes/settings.js";
import { registerUiRoutes } from "./routes/ui.js";
import { createServices, type ServerServices } from "./services/create-services.js";
import { DiscoveryService } from "./services/discovery/index.js";
import { EventBus } from "./services/event-bus.js";
import { FileWatcher } from "./services/watcher.js";
import { isSqlFile, resolveWithin, resolveRoots } from "./services/workspace-paths.js";

export type CreateAppOptions = {
  version: string;
  /** Directory holding the built UI. When missing, `/` serves a short placeholder page. */
  uiDir?: string;
  /** Injected by start.ts and the tests; a fresh set otherwise. */
  services?: ServerServices;
  /** Reported by /api/health; defaults to the request's own origin. */
  url?: string;
  startedAt?: string;
  /** Set false to run without filesystem watchers (most tests). Default true. */
  watch?: boolean;
  /** Injected by tests that want to emit onto the same bus the SSE stream reads. */
  bus?: EventBus;
  /**
   * Origins allowed to call /api/* from another origin, for a UI dev server on its own port.
   * Production is same-origin (the UI is served by this process) and needs none.
   */
  allowOrigins?: string[];
};

/** What `createServer` hands back: the app plus the things that need shutting down. */
export type ServerHandle = {
  app: Hono;
  bus: EventBus;
  services: ServerServices;
  /** null when `watch: false`. */
  watcher: FileWatcher | null;
  close(): Promise<void>;
};

/**
 * Everything a route group needs from the server it is mounted on. Passed to every
 * `register<X>Routes(app, deps)` so the route files never reach back into this module for values.
 */
export type RouteDeps = ServerServices & {
  version: string;
  startedAt: string;
  /** Reported by /api/health; undefined means "the request's own origin". */
  url: string | undefined;
  /** Directory holding the built UI, as the caller gave it (existence is checked by routes/ui). */
  uiDir: string | undefined;
  bus: EventBus;
  watcher: FileWatcher | null;
  /** Local database-server discovery, memoised for 30s (see routes/discover). */
  discovery: DiscoveryService;
  /** Ends every open SSE stream on shutdown; routes/events keeps it up to date. */
  openStreams: Set<() => void>;
  /** settings.workspaces plus `--dir`, resolved. */
  workspaceRoots(): Promise<string[]>;
  /** Resolves a client-supplied path inside the workspaces; `.sql` only unless `kind` is "dir". */
  safePath(p: string | undefined, kind?: "file" | "dir"): Promise<string>;
};

/**
 * The app plus everything that outlives a single request — the event bus, the filesystem watcher —
 * and a `close()` that shuts them down.
 */
export function createServer(opts: CreateAppOptions): ServerHandle {
  const { version } = opts;
  const services = opts.services ?? createServices();
  const startedAt = opts.startedAt ?? new Date().toISOString();
  const app = new Hono();
  const bus = opts.bus ?? new EventBus();
  /** Open SSE streams, so `close()` can end them instead of leaving sockets hanging. */
  const openStreams = new Set<() => void>();
  /** Holds the last scan, so a UI that polls discovery does not shell out every time. */
  const discovery = new DiscoveryService();

  const watcher =
    opts.watch === false
      ? null
      : new FileWatcher({ onEvent: (event) => bus.emit({ type: "file", event }) });

  // A finished run is interesting to every connected UI, not just the one that started it.
  const priorRunFinished = services.runner.onRunFinished;
  services.runner.onRunFinished = (record) => {
    priorRunFinished?.(record);
    bus.emit({ type: "run", runId: record.id, status: record.status });
  };

  // Realpath'd, like the paths under them: a root reported as `/tmp/x` whose files come back under
  // `/private/tmp/x` reads as two workspaces. `settings.workspaces` is the whole answer — `--dir` is
  // written to settings at startup, not unioned in here, or such a folder could never be closed.
  async function workspaceRoots(): Promise<string[]> {
    const settings = await getSettings();
    return resolveRoots(settings.workspaces ?? []);
  }

  async function safePath(p: string | undefined, kind: "file" | "dir" = "file"): Promise<string> {
    if (!p) throw badRequest("path is required");
    const full = await resolveWithin(await workspaceRoots(), p);
    if (kind === "file" && !isSqlFile(full)) {
      throw badRequest("only .sql files can be read or written");
    }
    return full;
  }

  const deps: RouteDeps = {
    ...services,
    version,
    startedAt,
    url: opts.url,
    uiDir: opts.uiDir,
    bus,
    watcher,
    discovery,
    openStreams,
    workspaceRoots,
    safePath,
  };

  registerErrorHandler(app);
  if (opts.allowOrigins && opts.allowOrigins.length > 0) {
    app.use("/api/*", cors({ origin: opts.allowOrigins }));
  }

  registerHealthRoutes(app, deps);

  registerBrowseRoutes(app);
  registerEventsRoutes(app, deps);
  registerConnectionsRoutes(app, deps);
  registerDiscoverRoutes(app, deps);
  registerSchemaRoutes(app, deps);
  registerQueryRoutes(app, deps);
  registerRunsRoutes(app, deps);
  registerHistoryRoutes(app, deps);
  registerSettingsRoutes(app, deps);
  registerFilesRoutes(app, deps);
  // Last: the UI mount ends in a catch-all `*`.
  registerUiRoutes(app, deps);

  // Watch whatever is configured today; PUT /api/settings re-roots it later.
  if (watcher) {
    void workspaceRoots().then(
      (roots) => watcher.setRoots(roots),
      () => [],
    );
  }

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    watcher?.close();
    for (const end of [...openStreams]) end();
    openStreams.clear();
  };

  return { app, bus, services, watcher, close };
}

/** Just the Hono app. Anything that needs to shut the watcher down again wants `createServer`. */
export function createApp(opts: CreateAppOptions): Hono {
  return createServer(opts).app;
}
