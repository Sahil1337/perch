// Write a file the way both the config store and the workspace editor need it: a temp file in the
// same directory, then a rename, so a crash or a concurrent reader never sees a half-written file.

import { promises as fs } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { errnoCode } from "./errno.js";

/**
 * `rename` over an existing file can fail transiently on Windows (EPERM/EBUSY) while another
 * process — an editor, an antivirus scanner, a file watcher — briefly holds the target open.
 * Retry a few times with short backoff; on other platforms the first attempt succeeds.
 */
async function renameWithRetry(from: string, to: string, attempts = 5): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      const code = errnoCode(err);
      if (i >= attempts - 1 || (code !== "EPERM" && code !== "EBUSY" && code !== "EACCES")) throw err;
      await new Promise((resolve) => setTimeout(resolve, 25 * (i + 1)));
    }
  }
}

export async function writeFileAtomic(
  file: string,
  data: string,
  opts: { mode?: number } = {},
): Promise<void> {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(tmp, data, { mode: opts.mode ?? 0o644 });
    await renameWithRetry(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
