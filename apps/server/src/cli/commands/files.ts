// `perch files ls [dir]` — lists .sql files and subdirectories (hidden entries skipped). Local,
// standalone listing (no server needed) — the HTTP file API's workspace sandboxing is a
// separate, server-side concern for the browser UI.

import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileEntry } from "@perch/protocol";
import { defineCommand, dim, printJson } from "../util/index.js";

const FILES_HELP = "usage: perch files ls [dir] [--json]";

async function listSqlEntries(dir: string): Promise<FileEntry[]> {
  const dirents = await fs.readdir(dir, { withFileTypes: true });
  const out: FileEntry[] = [];
  for (const d of dirents) {
    if (d.name.startsWith(".")) continue;
    const full = path.join(dir, d.name);
    if (d.isDirectory()) {
      out.push({ path: full, name: d.name, kind: "dir" });
    } else if (d.isFile() && d.name.endsWith(".sql")) {
      const stat = await fs.stat(full);
      out.push({ path: full, name: d.name, kind: "file", size: stat.size, modifiedAt: stat.mtime.toISOString() });
    }
  }
  out.sort((a, b) => (a.kind !== b.kind ? (a.kind === "dir" ? -1 : 1) : a.name.localeCompare(b.name)));
  return out;
}

const ls = defineCommand({ usage: FILES_HELP }, async ({ positionals, json }) => {
  const dir = path.resolve(positionals[0] ?? process.cwd());
  const entries = await listSqlEntries(dir);
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

export async function cmdFiles(argv: string[]): Promise<void> {
  const [sub, ...rest] = argv;
  if (sub === "ls") return ls(rest);
  console.log(FILES_HELP);
  if (sub && sub !== "--help" && sub !== "-h") process.exitCode = 1;
}
