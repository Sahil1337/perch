// Every rule about dirty, saved and conflicted, in one place.
//
// This used to be a stored `saveState` written from five call sites whose rules only made sense
// read together. Two of its four values — "saved" and "unsaved" — are not state at all: they are
// `buffers.some(b => b.path !== null && b.dirty)`, which AGENTS.md says not to store. Only "saving"
// and "error" are genuinely extra, so only those two are a `phase`, and `saveStateOf` derives the
// answer the UI reads.
//
// That derivation also retired the edit sequence counter the old code kept in a ref to tell
// "nothing changed while the write was in flight" from "something did". A write records
// `dirty: content !== written`, so the buffers already carry that answer and the counter had
// nothing left to decide.

import type { Buffer, SaveState } from "@perch/ui";

export type BuffersState = {
  readonly buffers: readonly Buffer[];
  readonly activeBufferId: string | null;
  /**
   * What a save is doing right now. "idle" is not "saved": whether the work is safe is read off
   * the buffers, and this only says whether a write is in flight or the last one was refused.
   */
  readonly phase: "idle" | "saving" | "error";
  /**
   * Bumped whenever `buffers` is replaced. The autosave effect is keyed on this, which is what
   * makes autosave debounce — see `use-buffers.ts`.
   */
  readonly revision: number;
};

export const initialBuffersState: BuffersState = {
  buffers: [],
  activeBufferId: null,
  phase: "idle",
  revision: 0,
};

export type BuffersAction =
  | { type: "newScratch"; buffer: Buffer }
  /** A file read that came back. Focuses it whether or not it was already open. */
  | { type: "opened"; buffer: Buffer }
  | { type: "focus"; id: string | null }
  | { type: "close"; id: string }
  | { type: "edit"; id: string; content: string }
  | { type: "setView"; id: string; view: Buffer["view"] }
  /** A write is going out for at least one buffer. */
  | { type: "saveStarted" }
  /** `save()` found nothing to write. Clears a stale "saving", but not a failure nobody saw yet. */
  | { type: "saveSkipped" }
  /** One buffer's write landed. `written` is the content the server took, not the content now. */
  | { type: "saveWritten"; id: string; written: string }
  /** The 409 path: the server has a newer copy, carried in the response so the UI can offer both. */
  | { type: "conflict"; id: string; disk: { modifiedAt: string; content: string } }
  | { type: "saveFinished"; failed: boolean }
  | { type: "saveFailed" }
  /** A scratch became a file, or a file was written somewhere else. */
  | { type: "savedAs"; id: string; nextId: string; path: string; name: string }
  | { type: "conflictResolved"; id: string; choice: "reload" | "keep" }
  /** The file changed on disk under a buffer with nothing unsaved in it: adopt it silently. */
  | { type: "externalUpdate"; id: string; content: string };

/** What the status bar and the save indicator read. See the note at the top of this file. */
export function saveStateOf(state: BuffersState): SaveState {
  if (state.phase === "saving") return "saving";
  if (state.phase === "error") return "error";
  return state.buffers.some((b) => b.path !== null && b.dirty) ? "unsaved" : "saved";
}

function withoutConflict({ conflict: _resolved, ...rest }: Buffer): Buffer {
  return rest;
}

function patch(
  state: BuffersState,
  id: string,
  change: (buffer: Buffer) => Buffer,
): readonly Buffer[] {
  return state.buffers.map((b) => (b.id === id ? change(b) : b));
}

export function buffersReducer(state: BuffersState, action: BuffersAction): BuffersState {
  const next = reduce(state, action);
  return next.buffers === state.buffers ? next : { ...next, revision: state.revision + 1 };
}

function reduce(state: BuffersState, action: BuffersAction): BuffersState {
  switch (action.type) {
    case "newScratch":
      return {
        ...state,
        buffers: [...state.buffers, action.buffer],
        activeBufferId: action.buffer.id,
      };

    case "opened": {
      const known = state.buffers.some((b) => b.id === action.buffer.id);
      return {
        ...state,
        buffers: known ? state.buffers : [...state.buffers, action.buffer],
        activeBufferId: action.buffer.id,
      };
    }

    case "focus":
      return { ...state, activeBufferId: action.id };

    case "close": {
      const buffers = state.buffers.filter((b) => b.id !== action.id);
      if (buffers.length === state.buffers.length) return state;
      return {
        ...state,
        buffers,
        activeBufferId:
          state.activeBufferId === action.id ? (buffers.at(-1)?.id ?? null) : state.activeBufferId,
      };
    }

    case "edit": {
      const target = state.buffers.find((b) => b.id === action.id);
      if (!target) return state;
      // Only a file can be unsaved: a dirty scratch would nag forever with nowhere to be written.
      const isFile = target.path !== null;
      const buffers = patch(state, action.id, (b) => ({ ...b, content: action.content, dirty: isFile }));
      // A keystroke outranks whatever the last write said: it is unsaved again either way, and a
      // save still in flight will not cover this edit. That also restarts the autosave delay.
      return { ...state, buffers, phase: isFile ? "idle" : state.phase };
    }

    case "setView":
      return { ...state, buffers: patch(state, action.id, (b) => ({ ...b, view: action.view })) };

    case "saveStarted":
      return { ...state, phase: "saving" };

    case "saveSkipped":
      // A failure nobody has acknowledged survives: there was nothing to write, so nothing fixed it.
      return { ...state, phase: state.phase === "error" ? "error" : "idle" };

    case "saveWritten":
      return {
        ...state,
        buffers: patch(state, action.id, (b) =>
          // Keystrokes that landed during the write stay dirty, for the next save.
          withoutConflict({ ...b, dirty: b.content !== action.written }),
        ),
      };

    case "conflict":
      return {
        ...state,
        buffers: patch(state, action.id, (b) => ({ ...b, conflict: action.disk })),
      };

    case "saveFinished":
      return { ...state, phase: action.failed ? "error" : "idle" };

    case "saveFailed":
      return { ...state, phase: "error" };

    case "savedAs":
      return {
        ...state,
        buffers: patch(state, action.id, (b) =>
          withoutConflict({
            ...b,
            id: action.nextId,
            path: action.path,
            name: action.name,
            dirty: false,
          }),
        ),
        activeBufferId:
          state.activeBufferId === action.id ? action.nextId : state.activeBufferId,
        phase: "idle",
      };

    case "conflictResolved": {
      const target = state.buffers.find((b) => b.id === action.id);
      const disk = target?.conflict;
      if (!target || !disk) return state;
      return {
        ...state,
        buffers: patch(state, action.id, (b) =>
          withoutConflict({
            ...b,
            content: action.choice === "reload" ? disk.content : b.content,
            dirty: false,
          }),
        ),
        phase: "idle",
      };
    }

    case "externalUpdate":
      return {
        ...state,
        buffers: patch(state, action.id, (b) => (b.dirty ? b : { ...b, content: action.content })),
      };
  }
}
