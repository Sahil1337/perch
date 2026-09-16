#!/usr/bin/env node
// perch — perch CLI. Dispatches to src/cli/commands/* modules. See README.md for usage.

import { CliError, red } from "./util/index.js";
import { VERSION } from "../core/version.js";

const HELP = `perch (perch) v${VERSION} — a tiny local SQL client

usage: perch [command] [options]

commands:
  serve                 start the local server and open the UI (default command)
  stop                  stop the running server
  status                show whether the server is running
  discover              find Postgres/MySQL servers already on this machine
  conn add|ls|rm|test|dbs   manage saved connections
  schema <conn>          inspect a connection's schema
  run <conn> <file|-e sql|->  run SQL directly through the driver (no server needed)
  history                show recent runs
  files ls [dir]          list .sql files in a directory
  settings get|set        read or change local settings

Run "perch <command> --help" for command-specific options. "perch --version" prints the version.
`;

const COMMANDS = new Set(["serve", "stop", "status", "discover", "conn", "schema", "run", "history", "files", "settings"]);

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv[0] === "--version" || argv[0] === "-v") {
    console.log(VERSION);
    return;
  }
  if (argv[0] === "--help" || argv[0] === "-h") {
    console.log(HELP);
    return;
  }

  let command = "serve";
  let rest = argv;
  const first = argv[0];
  if (first !== undefined && COMMANDS.has(first)) {
    command = first;
    rest = argv.slice(1);
  } else if (first !== undefined && !first.startsWith("-")) {
    console.error(red(`unknown command: ${first}`));
    console.log(HELP);
    process.exitCode = 1;
    return;
  }
  // else: no command / a leading flag — falls through to "serve" with the full argv.

  // Command modules are imported lazily so e.g. "perch run" never needs to load the HTTP server
  // module (and keeps working standalone even before/without src/server/start.ts).
  switch (command) {
    case "serve": {
      const { cmdServe } = await import("./commands/serve.js");
      return cmdServe(rest);
    }
    case "stop": {
      const { cmdStop } = await import("./commands/serve.js");
      return cmdStop(rest);
    }
    case "status": {
      const { cmdStatus } = await import("./commands/serve.js");
      return cmdStatus(rest);
    }
    case "discover": {
      const { cmdDiscover } = await import("./commands/discover.js");
      return cmdDiscover(rest);
    }
    case "conn": {
      const { cmdConn } = await import("./commands/conn.js");
      return cmdConn(rest);
    }
    case "schema": {
      const { cmdSchema } = await import("./commands/schema.js");
      return cmdSchema(rest);
    }
    case "run": {
      const { cmdRun } = await import("./commands/run.js");
      return cmdRun(rest);
    }
    case "history": {
      const { cmdHistory } = await import("./commands/history.js");
      return cmdHistory(rest);
    }
    case "files": {
      const { cmdFiles } = await import("./commands/files.js");
      return cmdFiles(rest);
    }
    case "settings": {
      const { cmdSettings } = await import("./commands/settings.js");
      return cmdSettings(rest);
    }
  }
}

main().catch((err: unknown) => {
  if (err instanceof CliError) {
    console.error(red(`error: ${err.message}`));
  } else {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
  }
  process.exitCode = 1;
});
