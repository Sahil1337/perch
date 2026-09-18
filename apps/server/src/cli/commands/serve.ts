// `perch serve` (default command), `perch stop`, `perch status`.

import path from "node:path";
import { fileURLToPath } from "node:url";
import { VERSION } from "../../core/version.js";
import { DEFAULT_HOST, DEFAULT_PORT, startServer } from "../../server/start.js";
import { clearServerInfo, getSettings, readServerInfo, saveSettings } from "../../storage/index.js";
import { hasEmbeddedUi } from "../../util/embedded-ui.js";
import { openBrowser } from "../../util/open-browser.js";
import { bold, defineCommand, dim, printJson } from "../util/index.js";

/**
 * The UI that ships with the server: `apps/server/ui/`, which `@perch/web`'s build writes and
 * which sits next to `dist/` in an installed copy. Without this default, `perch serve` served the
 * API and a placeholder page — the bundle was right there on disk and nothing ever looked for it,
 * so the app only worked if you knew to pass `--ui`.
 */
function bundledUiDir(): string | undefined {
  // A compiled binary carries the UI inside itself instead, and its import.meta.url points into
  // Bun's virtual bundle root — the walk below would resolve to a path on the host machine that
  // has nothing to do with this install, and an unrelated directory there would shadow the real
  // bundle. Let the embedded copy answer.
  if (hasEmbeddedUi()) return undefined;
  // This file compiles to dist/cli/commands/serve.js, so the package root — where ui/ sits next
  // to dist/ — is three levels up.
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ui");
}

const SERVE_HELP = `usage: perch [serve] [--port 4600] [--host 127.0.0.1] [--no-open] [--dir <path>]... [--ui <dir>]

Starts the local server (default command when no other command is given). If a live server is
already running (per ~/.perch/server.json), prints/opens its URL instead of starting another.

  --port <n>     port to listen on (default 4600)
  --host <host>  host to bind (default 127.0.0.1)
  --no-open      don't open the browser
  --dir <path>   add a workspace directory the file API may read/write (repeatable, persisted;
                 ~/.perch/queries is always there)
  --ui <dir>     serve a built UI from this directory instead of the API-only placeholder page
  --allow-origin <origin>  let a UI dev server on another origin call the API (repeatable, dev only)
`;

async function checkHealth(url: string): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 800);
    const res = await fetch(`${url}/api/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

/** Loopback is the only boundary there is, so leaving it is worth one line of warning. */
function isLoopback(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost";
}

export const cmdServe = defineCommand(
  {
    usage: SERVE_HELP,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      "no-open": { type: "boolean", default: false },
      dir: { type: "string", multiple: true, default: [] },
      ui: { type: "string" },
      "allow-origin": { type: "string", multiple: true, default: [] },
    },
  },
  async ({ values }) => {
    const port = values.port ? Number(values.port) : DEFAULT_PORT;
    const host = values.host ?? DEFAULT_HOST;
    const open = !values["no-open"];
    const dirs = (values.dir ?? []).map((d) => path.resolve(d));

    if (dirs.length > 0) {
      const settings = await getSettings();
      await saveSettings({ workspaces: Array.from(new Set([...settings.workspaces, ...dirs])) });
    }

    const existing = await readServerInfo();
    if (existing && (await checkHealth(existing.url))) {
      console.log(`perch already running (pid ${existing.pid}) → ${existing.url}`);
      if (open) openBrowser(existing.url);
      return;
    }
    if (existing) await clearServerInfo(); // stale server.json from a crashed/killed process

    const { url } = await startServer({
      port,
      host,
      open,
      extraDirs: dirs,
      uiDir: values.ui ?? bundledUiDir(),
      allowOrigins: values["allow-origin"],
    });
    console.log(`${bold("perch")} v${VERSION} → ${url}`);
    // There is no auth: binding past loopback publishes the API to whoever can route to it.
    if (!isLoopback(host)) {
      console.log(`listening on ${host}: anyone who can reach this address can run queries`);
    }
    // A UI dev server on another origin may now call the API — that is what --allow-origin did.
    for (const origin of values["allow-origin"] ?? []) {
      console.log(`${dim("dev UI")}      → ${origin.replace(/\/+$/, "")}/`);
    }
    if (open) openBrowser(url);
  },
);

export const cmdStop = defineCommand(
  {
    usage:
      "usage: perch stop\n\nSends SIGTERM to the running server (per server.json) and clears it.",
  },
  async () => {
    const info = await readServerInfo();
    if (!info) {
      console.log("not running");
      return;
    }
    try {
      process.kill(info.pid, "SIGTERM");
      console.log(`stopped (pid ${info.pid})`);
    } catch {
      console.log(dim("server.json was stale (process already gone)"));
    }
    await clearServerInfo();
  },
);

export const cmdStatus = defineCommand(
  { usage: 'usage: perch status [--json]\n\nPrints the running server info, or "not running".' },
  async ({ json }) => {
    const info = await readServerInfo();
    const alive = info ? await checkHealth(info.url) : false;
    if (!info || !alive) {
      if (info) await clearServerInfo(); // stale
      if (json) printJson(null);
      else console.log("not running");
      return;
    }
    if (json) {
      printJson(info);
      return;
    }
    console.log(`running · pid ${info.pid} · ${info.url} · started ${info.startedAt}`);
  },
);
