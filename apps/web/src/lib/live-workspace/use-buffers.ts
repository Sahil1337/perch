// The tabs open in the editor, and everything that can be true about whether their contents are on
// disk. The rules themselves are in `buffers-reducer.ts`; this file is the I/O around them — every
// action here is "call the server, then say what came back".

import { isPerchError, staleWrite, type PerchClient } from "@perch/client";
import type { Buffer, CursorPosition, SaveState } from "@perch/ui";
import * as React from "react";
import { buffersReducer, initialBuffersState, saveStateOf } from "./buffers-reducer";
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
  /** The buffer id, or null when the file could not be read and no tab was opened. */
  openFile: (path: string) => Promise<string | null>;
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

  const [state, dispatch] = React.useReducer(buffersReducer, initialBuffersState);
  const { buffers, activeBufferId } = state;
  const [cursor, setCursor] = React.useState<CursorPosition>({ line: 1, col: 1 });

  const scratchCount = React.useRef(0);
  /** What each file buffer was read at, for `ifModifiedAt`. Bookkeeping, not renderable state. */
  const readAt = React.useRef(new Map<string, string>());

  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  const saveState = saveStateOf(state);

  /**
   * Writes every dirty file buffer, not just the active one: the save indicator and autosave are
   * both global, so leaving a background tab unwritten while the chrome says "saved" would be a lie.
   */
  const commitSave = React.useCallback(async (): Promise<void> => {
    const dirty = buffers.filter((b) => b.path !== null && b.dirty);
    if (dirty.length === 0) {
      dispatch({ type: "saveSkipped" });
      return;
    }
    dispatch({ type: "saveStarted" });
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
          dispatch({ type: "saveWritten", id: buffer.id, written: buffer.content });
        } catch (error) {
          failed = true;
          const stale = staleWrite(error);
          if (!stale) return;
          // The 409 carries the file as it is on disk now, so the UI can offer reload-or-keep
          // without a second round trip.
          dispatch({
            type: "conflict",
            id: buffer.id,
            disk: { modifiedAt: stale.modifiedAt ?? "", content: stale.content ?? "" },
          });
        }
      }),
    );

    dispatch({ type: "saveFinished", failed });
  }, [buffers, getClient]);

  /**
   * Autosave, and the reason it debounces.
   *
   * `revision` changes on every buffers write, so a keystroke tears this effect down and starts the
   * delay over: the write lands once you stop typing, not `autosaveDelayMs` after the first
   * character. That debounce used to be a side effect of `commitSave` being rebuilt on every
   * keystroke and appearing in this dependency list — which meant a routine "stabilise this
   * callback" refactor would have silently turned autosave into fire-once-per-dirty-transition.
   * `commitSave` is now read through a ref precisely so its identity plays no part, and `revision`
   * is the thing this is keyed on, on purpose.
   */
  const latestSave = React.useRef(commitSave);
  React.useEffect(() => {
    latestSave.current = commitSave;
  }, [commitSave]);

  React.useEffect(() => {
    if (!enabled || !autosave || saveState !== "unsaved") return;
    const timer = setTimeout(() => void latestSave.current(), autosaveDelayMs);
    return () => clearTimeout(timer);
  }, [enabled, autosave, autosaveDelayMs, saveState, state.revision]);

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
    dispatch({ type: "newScratch", buffer });
    return buffer.id;
  }, []);

  const openFile = React.useCallback(
    async (path: string): Promise<string | null> => {
      const id = bufferIdFor(path);
      if (buffers.some((b) => b.id === id)) {
        dispatch({ type: "focus", id });
        return id;
      }
      try {
        const file = await getClient().files.read(path);
        // The server answers with the resolved path, which is the one writes have to use.
        const openedId = bufferIdFor(file.path);
        readAt.current.set(openedId, file.modifiedAt);
        dispatch({ type: "opened", buffer: fileBuffer(file.path, file.content) });
        return openedId;
      } catch (error) {
        reportFileError(messageOf(error));
        return null;
      }
    },
    [buffers, getClient, reportFileError],
  );

  const closeBuffer = React.useCallback((id: string): void => {
    readAt.current.delete(id);
    dispatch({ type: "close", id });
  }, []);

  const focusBuffer = React.useCallback((id: string | null): void => {
    dispatch({ type: "focus", id });
  }, []);

  const editBuffer = React.useCallback((id: string, content: string): void => {
    dispatch({ type: "edit", id, content });
  }, []);

  const setBufferView = React.useCallback((id: string, view: Buffer["view"]): void => {
    dispatch({ type: "setView", id, view });
  }, []);

  const saveAs = React.useCallback(
    async (id: string, path: string): Promise<void> => {
      const buffer = buffers.find((b) => b.id === id);
      if (!buffer) return;
      dispatch({ type: "saveStarted" });
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
        dispatch({ type: "savedAs", id, nextId, path: target, name: fileName(target) });
        refreshWorkspace();
      } catch {
        dispatch({ type: "saveFailed" });
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
        dispatch({ type: "conflictResolved", id, choice });
        return;
      }

      // "keep" writes without `ifModifiedAt`: guarding against the version just discarded would
      // refuse the write forever.
      dispatch({ type: "saveStarted" });
      try {
        const written = await getClient().files.write({
          path: buffer.path,
          content: buffer.content,
        });
        readAt.current.set(id, written.modifiedAt);
        dispatch({ type: "conflictResolved", id, choice });
      } catch {
        dispatch({ type: "saveFailed" });
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
            dispatch({
              type: "conflict",
              id: buffer.id,
              disk: { modifiedAt: file.modifiedAt, content: file.content },
            });
            return;
          }
          readAt.current.set(buffer.id, file.modifiedAt);
          dispatch({ type: "externalUpdate", id: buffer.id, content: file.content });
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
    focusBuffer,
    editBuffer,
    setBufferView,
    save: commitSave,
    saveAs,
    resolveConflict,
    syncExternalFile,
  };
}
