// The only probe that proves a server is actually up: something accepted a TCP connection.

import { promises as dns } from "node:dns";
import net from "node:net";
import type { Dialect } from "@perch/protocol";
import { DEFAULT_PORTS, LOOPBACK, PROBE_TIMEOUT_MS, type Sighting } from "./types.js";

/** A TCP connect and nothing more: something is listening, which is all `reachable` claims. */
function tcpProbe(host: string, port: number, timeoutMs = PROBE_TIMEOUT_MS): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** True when `localhost` resolves to something other than 127.0.0.1 (an IPv6-first machine). */
async function localhostDiffers(): Promise<boolean> {
  try {
    const { address } = await dns.lookup("localhost");
    return address !== LOOPBACK;
  } catch {
    return false;
  }
}

/**
 * Connects to the default ports on 127.0.0.1 and — when `localhost` resolves elsewhere, so an
 * IPv6-only server would otherwise be invisible — to `localhost` as well. Both run in parallel;
 * only one row per dialect survives, preferring the numeric address, so an ordinary dual-stack
 * machine does not report the same server twice.
 */
export async function probePorts(): Promise<Sighting[]> {
  const alsoLocalhost = await localhostDiffers();
  const hosts = alsoLocalhost ? [LOOPBACK, "localhost"] : [LOOPBACK];
  const dialects = Object.keys(DEFAULT_PORTS) as Dialect[];

  const results = await Promise.all(
    dialects.map(async (dialect) => {
      const port = DEFAULT_PORTS[dialect];
      const reached = await Promise.all(hosts.map((host) => tcpProbe(host, port)));
      const index = reached.indexOf(true);
      if (index < 0) return undefined;
      const sighting: Sighting = {
        dialect,
        host: hosts[index]!,
        port,
        source: "port",
        reachable: true,
      };
      return sighting;
    }),
  );
  return results.filter((s): s is Sighting => s !== undefined);
}
