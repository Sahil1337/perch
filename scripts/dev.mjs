import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_URL = "http://localhost:5173";
// `go run` compiles first, which on a cold cache takes a while.
const READY_TIMEOUT_MS = 180_000;

const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code) => (text) => (tty ? `\x1b[${code}m${text}\x1b[0m` : text);
const dim = paint("2");
const bold = paint("1");
const red = paint("31");

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

async function waitFor(url, deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (res.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  return false;
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
const apiUrl = `http://127.0.0.1:${port}`;
const env = {
  ...process.env,
  PERCH_DEV_PORT: String(port),
  // Read by apps/web at compile time. An env var set here beats apps/web/.env.development,
  // which is only there for `dev:ui` on its own.
  VITE_PERCH_URL: apiUrl,
  // Piped output is not a TTY, so the children would otherwise drop their colours.
  ...(tty ? { FORCE_COLOR: "1" } : {}),
};

// Vite's own banner repeats what the ready line below says, once both halves are up. Its Local
// line is also how the UI says it is up: polling :5173 could reach some other server on that port.
const VITE_BANNER = /VITE v\d|➜\s+(Local|Network):/;
const VITE_LISTENING = /➜\s+Local:/;
const ANSI = /\x1b\[[0-9;]*m/g;
let uiListening;
const uiUp = new Promise((resolve) => (uiListening = resolve));

const children = [];
let stopping = false;

/**
 * Both halves run straight from here rather than through turbo, so their output can carry one
 * short, aligned prefix and the ready line can wait for both. Every child is started through the
 * runtime with a script path, never a `.cmd` shim, so Windows can exec it without a shell. On
 * POSIX each child leads its own process group: `go run` keeps the compiled server as a
 * grandchild, and stopping the group is what reaches it.
 */
function start(name, colour, script, args, cwd) {
  const child = spawn(process.execPath, [script, ...args], {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  const prefix = paint(colour)(name.padEnd(6)) + dim(" │ ");
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => {
      const plain = line.replace(ANSI, "");
      if (name === "ui" && VITE_LISTENING.test(plain)) uiListening(true);
      if (plain.trim() === "" || VITE_BANNER.test(plain)) return;
      process.stdout.write(`${prefix}${line}\n`);
    });
  }
  child.on("error", (error) => {
    console.error(`${prefix}${red(`failed to start: ${error.message}`)}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (stopping) return;
    console.error(`${prefix}${red(`exited (${signal ?? `code ${code}`}), stopping the other half`)}`);
    stop(code || 1);
  });
  children.push(child);
}

function kill(child, signal) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
    else process.kill(-child.pid, signal);
  } catch {
    // already gone
  }
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) kill(child, "SIGINT");
  const force = setTimeout(() => children.forEach((child) => kill(child, "SIGKILL")), 3_000);
  force.unref();
  Promise.all(children.map((child) => new Promise((resolve) => child.once("close", resolve)))).then(() =>
    process.exit(code),
  );
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));

const startedAt = Date.now();
console.log(dim(`starting the API on ${apiUrl} and the UI on ${UI_URL}…`));
start("api", "36", path.join(ROOT, "apps/server/scripts/dev.mjs"), [], path.join(ROOT, "apps/server"));
start("ui", "35", path.join(ROOT, "node_modules/vite/bin/vite.js"), ["dev", "--clearScreen", "false"], path.join(ROOT, "apps/web"));

const deadline = startedAt + READY_TIMEOUT_MS;
const uiTimeout = new Promise((resolve) => setTimeout(resolve, READY_TIMEOUT_MS, false).unref());
const [api, ui] = await Promise.all([waitFor(`${apiUrl}/api/health`, deadline), Promise.race([uiUp, uiTimeout])]);
if (!stopping) {
  if (api && ui) {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(
      `\n  ${bold("perch dev")} ${dim(`ready in ${seconds}s`)}\n` +
        `  ${dim("➜")} app  ${bold(UI_URL)}\n` +
        `  ${dim("➜")} api  ${apiUrl}\n` +
        `  ${dim("ctrl-c stops both")}\n`,
    );
  } else {
    console.error(red(`\n  ${api ? "the UI" : "the API"} did not come up within ${READY_TIMEOUT_MS / 1000}s\n`));
  }
}
