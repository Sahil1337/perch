// Containers publishing a database port to the host.

import { onPath, run } from "./exec.js";
import { dialectOf, publishedPort } from "./parse.js";
import { DEFAULT_PORTS, LOOPBACK, type Sighting } from "./types.js";

/** Any OS, but only when a docker client is actually installed. */
export async function probeDocker(): Promise<Sighting[]> {
  if (!(await onPath("docker"))) return [];
  const out = await run("docker", ["ps", "--format", "{{.Names}}|{{.Image}}|{{.Ports}}"]);
  const sightings: Sighting[] = [];
  for (const line of out.split(/\r?\n/)) {
    const [name, image, ports] = line.split("|");
    if (!name || !image) continue;
    const dialect = dialectOf(image);
    if (!dialect) continue;
    const port = publishedPort(ports ?? "", DEFAULT_PORTS[dialect]);
    // No published port means the container is unreachable from the host; nothing to offer.
    if (port === undefined) continue;
    sightings.push({ dialect, host: LOOPBACK, port, source: "docker", label: `docker · ${name}` });
  }
  return sightings;
}
