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

Run "perch <command> --help" for command-specific options. "perch --version" prints the version.
`;

const COMMANDS = new Set(["serve", "stop", "status"]);

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

  // The command module is imported lazily so `perch --version` and `perch --help` answer without
  // loading the HTTP server module at all.
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
