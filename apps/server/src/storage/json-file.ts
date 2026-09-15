// Reading and writing the small JSON documents under ~/.perch. Writes go through the
// shared atomic write (temp file + rename) so a crash can never leave a half-written file behind.

import { promises as fs } from "node:fs";
import { writeFileAtomic } from "../util/atomic-write.js";
import { errnoCode } from "../util/errno.js";

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch (err) {
    if (errnoCode(err) === "ENOENT") return fallback;
    throw err;
  }
}

export async function writeJsonAtomic(file: string, value: unknown, mode = 0o644): Promise<void> {
  await writeFileAtomic(file, JSON.stringify(value, null, 2) + "\n", { mode });
}
