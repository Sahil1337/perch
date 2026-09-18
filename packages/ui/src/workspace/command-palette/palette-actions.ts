// The commands the palette ships with, and the keys that also reach them.
//
// A hook rather than a constant, because every action closes over something from the workspace
// contract — but it takes exactly what it uses, so the dependency list is the six things that
// actually change rather than the twenty the palette happens to destructure.

import {
  FootprintsIcon,
  PanelBottomIcon,
  PanelLeftIcon,
  PlayIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  WandSparklesIcon,
  WaypointsIcon,
} from "lucide-react";
import * as React from "react";
import { requestQueryWalk } from "../query-walk";
import { requestSchemaDiagram } from "../schema-diagram";
import {
  FORMAT_DOCUMENT_EVENT,
  offsetOfPosition,
  statementAtCursor,
  type FormatDocumentEventDetail,
} from "../sql-editor";
import type { Buffer, CursorPosition, PanelState } from "../types";
import { hotkeyLabel } from "../use-hotkey";
import type { PaletteAction } from "./palette-items";

export const NEW_FILE = { key: "n", mod: true } as const;
export const SAVE = { key: "s", mod: true } as const;
export const RUN = { key: "Enter", mod: true } as const;
export const TOGGLE_RESULTS = { key: "j", mod: true } as const;
export const TOGGLE_SIDEBAR = { key: "b", mod: true } as const;
// No `mod`: the editor's own binding is a bare Shift-Alt-F.
export const FORMAT_DOCUMENT = { key: "f", shift: true, alt: true } as const;

/** Exactly what the built-in actions read from the workspace. */
export type BuiltinActionDeps = {
  activeBuffer: Buffer | undefined;
  activeBufferId: string | null;
  cursor: CursorPosition;
  panels: Pick<PanelState, "outputOpen" | "sidebarOpen">;
  newScratch: () => string;
  save: () => Promise<void>;
  run: (sql?: string) => Promise<string | undefined>;
  refreshSchema: () => Promise<void>;
  togglePanel: (key: "sidebarOpen" | "outputOpen" | "paletteOpen") => void;
};

export function useBuiltinActions(
  deps: BuiltinActionDeps,
  close: () => void,
): readonly PaletteAction[] {
  const {
    activeBuffer,
    activeBufferId,
    cursor,
    panels,
    newScratch,
    save,
    run,
    refreshSchema,
    togglePanel,
  } = deps;

  return React.useMemo(
    () => [
      {
        label: "New file",
        shortcut: hotkeyLabel(NEW_FILE),
        icon: PlusIcon,
        onSelect: () => {
          newScratch();
          close();
        },
      },
      {
        label: "Save",
        shortcut: hotkeyLabel(SAVE),
        icon: SaveIcon,
        onSelect: () => {
          void save();
          close();
        },
      },
      {
        label: "Run",
        shortcut: hotkeyLabel(RUN),
        icon: PlayIcon,
        onSelect: () => {
          void run();
          close();
        },
      },
      {
        label: "Format document",
        shortcut: hotkeyLabel(FORMAT_DOCUMENT),
        icon: WandSparklesIcon,
        onSelect: () => {
          // The key is bound inside CodeMirror, which needs a keydown reaching the focused
          // editor; this dispatches the same action for the active buffer, and no-ops when
          // nothing is open.
          if (activeBufferId) {
            window.dispatchEvent(
              new CustomEvent<FormatDocumentEventDetail>(FORMAT_DOCUMENT_EVENT, {
                detail: { bufferId: activeBufferId },
              }),
            );
          }
          close();
        },
      },
      {
        label: "Refresh schema",
        hint: "bypasses the server cache",
        icon: RefreshCwIcon,
        onSelect: () => {
          void refreshSchema();
          close();
        },
      },
      {
        label: "Visualise relationships",
        hint: "Tables and the keys that join them",
        icon: WaypointsIcon,
        onSelect: () => {
          requestSchemaDiagram();
          close();
        },
      },
      {
        label: "Visualise query",
        hint: "Walk the statement at the cursor, step by step",
        icon: FootprintsIcon,
        onSelect: () => {
          if (activeBuffer) {
            const at = offsetOfPosition(activeBuffer.content, cursor.line, cursor.col);
            const sql = statementAtCursor(activeBuffer.content, at)?.sql;
            if (sql) requestQueryWalk(sql);
          }
          close();
        },
      },
      {
        label: panels.outputOpen ? "Hide results" : "Show results",
        shortcut: hotkeyLabel(TOGGLE_RESULTS),
        icon: PanelBottomIcon,
        onSelect: () => {
          togglePanel("outputOpen");
          close();
        },
      },
      {
        label: panels.sidebarOpen ? "Hide sidebar" : "Show sidebar",
        shortcut: hotkeyLabel(TOGGLE_SIDEBAR),
        icon: PanelLeftIcon,
        onSelect: () => {
          togglePanel("sidebarOpen");
          close();
        },
      },
    ],
    [
      activeBuffer,
      activeBufferId,
      close,
      cursor,
      newScratch,
      panels.outputOpen,
      panels.sidebarOpen,
      refreshSchema,
      run,
      save,
      togglePanel,
    ],
  );
}
