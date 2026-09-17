// Binds the Hono app to a port with @hono/node-server, publishes server.json so `perch status` /
// `perch stop` can find us, and tears everything down on SIGINT/SIGTERM.

import { VERSION } from "../core/version.js";
import path from "node:path";
import { serve, type ServerType } from "@hono/node-server";
import {
  clearServerInfo,
  configDir,
  defaultQueriesDir,
  ensureDefaultWorkspace,
  getSettings,
  saveSettings,
  writeServerInfo,
} from "../storage/index.js";
import type { ServerInfo } from "@perch/protocol";
import { openBrowser } from "../util/open-browser.js";
import { errnoCode } from "../util/errno.js";
import { createServer, type ServerHandle } from "./create-server.js";
import { createServices, type ServerServices } from "./services/create-services.js";

export const DEFAULT_PORT = 4600;
export const DEFAULT_HOST = "127.0.0.1";
/** How many ports above the requested one we are willing to try. */
export const PORT_SCAN = 10;

export type StartServerOptions = {
  port?: number;
  host?: string;
  /** Open the URL in the platform browser once listening. */
  open?: boolean;
  /** Workspace roots from `--dir`; also merged into settings.workspaces. */
  extraDirs?: string[];
  uiDir?: string;
  /** Extra origins allowed on /api/* (a UI dev server); see CreateAppOptions.allowOrigins. */
  allowOrigins?: string[];
  version?: string;
  /** The user named a port: fail on EADDRINUSE instead of scanning upwards. */
  strictPort?: boolean;
  /** Install SIGINT/SIGTERM handlers. Default true. */
  handleSignals?: boolean;
};

/**
 * Windows never delivers SIGTERM (Node emulates SIGINT for Ctrl+C and SIGBREAK for Ctrl+Break);
 * `perch stop` there terminates the process outright, so shutdown must not depend on a signal.
 */
const SHUTDOWN_SIGNALS: NodeJS.Signals[] =
  process.platform === "win32" ? ["SIGINT", "SIGBREAK"] : ["SIGINT", "SIGTERM"];

export type RunningServer = {
  /** Bare origin, e.g. http://127.0.0.1:4600 — what to print and open. */
  url: string;
  host: string;
  port: number;
  services: ServerServices;
  close: () => Promise<void>;
};

/** Loopback-friendly display host: nobody can browse to 0.0.0.0. */
function displayHost(host: string): string {
  if (host === "0.0.0.0" || host === "::" || host === "") return "127.0.0.1";
  return host.includes(":") ? `[${host}]` : host;
}

type FetchCallback = Parameters<typeof serve>[0]["fetch"];

function listenOnce(
  fetch: FetchCallback,
  port: number,
  hostname: string,
): Promise<{ server: ServerType; port: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server = serve({ fetch, port, hostname }, (info) => {
      if (settled) return;
      settled = true;
      resolve({ server, port: info.port });
    });
    server.once("error", (err: unknown) => {
      if (settled) return;
      settled = true;
      server.close(() => {});
      reject(err);
    });
  });
}

function isAddressInUse(err: unknown): boolean {
  const code = errnoCode(err);
  return code === "EADDRINUSE" || code === "EACCES";
}

export async function startServer(opts: StartServerOptions = {}): Promise<RunningServer> {
  const host = opts.host ?? DEFAULT_HOST;
  const version = opts.version ?? VERSION;
  const extraDirs = (opts.extraDirs ?? []).map((dir) => path.resolve(dir));
  const startedAt = new Date().toISOString();
  const services = createServices();

  // First run has no workspace at all: create ~/.perch/queries and adopt it before anything reads
  // settings, so the file API, the watcher and the UI all start on a real folder. `--dir` then
  // appends to it.
  await ensureDefaultWorkspace();

  // `--dir` is applied by writing it to settings, the only place roots live. From here on it is
  // an ordinary workspace: it survives a restart, and it can be closed from the UI.
  if (extraDirs.length > 0) {
    const settings = await getSettings();
    const workspaces = [...new Set([...settings.workspaces, ...extraDirs])];
    if (workspaces.length !== settings.workspaces.length) await saveSettings({ workspaces });
  }

  const firstPort = opts.port ?? DEFAULT_PORT;
  const attempts = opts.strictPort || firstPort === 0 ? 1 : PORT_SCAN + 1;

  let bound: { server: ServerType; port: number } | undefined;
  let handle: ServerHandle | undefined;
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const candidate = firstPort === 0 ? 0 : firstPort + i;
    // Rebuilt per attempt because /api/health reports the URL, which depends on the port.
    const attempt = createServer({
      version,
      uiDir: opts.uiDir,
      allowOrigins: opts.allowOrigins,
      services,
      startedAt,
      url: `http://${displayHost(host)}:${candidate}`,
    });
    try {
      bound = await listenOnce(attempt.app.fetch, candidate, host);
      handle = attempt;
      break;
    } catch (err) {
      await attempt.close(); // this port is a dead end; do not leave its watchers behind
      lastError = err;
      if (!isAddressInUse(err)) throw err;
    }
  }
  if (!bound || !handle) {
    const message = opts.strictPort
      ? `port ${firstPort} is already in use`
      : `ports ${firstPort}-${firstPort + PORT_SCAN} are all in use`;
    throw Object.assign(new Error(message), { cause: lastError });
  }

  const { server, port } = bound;
  const url = `http://${displayHost(host)}:${port}`;

  const info: ServerInfo = {
    name: "perch",
    version,
    pid: process.pid,
    url,
    startedAt,
    configDir: configDir(),
    queriesDir: defaultQueriesDir(),
  };
  await writeServerInfo(info);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    for (const signal of SHUTDOWN_SIGNALS) process.off(signal, onSignal);
    await handle.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await services.pool.shutdown();
    await clearServerInfo();
  };

  function onSignal(): void {
    void close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  }

  if (opts.handleSignals !== false) {
    for (const signal of SHUTDOWN_SIGNALS) process.once(signal, onSignal);
  }

  // Fire-and-forget: a missing opener must never take the server down.
  if (opts.open) openBrowser(url);

  return { url, host, port, services, close };
}
