// Which files were open last time, so a reload lands you back in your work rather than in an empty
// window. Per-machine session state, like panel geometry and for the same reason: which tabs this
// browser had open is a property of this machine, not of the workspace on disk, and a second
// machine opening the same `~/.perch` should keep its own window. So localStorage, not the server.
//
// Its own key rather than a corner of `perch.panels.v1`, because the layout cannot be trusted to
// carry the record: pane ids are path-derived, but the grid reconciles its tree against the buffers
// that exist, and at boot none do — the `buffer:file:…` panes are pruned and the pruned tree is
// written straight back. The layout erases the evidence within a frame of load. This key is written
// only once the restore has settled, so it survives that.
//
// Paths only. A scratch buffer has no path and its text exists nowhere but memory; writing unsaved
// content into localStorage is a different feature with different risks, so scratches are not
// restored and their tabs do not come back.
//
// A remembered file that no longer opens — deleted, renamed, permissions — is skipped, and the
// others still open. `openFile` reports each failure into the Files tab's error line, which is
// last-write-wins, so N missing files cost one line rather than N; this hook writes the line that
// lands last, naming all of them at once instead of whichever happened to fail late.

import { readJson, writeRaw } from "@perch/ui";
import * as React from "react";
import { fileName } from "./helpers";
import type { BuffersApi } from "./use-buffers";

const STORAGE_KEY = "perch.session.v1";

type FileSession = {
  /** Open file buffers' paths, in tab order. Never a scratch: those have no path to remember. */
  readonly files: readonly string[];
  /** Which of them had focus, or null when the focused tab was a scratch or there was none. */
  readonly active: string | null;
};

const EMPTY: FileSession = { files: [], active: null };

/** The static export prerenders this component, where there is no storage: `EMPTY` is the answer. */
function readSession(): FileSession {
  return readJson(STORAGE_KEY, validate, EMPTY);
}

/**
 * From a store the user can edit and a release can outgrow: a malformed record costs a restore, not
 * the app. A remembered `active` that is not in `files` is dropped rather than trusted.
 */
function validate(parsed: unknown): FileSession | undefined {
  if (typeof parsed !== "object" || parsed === null) return undefined;
  const stored = parsed as Partial<FileSession>;
  const files = Array.isArray(stored.files)
    ? stored.files.filter((path): path is string => typeof path === "string")
    : [];
  const active = typeof stored.active === "string" ? stored.active : null;
  return { files, active: active !== null && files.includes(active) ? active : null };
}

/** What the restore needs of the buffers: the list to watch, and the two actions that reopen it. */
type SessionBuffers = Pick<BuffersApi, "buffers" | "activeBufferId" | "openFile" | "focusBuffer">;

export function useFileSession(
  enabled: boolean,
  workspace: SessionBuffers,
  reportFileError: (message: string) => void,
): {
  /**
   * True from the first render until the remembered files are open. The grid prunes panes for
   * buffers that do not exist yet, so the layout must not be persisted while this is true — see
   * where it is used in `live-workspace.ts`. False for the whole session when nothing is
   * remembered, which is what keeps a first run on exactly the default path.
   */
  restoring: boolean;
} {
  const { buffers, activeBufferId, openFile, focusBuffer } = workspace;

  // Read once, at mount, rather than through an external store: the record is consumed exactly
  // once and never rendered, so there is nothing for a later write — here or in another tab — to
  // change. It has to be in hand this early because the grid's first write-back comes from a child
  // effect, which runs before any effect of this hook could have raised the gate.
  const [remembered] = React.useState(readSession);
  const [restored, setRestored] = React.useState(false);
  const restoring = !restored && remembered.files.length > 0;

  /**
   * `openFile` closes over the buffer list, so its identity changes as tabs appear. Held in a ref
   * so the restore below can depend on the server gate alone and still call the current one; a
   * stale one costs at most a redundant read, since `openFile` de-duplicates by path on the way in.
   */
  const latestOpen = React.useRef(openFile);
  React.useEffect(() => {
    latestOpen.current = openFile;
  });

  /** Exactly once per app load, whatever re-renders or a StrictMode double-mount do to the effect. */
  const started = React.useRef(false);
  React.useEffect(() => {
    // Files are read over HTTP, so there is nothing to restore into until the server answers.
    if (!enabled || started.current || remembered.files.length === 0) return;
    started.current = true;
    void (async () => {
      // One at a time, in the order they were in: buffers are appended as they arrive, so opening
      // them in parallel would shuffle the tab strip into whatever order the reads finished in.
      // A file that cannot be read resolves like any other; it just leaves no buffer behind.
      for (const path of remembered.files) await latestOpen.current(path);
      setRestored(true);
    })();
  }, [enabled, remembered]);

  const settled = React.useRef(false);
  React.useEffect(() => {
    if (!restored || settled.current) return;
    settled.current = true;

    // This render carries every buffer the loop opened, which is why the outcome is read here and
    // not inside the loop: an `await openFile(…)` resolves before React has committed the tab.
    const missing = remembered.files.filter((path) => !buffers.some((b) => b.path === path));
    const active = remembered.active;
    const target = active === null ? undefined : buffers.find((b) => b.path === active);
    // Focus is the user's before it is ours: if what has focus now is a tab this restore did not
    // open — a scratch, or a file they picked while it was in flight — theirs stands. Anything the
    // restore itself focused, which is whichever file it opened last, does not outrank the
    // remembered one.
    const taken = buffers.some(
      (b) => b.id === activeBufferId && (b.path === null || !remembered.files.includes(b.path)),
    );
    if (target && !taken) focusBuffer(target.id);

    if (missing.length === 0) return;
    const names = missing.map(fileName).join(", ");
    reportFileError(
      missing.length === 1
        ? `Could not reopen ${names} from your last session.`
        : `Could not reopen ${missing.length} files from your last session: ${names}.`,
    );
  }, [restored, remembered, buffers, activeBufferId, focusBuffer, reportFileError]);

  // Serialized during render so the effect below can compare it: `buffers` changes on every
  // keystroke, and what is remembered does not.
  const record = React.useMemo(
    () =>
      JSON.stringify({
        files: buffers.flatMap((b) => (b.path === null ? [] : [b.path])),
        active: buffers.find((b) => b.id === activeBufferId)?.path ?? null,
      } satisfies FileSession),
    [buffers, activeBufferId],
  );

  React.useEffect(() => {
    // Writing while the restore is in flight would replace the record with the empty list it is
    // still working through.
    if (restoring) return;
    writeRaw(STORAGE_KEY, record);
  }, [restoring, record]);

  return { restoring };
}
