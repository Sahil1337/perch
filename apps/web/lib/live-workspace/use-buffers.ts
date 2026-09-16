"use client";

import { isPerchError, staleWrite, type PerchClient } from "@perch/client";
import type { Buffer, CursorPosition, SaveState } from "@perch/ui";
import * as React from "react";
import { dirName, fileName, messageOf } from "./helpers";

/** Keyed by path so `openFile` on an already-open file is a focus, not a second tab. */
function bufferIdFor(path: string): string {
  return `file:${path}`;
}

function fileBuffer(path: string, content: string): Buffer {
  return {
    id: bufferIdFor(path),
    path,
    name: fileName(path),
    content,
    dirty: false,
    view: "script",
  };
}

function withoutConflict({ conflict: _resolved, ...rest }: Buffer): Buffer {
  return rest;
}

export type BuffersOptions = {
  autosave: boolean;
  autosaveDelayMs: number;
  /** `openFile` has no state of its own to fail into; the Files tab is where that shows up. */
  reportFileError: (message: string) => void;
  refreshWorkspace: () => void;
};

export type BuffersApi = {
  buffers: readonly Buffer[];
  activeBufferId: string | null;
  activeBuffer: Buffer | undefined;
  saveState: SaveState;
  cursor: CursorPosition;
  setCursor: (cursor: CursorPosition) => void;
  newScratch: () => string;
  openFile: (path: string) => Promise<string>;
  closeBuffer: (id: string) => void;
  focusBuffer: (id: string | null) => void;
  editBuffer: (id: string, content: string) => void;
  setBufferView: (id: string, view: Buffer["view"]) => void;
  save: () => Promise<void>;
  saveAs: (id: string, path: string) => Promise<void>;
  resolveConflict: (id: string, choice: "reload" | "keep") => Promise<void>;
  /** A file changed on disk under an open buffer: adopt it, or raise a conflict. */
  syncExternalFile: (path: string, modifiedAt: string) => void;
};

export function useBuffers(
  getClient: () => PerchClient,
  enabled: boolean,
  options: BuffersOptions,
): BuffersApi {
  const { autosave, autosaveDelayMs, reportFileError, refreshWorkspace } = options;

  const [buffers, setBuffers] = React.useState<readonly Buffer[]>([]);
  const [activeBufferId, setActiveBufferId] = React.useState<string | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("saved");
  const [cursor, setCursor] = React.useState<CursorPosition>({ line: 1, col: 1 });

  const scratchCount = React.useRef(0);
  /** What each file buffer was read at, for `ifModifiedAt`. Bookkeeping, not renderable state. */
  const readAt = React.useRef(new Map<string, string>());
  /** Bumped on every edit, so a save that finishes after a keystroke does not claim "saved". */
  const editSeq = React.useRef(0);

  const activeBuffer = buffers.find((b) => b.id === activeBufferId);

  /**
   * Writes every dirty file buffer, not just the active one: the save indicator and autosave are
   * both global, so leaving a background tab unwritten while the chrome says "saved" would be a lie.
   */
  const commitSave = React.useCallback(async (): Promise<void> => {
    const dirty = buffers.filter((b) => b.path !== null && b.dirty);
    if (dirty.length === 0) {
      setSaveState((prev) => (prev === "error" ? prev : "saved"));
      return;
    }
    const seq = editSeq.current;
    setSaveState("saving");
    let failed = false;

    await Promise.all(
      dirty.map(async (buffer) => {
        const path = buffer.path;
        if (path === null) return;
        const ifModifiedAt = readAt.current.get(buffer.id);
        try {
          const written = await getClient().files.write({
            path,
            content: buffer.content,
            ...(ifModifiedAt ? { ifModifiedAt } : {}),
          });
          readAt.current.set(buffer.id, written.modifiedAt);
          setBuffers((prev) =>
            prev.map((b) =>
              b.id === buffer.id
                // Keystrokes that landed during the write stay dirty, for the next save.
                ? withoutConflict({ ...b, dirty: b.content !== buffer.content })
                : b,
            ),
          );
        } catch (error) {
          failed = true;
          const stale = staleWrite(error);
          if (!stale) return;
          // The 409 carries the file as it is on disk now, so the UI can offer reload-or-keep
          // without a second round trip.
          setBuffers((prev) =>
            prev.map((b) =>
              b.id === buffer.id
                ? {
                    ...b,
                    conflict: {
                      modifiedAt: stale.modifiedAt ?? "",
                      content: stale.content ?? "",
                    },
                  }
                : b,
            ),
          );
        }
      }),
    );

    setSaveState(failed ? "error" : editSeq.current === seq ? "saved" : "unsaved");
  }, [buffers, getClient]);

  React.useEffect(() => {
    if (!enabled || !autosave || saveState !== "unsaved") return;
    const timer = setTimeout(() => void commitSave(), autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [enabled, autosave, autosaveDelayMs, saveState, commitSave]);

  const newScratch = React.useCallback((): string => {
    const n = ++scratchCount.current;
    // A scratch is never dirty: dirty means "differs from disk", and there is no disk copy.
    const buffer: Buffer = {
      id: `scratch:${n}`,
      path: null,
      name: `Query ${n}`,
      content: "",
      dirty: false,
      view: "script",
    };
    setBuffers((prev) => [...prev, buffer]);
    setActiveBufferId(buffer.id);
    return buffer.id;
  }, []);

  const openFile = React.useCallback(
    async (path: string): Promise<string> => {
      const id = bufferIdFor(path);
      if (buffers.some((b) => b.id === id)) {
        setActiveBufferId(id);
        return id;
      }
      try {
        const file = await getClient().files.read(path);
        // The server answers with the resolved path, which is the one writes have to use.
        const openedId = bufferIdFor(file.path);
        readAt.current.set(openedId, file.modifiedAt);
        setBuffers((prev) =>
          prev.some((b) => b.id === openedId) ? prev : [...prev, fileBuffer(file.path, file.content)],
        );
        setActiveBufferId(openedId);
        return openedId;
      } catch (error) {
        reportFileError(messageOf(error));
        return id;
      }
    },
    [buffers, getClient, reportFileError],
  );

  const closeBuffer = React.useCallback((id: string): void => {
    readAt.current.delete(id);
    setBuffers((prev) => {
      const next = prev.filter((b) => b.id !== id);
      setActiveBufferId((current) => (current === id ? (next.at(-1)?.id ?? null) : current));
      return next;
    });
  }, []);

  const editBuffer = React.useCallback(
    (id: string, content: string): void => {
      const target = buffers.find((b) => b.id === id);
      if (!target) return;
      // Only a file can be unsaved: a dirty scratch would nag forever with nowhere to be written.
      const isFile = target.path !== null;
      setBuffers((prev) => prev.map((b) => (b.id === id ? { ...b, content, dirty: isFile } : b)));
      if (!isFile) return;
      editSeq.current += 1;
      setSaveState("unsaved");
    },
    [buffers],
  );

  const setBufferView = React.useCallback((id: string, view: Buffer["view"]): void => {
    setBuffers((prev) => prev.map((b) => (b.id === id ? { ...b, view } : b)));
  }, []);

  const saveAs = React.useCallback(
    async (id: string, path: string): Promise<void> => {
      const buffer = buffers.find((b) => b.id === id);
      if (!buffer) return;
      setSaveState("saving");
      try {
        const files = getClient().files;
        let target = path;
        try {
          target = (await files.create(dirName(path), fileName(path))).path;
        } catch (error) {
          // Saving onto an existing file is a legitimate "save as"; anything else is not.
          if (!isPerchError(error) || error.status !== 409) throw error;
        }
        const written = await files.write({ path: target, content: buffer.content });
        const nextId = bufferIdFor(target);
        readAt.current.delete(id);
        readAt.current.set(nextId, written.modifiedAt);
        setBuffers((prev) =>
          prev.map((b) =>
            b.id === id
              ? withoutConflict({
                  ...b,
                  id: nextId,
                  path: target,
                  name: fileName(target),
                  dirty: false,
                })
              : b,
          ),
        );
        setActiveBufferId((current) => (current === id ? nextId : current));
        setSaveState("saved");
        refreshWorkspace();
      } catch {
        setSaveState("error");
      }
    },
    [buffers, getClient, refreshWorkspace],
  );

  const resolveConflict = React.useCallback(
    async (id: string, choice: "reload" | "keep"): Promise<void> => {
      const buffer = buffers.find((b) => b.id === id);
      const conflict = buffer?.conflict;
      if (!buffer || !conflict || buffer.path === null) return;

      if (choice === "reload") {
        readAt.current.set(id, conflict.modifiedAt);
        setBuffers((prev) =>
          prev.map((b) =>
            b.id === id ? withoutConflict({ ...b, content: conflict.content, dirty: false }) : b,
          ),
        );
        setSaveState("saved");
        return;
      }

      // "keep" writes without `ifModifiedAt`: guarding against the version just discarded would
      // refuse the write forever.
      setSaveState("saving");
      try {
        const written = await getClient().files.write({
          path: buffer.path,
          content: buffer.content,
        });
        readAt.current.set(id, written.modifiedAt);
        setBuffers((prev) =>
          prev.map((b) => (b.id === id ? withoutConflict({ ...b, dirty: false }) : b)),
        );
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [buffers, getClient],
  );

  const syncExternalFile = React.useCallback(
    (path: string, modifiedAt: string): void => {
      const buffer = buffers.find((b) => b.path === path);
      if (!buffer) return;
      // The server suppresses the echo of our own writes; this is the belt to that's braces.
      if (readAt.current.get(buffer.id) === modifiedAt) return;

      void (async () => {
        try {
          const file = await getClient().files.read(path);
          if (buffer.dirty) {
            // Someone else edited the file while there were unsaved changes here. Offer both.
            setBuffers((prev) =>
              prev.map((b) =>
                b.id === buffer.id
                  ? { ...b, conflict: { modifiedAt: file.modifiedAt, content: file.content } }
                  : b,
              ),
            );
            return;
          }
          readAt.current.set(buffer.id, file.modifiedAt);
          setBuffers((prev) =>
            prev.map((b) => (b.id === buffer.id && !b.dirty ? { ...b, content: file.content } : b)),
          );
        } catch {
          /* the file moved again between the event and the read; the next event will say so */
        }
      })();
    },
    [buffers, getClient],
  );

  return {
    buffers,
    activeBufferId,
    activeBuffer,
    saveState,
    cursor,
    setCursor,
    newScratch,
    openFile,
    closeBuffer,
    focusBuffer: setActiveBufferId,
    editBuffer,
    setBufferView,
    save: commitSave,
    saveAs,
    resolveConflict,
    syncExternalFile,
  };
}
