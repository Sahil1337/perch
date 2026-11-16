// CI tooling for the Windows job in .github/workflows/launcher.yml: opens the real launcher
// window, drives it over the Chrome DevTools Protocol that WebView2 exposes, and saves a
// screenshot of each state for a person to look at. Not a test suite; it needs Windows, the
// WebView2 runtime and Node 22 (for the global WebSocket).
//
//   node drive-window.mjs <PerchLauncher.exe> <perch.exe> <screenshot dir>
//
// PERCH_HOME should point at a throwaway directory; the launcher and the server both use it.
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [launcherExe, perchExe, shots] = process.argv.slice(2);
if (!shots) throw new Error("usage: node drive-window.mjs <PerchLauncher.exe> <perch.exe> <dir>");
mkdirSync(shots, { recursive: true });

const PORT = 9222;
const LOCAL = /^(data|blob|about):/;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = false;
const fail = (msg) => {
  console.log(`::error::${msg}`);
  failed = true;
};

async function until(what, fn, timeoutMs = 15000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn().catch(() => undefined);
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await sleep(200);
  }
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const status = () => JSON.parse(execFileSync(perchExe, ["status", "--json"], { encoding: "utf8" }));

// The window handle comes from PowerShell rather than a native addon. 6 is SW_MINIMIZE, 9 is
// SW_RESTORE.
function showWindow(pid, cmd) {
  const script = `
    Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);'
    [W.U]::ShowWindow((Get-Process -Id ${pid}).MainWindowHandle, ${cmd}) | Out-Null`;
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script]);
}

// The port reaches WebView2 through this variable only with a current WebView2Loader.dll beside
// the launcher; the workflow puts one there (go-webview2's embedded loader predates it).
const launcher = spawn(launcherExe, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` },
  stdio: ["ignore", "pipe", "pipe"],
});
let launcherOutput = "";
launcher.stdout.on("data", (d) => (launcherOutput += d));
launcher.stderr.on("data", (d) => (launcherOutput += d));
let launcherCode = null;
const launcherExit = new Promise((r) =>
  launcher.on("exit", (code) => {
    launcherCode = code;
    r(code);
  }),
);

// When the window never shows up, say why: whether the launcher is still alive, what it printed,
// how WebView2 was started, and what is on the screen (an error dialog would be).
function explainMissingWindow() {
  console.log(`launcher ${launcherCode === null ? "still running" : `exited with ${launcherCode}`}`);
  console.log(`launcher output:\n${launcherOutput || "(none)"}`);
  const script = `
    Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe' or Name='PerchLauncher.exe'" |
      ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }
    Add-Type -AssemblyName System.Windows.Forms, System.Drawing
    $b = [System.Windows.Forms.SystemInformation]::VirtualScreen
    $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
    [System.Drawing.Graphics]::FromImage($bmp).CopyFromScreen($b.Left, $b.Top, 0, 0, $bmp.Size)
    $bmp.Save('${join(shots, "desktop.png").replace(/'/g, "''")}')`;
  try {
    console.log(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" }));
  } catch (e) {
    console.log(`could not inspect the desktop: ${e.message}`);
  }
}

let target;
try {
  target = await until(
    "the launcher page on the DevTools port",
    async () => {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      return list.find((t) => t.type === "page");
    },
    30000,
  );
} catch (e) {
  explainMissingWindow();
  launcher.kill();
  throw e;
}

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});
let nextId = 0;
const pending = new Map();
const consoleErrors = [];
const requests = [];
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (msg.id !== undefined) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
    return;
  }
  const { method, params } = msg;
  if (method === "Runtime.exceptionThrown") consoleErrors.push(params.exceptionDetails.text);
  if (method === "Runtime.consoleAPICalled" && params.type === "error")
    consoleErrors.push(params.args.map((a) => a.value ?? a.description).join(" "));
  if (method === "Log.entryAdded" && params.entry.level === "error") consoleErrors.push(params.entry.text);
  if (method === "Network.requestWillBeSent" && !LOCAL.test(params.request.url)) requests.push(params.request.url);
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true });
  if (exceptionDetails) throw new Error(exceptionDetails.text);
  return result.value;
};
const state = () => evaluate(`document.querySelector("main.pl")?.dataset.state`);
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
};
const clickPill = (label) =>
  evaluate(`(() => {
    const pill = [...document.querySelectorAll(".pill")].find((b) => /${label}/i.test(b.textContent));
    if (!pill) return false;
    pill.click();
    return true;
  })()`);
const launch = async () => {
  if (!(await clickPill("launch"))) await evaluate(`document.querySelector(".bird-btn").click()`);
};

// The page loaded before this attached. Log.enable replays the console entries already
// buffered, and resource timing lists every fetch since load (data: URIs never appear there),
// so the first paint is covered without a reload.
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await send("Page.enable");
const early = await evaluate(`performance.getEntriesByType("resource").map((e) => e.name)`);
requests.push(...early.filter((u) => !LOCAL.test(u)));

try {
  await until("the ready state", async () => (await state()) === "ready");
  if ((await evaluate(`typeof window.PerchLauncher?.set`)) !== "function") fail("window.PerchLauncher.set is missing");
  await shot("1-ready");

  // A MutationObserver catches "starting" however briefly it lasts.
  await evaluate(`window.__states = [];
    new MutationObserver(() => window.__states.push(document.querySelector("main.pl").dataset.state))
      .observe(document.querySelector("main.pl"), { attributes: true, attributeFilter: ["data-state"] });`);
  await launch();
  try {
    await until("the starting state", async () => (await evaluate(`window.__states`)).includes("starting"), 5000);
    if ((await state()) === "starting") await shot("2-starting");
  } catch {
    fail(`never saw "starting"; saw ${JSON.stringify(await evaluate("window.__states"))}`);
  }
  await until("the running state", async () => (await state()) === "running");
  await shot("3-running");

  const info = status();
  if (!info?.pid || !info?.url) throw new Error(`perch status --json disagrees with the window: ${JSON.stringify(info)}`);

  if (!(await clickPill("stop"))) throw new Error("no Stop pill in the running state");
  await until("the ready state after Stop", async () => (await state()) === "ready");
  await shot("4-stopped");
  await until("the server to exit after Stop", async () => !alive(info.pid), 10000);
  if (status() !== null) fail("perch status still reports a server after Stop");

  // A minimised window may be suspended, so the page records what it saw and that is read back
  // after restore. The page's own visibilitychange handler was registered first and runs first.
  try {
    await evaluate(`window.__hidden = null;
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden")
          window.__hidden = { paused: !!document.querySelector("[data-paused]") };
      });`);
    showWindow(launcher.pid, 6);
    await sleep(2000);
    showWindow(launcher.pid, 9);
    const seen = await until("the page after restore", () => evaluate(`window.__hidden`), 10000);
    if (!seen.paused) fail("minimised, the page was hidden but not data-paused");
    await until("visible after restore", async () => (await evaluate(`document.visibilityState`)) === "visible", 5000);
  } catch (err) {
    fail(`minimise: ${err.message}`);
  }

  // Closing the window stops Perch, the same as quitting any app.
  await launch();
  await until("running again", async () => (await state()) === "running");
  const again = status()?.pid;
  ws.close();
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `(Get-Process -Id ${launcher.pid}).CloseMainWindow() | Out-Null`]);
  const exited = await Promise.race([launcherExit.then(() => true), sleep(15000).then(() => false)]);
  if (!exited) fail("the launcher did not exit on close");
  await until("the server to exit after close", async () => !alive(again), 10000).catch(() =>
    fail("closing the window left the server running"),
  );
  if (existsSync(join(process.env.PERCH_HOME ?? "", "server.json"))) fail("server.json survived closing the window");
} catch (err) {
  fail(err.message);
  if (ws.readyState === WebSocket.OPEN) await shot("failure").catch(() => {});
} finally {
  if (consoleErrors.length) fail(`console errors:\n${consoleErrors.join("\n")}`);
  if (requests.length) fail(`network requests:\n${requests.join("\n")}`);
  if (launcher.exitCode === null) launcher.kill();
}

console.log(failed ? "launcher window: failed" : "launcher window: ready, starting, running, stopped, closed");
process.exit(failed ? 1 : 0);
