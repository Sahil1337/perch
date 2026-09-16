// `perch discover [--json]` — what database servers are already on this machine. No server needed:
// the same probes the /api/discover route runs, printed as a table.

import { discoverServers } from "../../server/services/discovery/index.js";
import { formatTable } from "../output/format.js";
import { bold, defineCommand, dim, printJson } from "../util/index.js";

const DISCOVER_HELP = `usage: perch discover [--json]

Looks for Postgres and MySQL servers already installed or running locally — open ports, binaries
on PATH, brew/systemd/Windows services and docker containers. Nothing is installed or started.
`;

const COLUMNS = ["dialect", "address", "up", "version", "sources", "suggested url"].map((name) => ({
  name,
  type: "text",
  align: "left" as const,
}));

export const cmdDiscover = defineCommand({ usage: DISCOVER_HELP }, async ({ json }) => {
  const result = await discoverServers();
  if (json) {
    printJson(result);
    return;
  }
  if (result.servers.length === 0) {
    console.log("no local database servers found");
    console.log(dim(`scanned in ${result.durationMs} ms`));
    return;
  }

  const rows = result.servers.map((s) => [
    s.dialect,
    `${s.host}:${s.port}`,
    // Plain glyphs, not colour: formatTable measures column widths in characters and
    // ANSI escapes would throw the alignment off.
    s.reachable ? "✓" : "✗",
    s.version ?? "",
    s.sources.join(","),
    s.suggestedUrl,
  ]);
  console.log(formatTable(COLUMNS, rows));
  console.log(dim(`${result.servers.length} found in ${result.durationMs} ms · os user ${result.osUser}`));
  console.log(`connect with: ${bold("perch conn add <name> <url>")}`);
});
