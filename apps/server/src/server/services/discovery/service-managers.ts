// Servers registered with the platform's service manager: Homebrew on macOS, systemd on Linux,
// the service control manager on Windows. Each returns [] off its own platform.

import { run } from "./exec.js";
import { dialectOf } from "./parse.js";
import { DEFAULT_PORTS, LOOPBACK, type Sighting } from "./types.js";

/** `brew services list` rows whose status is `started`. */
async function probeBrew(): Promise<Sighting[]> {
  if (process.platform !== "darwin") return [];
  const out = await run("brew", ["services", "list"]);
  const sightings: Sighting[] = [];
  for (const line of out.split(/\r?\n/).slice(1)) {
    const [name, status] = line.trim().split(/\s+/);
    if (!name || status !== "started") continue;
    const dialect = dialectOf(name);
    if (!dialect) continue;
    sightings.push({
      dialect,
      host: LOOPBACK,
      port: DEFAULT_PORTS[dialect],
      source: "brew",
      label: `brew services · ${name}`,
    });
  }
  return sightings;
}

/** Running units whose name starts with postgresql / postgres / mysql / mysqld / mariadb. */
async function probeSystemd(): Promise<Sighting[]> {
  if (process.platform !== "linux") return [];
  const out = await run("systemctl", [
    "list-units",
    "--type=service",
    "--state=running",
    "--no-legend",
  ]);
  const sightings: Sighting[] = [];
  for (const line of out.split(/\r?\n/)) {
    const unit = line.trim().replace(/^●\s*/, "").split(/\s+/)[0];
    if (!unit || !/^(postgresql|postgres|mysqld?|mariadb)/i.test(unit)) continue;
    const dialect = dialectOf(unit);
    if (!dialect) continue;
    sightings.push({
      dialect,
      host: LOOPBACK,
      port: DEFAULT_PORTS[dialect],
      source: "systemd",
      label: `systemd · ${unit.replace(/\.service$/, "")}`,
    });
  }
  return sightings;
}

/** Running service names, via `sc` and then PowerShell when `sc` gives nothing usable. */
async function runningWindowsServices(): Promise<Set<string>> {
  const names = new Set<string>();

  // `sc query state= all` prints SERVICE_NAME / STATE pairs; keep the ones that are RUNNING.
  const sc = await run("sc", ["query", "state=", "all"]);
  let pending: string | undefined;
  for (const line of sc.split(/\r?\n/)) {
    const name = /^SERVICE_NAME:\s*(.+?)\s*$/i.exec(line);
    if (name) {
      pending = name[1];
      continue;
    }
    if (pending && /\bSTATE\b/i.test(line)) {
      if (/RUNNING/i.test(line)) names.add(pending);
      pending = undefined;
    }
  }
  if (names.size > 0) return names;

  const ps = await run("powershell", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Get-Service | Where-Object {$_.Status -eq 'Running'} | ForEach-Object {$_.Name}",
  ]);
  for (const line of ps.split(/\r?\n/)) {
    const name = line.trim();
    if (name) names.add(name);
  }
  return names;
}

/** Windows: running services whose name looks like a database server. */
async function probeWindowsServices(): Promise<Sighting[]> {
  if (process.platform !== "win32") return [];
  const sightings: Sighting[] = [];
  for (const name of await runningWindowsServices()) {
    if (!/^(postgresql|postgres|mysql|mariadb)/i.test(name)) continue;
    const dialect = dialectOf(name);
    if (!dialect) continue;
    sightings.push({
      dialect,
      host: LOOPBACK,
      port: DEFAULT_PORTS[dialect],
      source: "windows",
      label: `service · ${name}`,
    });
  }
  return sightings;
}

export const serviceManagerProbes = [probeBrew, probeSystemd, probeWindowsServices];
