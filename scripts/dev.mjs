import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Where `perch serve` records the server it started; `PERCH_HOME` moves it. */
function serverInfoPath() {
  const home = process.env.PERCH_HOME ?? path.join(os.homedir(), ".perch");
  return path.join(home, "server.json");
}

/**
 * A server that is already running wins: `perch serve` attaches to it rather than starting a
 * second one, whatever port we ask for. The UI would then be pointed at a port with nothing on
 * it and would quietly fall back to its fixtures, which is a confusing way to spend ten minutes.
 * Better to stop here and say so.
 */
async function runningServer() {
  let info;
  try {
    info = JSON.parse(await readFile(serverInfoPath(), "utf8"));
  } catch {
    return undefined; // no file, or a half-written one: nothing to attach to
  }
  if (!info?.url) return undefined;
  try {
    const res = await fetch(`${info.url}/api/health`, { signal: AbortSignal.timeout(1_500) });
    return res.ok ? info : undefined; // not ok / unreachable ⇒ stale file, `perch serve` clears it
  } catch {
    return undefined;
  }
}

/**
 * Turborepo's launcher script, which we run on this runtime rather than through the
 * `node_modules/.bin` shim: on Windows that shim is a `.cmd`, which `spawn` refuses to exec
 * without a shell, and the extensionless sibling beside it is not executable there at all — so
 * a bare `spawn("turbo", ...)` fails with ENOENT. Naming the script avoids the shim, the shell,
 * and the quoting a path with spaces in it would otherwise need.
 */
function turboLauncher() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  return path.join(root, "node_modules", "turbo", "bin", "turbo");
}

/** An ephemeral port the OS just confirmed is free. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const existing = await runningServer();
if (existing) {
  console.error(
    `A perch server is already running on ${existing.url} (pid ${existing.pid}).\n` +
      `\`perch serve\` would attach to it instead of starting a dev server, so the UI would end up\n` +
      `pointed at the wrong port. Stop it first:\n\n` +
      `  bun run perch -- stop\n\n` +
      `Or leave it up and run just the UI against it: bun run dev:ui\n`,
  );
  process.exit(1);
}

const port = await freePort();
const child = spawn(process.execPath, [turboLauncher(), "run", "dev"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PERCH_DEV_PORT: String(port),
    // Read by apps/web at compile time. An env var set here beats apps/web/.env.development,
    // which is only there for `dev:ui` on its own.
    VITE_PERCH_URL: `http://127.0.0.1:${port}`,
  },
});

child.on("error", (error) => {
  console.error(
    `Failed to start Turborepo: ${error.message}\n` +
      `Is the workspace installed? Run \`bun install\` at the repo root.`,
  );
  process.exit(1);
});

// Ctrl-C reaches the whole process group already; this is only so the exit code survives.
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
