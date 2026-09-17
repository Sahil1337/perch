// The small JSON documents under ~/.perch, one store per file. A store binds what every call site
// used to restate: the filename, what a missing file reads as, and the mode it must be written
// with — connections.json holds passwords, so 0600 is a property of the file rather than something
// each writer has to remember. Writes go through the shared atomic write (temp file + rename).

import { promises as fs } from "node:fs";
import path from "node:path";
import { writeFileAtomic } from "../util/atomic-write.js";
import { errnoCode } from "../util/errno.js";
import { configFile, ensureDir } from "./paths.js";

export class JsonStore<T> {
  constructor(
    private readonly name: string,
    private readonly fallback: () => T,
    private readonly mode = 0o644,
  ) {}

  /** Creating perch home is part of reading and writing, so neither trips over a fresh machine. */
  private async file(): Promise<string> {
    return path.join(await ensureDir(), this.name);
  }

  async read(): Promise<T> {
    try {
      return JSON.parse(await fs.readFile(await this.file(), "utf8")) as T;
    } catch (err) {
      if (errnoCode(err) === "ENOENT") return this.fallback();
      throw err;
    }
  }

  async write(value: T): Promise<void> {
    const body = JSON.stringify(value, null, 2) + "\n";
    await writeFileAtomic(await this.file(), body, { mode: this.mode });
  }

  /** Deletes the document. Unlike a read it does not create perch home first. */
  async remove(): Promise<void> {
    try {
      await fs.unlink(configFile(this.name));
    } catch {
      /* already gone */
    }
  }
}
