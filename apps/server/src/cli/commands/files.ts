// `perch files ls [dir]` — lists .sql files and subdirectories. Local and standalone (no server
// needed); the listing rules themselves come from the server's workspace-files, so the CLI and the
// HTTP file API agree on what a directory contains. Only the sandboxing is server-side.

import path from "node:path";
import type { FileEntry } from "@perch/protocol";
import { errorMessage } from "../../server/http/errors.js";
import { listDir } from "../../server/services/workspace-files.js";
import { defineCommand, defineGroup, die, dim, printJson } from "../util/index.js";

const FILES_HELP = "usage: perch files ls [dir] [--json]";

const ls = defineCommand({ usage: FILES_HELP }, async ({ positionals, json }) => {
  const dir = path.resolve(positionals[0] ?? process.cwd());
  let entries: FileEntry[];
  try {
    entries = await listDir(dir);
  } catch (err) {
    die(errorMessage(err));
  }
  if (json) {
    printJson(entries);
    return;
  }
  if (entries.length === 0) {
    console.log(dim("(empty)"));
    return;
  }
  for (const e of entries) {
    const marker = e.kind === "dir" ? "d" : "-";
    const size = e.size !== undefined ? dim(`  ${e.size}b`) : "";
    console.log(`${marker}  ${e.name}${size}`);
  }
});

export const cmdFiles = defineGroup(FILES_HELP, { ls });
