// Listing folders for the workspace picker.
//
// Deliberately not scoped to the configured workspaces: its whole job is to find a folder that is
// not one yet. That is the same reach `perch serve --dir` already has, on a server bound to
// loopback whose purpose is to open your files — but it is read-only and returns names, never
// contents, and the file API's scoping is untouched by it.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BrowseResult } from "@perch/protocol";
import { badRequest, notFound } from "../http/errors.js";
import { errnoCode } from "../../util/errno.js";

/** Dotfolders are noise in a picker; someone who wants one can still type the path. */
function visible(name: string): boolean {
  return !name.startsWith(".");
}

export async function browseDirectory(target?: string): Promise<BrowseResult> {
  const home = os.homedir();
  const requested = target === undefined || target.trim().length === 0 ? home : target;
  if (requested.includes("\0")) throw badRequest("invalid path");

  const resolved = path.resolve(requested);
  let dirents;
  try {
    dirents = await fs.readdir(resolved, { withFileTypes: true });
  } catch (error) {
    const code = errnoCode(error);
    if (code === "ENOENT") throw notFound(`No such folder: ${resolved}`);
    if (code === "ENOTDIR") throw badRequest(`Not a folder: ${resolved}`);
    if (code === "EACCES" || code === "EPERM") throw badRequest(`Not readable: ${resolved}`);
    throw error;
  }

  const entries = dirents
    .filter((entry) => entry.isDirectory() && visible(entry.name))
    .map((entry) => ({ name: entry.name, path: path.join(resolved, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const parent = path.dirname(resolved);
  return {
    path: resolved,
    parent: parent === resolved ? null : parent,
    home,
    entries,
  };
}
