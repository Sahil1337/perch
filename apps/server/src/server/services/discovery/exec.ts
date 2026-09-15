// Talking to the machine: child processes and the filesystem, each call swallowing its own
// failures. A missing binary is "found nothing", not an error.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { PROBE_TIMEOUT_MS } from "./types.js";

const execFileAsync = promisify(execFile);

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    // Unref'd: a pending scan timer must never hold the CLI process open.
    setTimeout(resolve, ms).unref?.();
  });
}

/** Runs a child process, returning its output — or "" for anything that went wrong. */
export async function run(cmd: string, args: string[], timeoutMs = PROBE_TIMEOUT_MS): Promise<string> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
    });
    return `${stdout}${stderr}`;
  } catch (err) {
    // Some tools (mysqld on some builds) still print a usable version before failing.
    const out = err as { stdout?: string; stderr?: string };
    return `${out.stdout ?? ""}${out.stderr ?? ""}`;
  }
}

export async function readdirSafe(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

export async function isExecutableFile(file: string): Promise<boolean> {
  try {
    const stat = await fs.stat(file);
    return stat.isFile();
  } catch {
    return false;
  }
}

/** The first line of `which`/`where` output, when the binary is on PATH. */
export async function onPath(name: string): Promise<string | undefined> {
  const out = await run(process.platform === "win32" ? "where" : "which", [name]);
  const first = out.split(/\r?\n/).find((line) => line.trim().length > 0);
  return first?.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Expands a path pattern whose segments may contain `*` (`/usr/lib/postgresql/<version>/bin`). Only
 * what the install-directory list needs: no `**`, no brace expansion, and an unreadable directory
 * simply contributes nothing.
 */
export async function expandGlob(pattern: string): Promise<string[]> {
  const segments = pattern.split(/[\\/]/);
  const first = segments[0] ?? "";
  // "" is a POSIX absolute path; "C:" is a Windows drive and needs its separator back.
  let paths = [first === "" ? path.sep : /^[A-Za-z]:$/.test(first) ? first + path.sep : first];

  for (const segment of segments.slice(1)) {
    if (segment === "") continue;
    const next: string[] = [];
    if (segment.includes("*")) {
      const re = new RegExp(`^${segment.split("*").map(escapeRegExp).join(".*")}$`, "i");
      for (const base of paths) {
        for (const entry of await readdirSafe(base)) {
          if (re.test(entry)) next.push(path.join(base, entry));
        }
      }
    } else {
      for (const base of paths) next.push(path.join(base, segment));
    }
    paths = next;
    if (paths.length === 0) break;
  }
  return paths;
}
