// Watches the workspace roots through the operating system's own change notifications — FSEvents on
// macOS, inotify on Linux, ReadDirectoryChangesW on Windows — via `node:fs` `watch`. No polling and
// no timers for detection: the only timer here debounces the burst of raw events a single editor
// save produces, so subscribers see one event per path per burst.
//
// The watcher is a *hint* for the UI. Save safety still comes from the `ifModifiedAt` check in
// PUT /api/files/content, so a dropped or coalesced event can never cost anyone their work.

import { watch, promises as fsp, type FSWatcher, type Stats, type WatchEventType } from "node:fs";
import path from "node:path";
import type { FileEvent } from "@perch/protocol";
import { SKIPPED_DIRS, isHidden, isSqlFile, resolveRoots } from "./workspace-paths.js";

/** A save fires 2-4 raw events within a few ms; flush once per path this long after the first. */
export const COALESCE_MS = 40;
/** How long an `expectWrite`/`expectDelete` hint may suppress an echo before it is discarded. */
export const EXPECT_TTL_MS = 2000;

/** macOS (HFS+/APFS default) and Windows compare paths case-insensitively; Linux does not. */
const CASE_INSENSITIVE = process.platform === "win32" || process.platform === "darwin";

/** Normalised map key for a path: separators resolved, and case folded where the FS folds it. */
export function watchKey(full: string): string {
  const resolved = path.resolve(full);
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved;
}

export type FileWatcherOptions = {
  onEvent: (event: FileEvent) => void;
  /** Override the 40ms burst window (tests). */
  coalesceMs?: number;
  /** Override the 2s echo-hint lifetime (tests). */
  expectTtlMs?: number;
};

export class FileWatcher {
  private readonly onEvent: (event: FileEvent) => void;
  private readonly coalesceMs: number;
  private readonly expectTtlMs: number;
  /** key(root) → live FSWatcher. */
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly rootPaths = new Map<string, string>();
  /** key(path) → pending flush. One entry per path keeps a burst to a single emitted event. */
  private readonly pending = new Map<string, { full: string; timer: NodeJS.Timeout }>();
  /** Everything this watcher has ever seen, so a first sighting can be flagged `created`. */
  private readonly known = new Map<string, "file" | "dir">();
  private readonly expectedWrites = new Map<string, { modifiedAt: string; at: number }>();
  private readonly expectedDeletes = new Map<string, number>();
  private warned = false;
  private closed = false;

  constructor(opts: FileWatcherOptions) {
    this.onEvent = opts.onEvent;
    this.coalesceMs = opts.coalesceMs ?? COALESCE_MS;
    this.expectTtlMs = opts.expectTtlMs ?? EXPECT_TTL_MS;
  }

  /** The roots currently being watched (realpath'd). */
  roots(): string[] {
    return [...this.rootPaths.values()];
  }

  /**
   * Diffs `roots` against what is already watched: starts watchers for the new ones, closes the
   * ones that went away. Resolves with the roots that are actually being watched.
   */
  async setRoots(roots: readonly string[]): Promise<string[]> {
    const real = await resolveRoots(roots);
    if (this.closed) return [];
    const wanted = new Map(real.map((root) => [watchKey(root), root]));
    for (const [key, watcher] of [...this.watchers]) {
      if (wanted.has(key)) continue;
      this.watchers.delete(key);
      this.rootPaths.delete(key);
      this.closeWatcher(watcher);
    }
    for (const [key, root] of wanted) {
      if (this.watchers.has(key)) continue;
      const watcher = this.startWatch(root);
      if (!watcher) continue;
      this.watchers.set(key, watcher);
      this.rootPaths.set(key, root);
    }
    return this.roots();
  }

  /**
   * Tells the watcher that *we* just wrote `fullPath` and produced `modifiedAt`; the matching echo
   * is dropped instead of being reported back to the client that caused it.
   */
  expectWrite(fullPath: string, modifiedAt: string): void {
    if (this.closed || !modifiedAt) return;
    const key = watchKey(fullPath);
    this.expectedWrites.set(key, { modifiedAt, at: Date.now() });
    this.known.set(key, "file"); // our own create counts as having seen the path
  }

  /** Same, for a path the API removed (DELETE, or the old name of a rename). */
  expectDelete(fullPath: string): void {
    if (this.closed) return;
    const key = watchKey(fullPath);
    this.expectedDeletes.set(key, Date.now());
    this.expectedWrites.delete(key);
  }

  close(): void {
    this.closed = true;
    for (const { timer } of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    for (const watcher of this.watchers.values()) this.closeWatcher(watcher);
    this.watchers.clear();
    this.rootPaths.clear();
    this.expectedWrites.clear();
    this.expectedDeletes.clear();
  }

  // ---- internals -----------------------------------------------------------------------------

  private closeWatcher(watcher: FSWatcher): void {
    try {
      watcher.close();
    } catch {
      /* already gone */
    }
  }

  private startWatch(root: string): FSWatcher | null {
    try {
      // `persistent: false` so a watcher never keeps the process alive on its own.
      const watcher = watch(root, { recursive: true, persistent: false }, (eventType, filename) =>
        this.onRaw(root, eventType, filename),
      );
      watcher.on("error", (err) => {
        // ENOSPC (inotify watch limit), EMFILE, or the root being removed underneath us.
        this.warnOnce(root, err);
        this.closeWatcher(watcher);
        const key = watchKey(root);
        if (this.watchers.get(key) === watcher) {
          this.watchers.delete(key);
          this.rootPaths.delete(key);
        }
      });
      return watcher;
    } catch (err) {
      // ERR_FEATURE_UNAVAILABLE_ON_PLATFORM (no recursive watch), ENOSPC, EMFILE, ENOENT, ...
      this.warnOnce(root, err);
      return null;
    }
  }

  private warnOnce(root: string, err: unknown): void {
    if (this.warned) return;
    this.warned = true;
    const code = (err as NodeJS.ErrnoException | undefined)?.code;
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[perch] cannot watch ${root}${code ? ` (${code})` : ""}: ${message}. ` +
        `Live file sync is off for it; saving is still safe (the mtime check is authoritative).`,
    );
  }

  private onRaw(root: string, _eventType: WatchEventType, filename: string | Buffer | null): void {
    if (this.closed || filename === null) return;
    const relative = typeof filename === "string" ? filename : filename.toString("utf8");
    if (relative === "") return;
    // Windows hands back a relative, back-slashed path (sometimes just the parent directory);
    // resolving against the root normalises it to one absolute path.
    const full = path.resolve(root, relative);
    const rel = path.relative(root, full);
    if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
      return;
    }
    for (const segment of rel.split(path.sep)) {
      if (isHidden(segment) || SKIPPED_DIRS.has(segment)) return;
    }
    this.schedule(full);
  }

  /** First raw event for a path opens a window; later ones inside it fold into the same flush. */
  private schedule(full: string): void {
    const key = watchKey(full);
    if (this.pending.has(key)) return;
    const timer = setTimeout(() => {
      this.pending.delete(key);
      void this.flush(full);
    }, this.coalesceMs);
    timer.unref();
    this.pending.set(key, { full, timer });
  }

  /**
   * Resolves a raw event by asking the filesystem what the path looks like now, which is also why an
   * editor's temp-file-plus-rename save reads as one `change` rather than a delete and a create.
   */
  private async flush(full: string): Promise<void> {
    if (this.closed) return;
    const key = watchKey(full);
    const name = path.basename(full);
    let stats: Stats | null;
    try {
      stats = await fsp.stat(full);
    } catch {
      stats = null;
    }
    if (this.closed) return;

    if (stats?.isDirectory()) {
      this.known.set(key, "dir");
      this.onEvent({ type: "dir", path: full, name });
      return;
    }

    if (stats?.isFile()) {
      if (!isSqlFile(name)) return;
      const modifiedAt = stats.mtime.toISOString();
      if (this.takeExpectedWrite(key, modifiedAt)) return;
      const created = !this.known.has(key);
      this.known.set(key, "file");
      const event: FileEvent = { type: "change", path: full, name, modifiedAt, size: stats.size };
      if (created) event.created = true;
      this.onEvent(event);
      return;
    }

    // The path is gone. `known` tells us whether it used to be a directory.
    const kind = this.known.get(key);
    this.known.delete(key);
    if (this.takeExpectedDelete(key)) return;
    if (kind === "dir") {
      this.onEvent({ type: "dir", path: full, name, deleted: true });
      return;
    }
    if (isSqlFile(name)) this.onEvent({ type: "delete", path: full, name });
  }

  private takeExpectedWrite(key: string, modifiedAt: string): boolean {
    const hint = this.expectedWrites.get(key);
    if (!hint) return false;
    this.expectedWrites.delete(key);
    // An expired hint is discarded rather than trusted: a lost event must not poison a real change.
    if (Date.now() - hint.at > this.expectTtlMs) return false;
    return hint.modifiedAt === modifiedAt;
  }

  private takeExpectedDelete(key: string): boolean {
    const at = this.expectedDeletes.get(key);
    if (at === undefined) return false;
    this.expectedDeletes.delete(key);
    return Date.now() - at <= this.expectTtlMs;
  }
}
