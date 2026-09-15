// Cross-platform "open a URL in the default browser" launcher. Best-effort: never throws, never
// blocks the CLI process (detached + unref'd), and swallows failures (e.g. no display / headless).

import { spawn } from "node:child_process";

export function openBrowser(url: string): void {
  try {
    let cmd: string;
    let args: string[];
    switch (process.platform) {
      case "darwin":
        cmd = "open";
        args = [url];
        break;
      case "win32":
        // cmd's `start` needs an (ignored) title argument before the URL.
        cmd = "cmd";
        args = ["/c", "start", "", url];
        break;
      default:
        cmd = "xdg-open";
        args = [url];
        break;
    }
    const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
    child.on("error", () => {
      /* no browser / no display — ignore */
    });
    child.unref();
  } catch {
    /* ignore */
  }
}
