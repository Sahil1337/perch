"use client";

// The context menu's half of the editor: every item it offers, plus the selection flag that decides
// which of them are live. Each command reaches the view through a ref, so none of them is a reason
// to re-run the effect that built it.

import { selectAll, toggleComment } from "@codemirror/commands";
import type { EditorView } from "@codemirror/view";
import type { Dialect, Settings } from "@perch/protocol";
import * as React from "react";
import type { CursorPosition } from "../types";
import { formatDocument } from "./format-document";
import { statementAtCursor } from "./statements";

/** What a live view is allowed to reach back into React for. */
export type EditorBridge = {
  applyChange: (next: string) => void;
  dialect: Dialect;
  keywordCase: Settings["keywordCase"];
  run: (sql: string) => void;
  setCursor: (cursor: CursorPosition) => void;
};

export type EditorCommands = {
  copySelection: () => void;
  cutSelection: () => void;
  formatFromMenu: () => void;
  hasSelection: boolean;
  onContextMenuOpenChange: (open: boolean) => void;
  pasteClipboard: () => void;
  runSelectionText: () => void;
  runStatementAtCursor: () => void;
  runWholeDocument: () => void;
  selectAllFromMenu: () => void;
  toggleCommentFromMenu: () => void;
};

export function useEditorCommands(
  viewRef: React.RefObject<EditorView | null>,
  bridge: React.RefObject<EditorBridge>,
): EditorCommands {
  // Captured on open rather than read live, so "Run selection" cannot flicker if focus moves
  // while the menu is showing.
  const [hasSelection, setHasSelection] = React.useState(false);

  const onContextMenuOpenChange = React.useCallback(
    (open: boolean) => {
      if (!open) return;
      const selection = viewRef.current?.state.selection.main;
      setHasSelection(!!selection && selection.from !== selection.to);
    },
    [viewRef],
  );

  const runStatementAtCursor = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    const sqlText = statementAtCursor(doc, view.state.selection.main.head)?.sql;
    if (sqlText) bridge.current.run(sqlText);
  }, [bridge, viewRef]);

  const runSelectionText = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const sqlText = view.state.doc.sliceString(from, to).trim();
    if (sqlText) bridge.current.run(sqlText);
  }, [bridge, viewRef]);

  const runWholeDocument = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const all = view.state.doc.toString().trim();
    if (all) bridge.current.run(all);
  }, [bridge, viewRef]);

  const formatFromMenu = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    void formatDocument(view, bridge.current.dialect, bridge.current.keywordCase);
  }, [bridge, viewRef]);

  const toggleCommentFromMenu = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    toggleComment(view);
    view.focus();
  }, [viewRef]);

  const selectAllFromMenu = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    selectAll(view);
    view.focus();
  }, [viewRef]);

  const cutSelection = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    void (async () => {
      const text = view.state.doc.sliceString(from, to);
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        // No clipboard permission: leave the text in place rather than delete what the
        // clipboard never received.
        return;
      }
      view.dispatch({ changes: { from, insert: "", to } });
      view.focus();
    })();
  }, [viewRef]);

  const copySelection = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const text = view.state.doc.sliceString(from, to);
    void navigator.clipboard.writeText(text).catch(() => {
      // Same as cut: nothing to recover into without clipboard access.
    });
  }, [viewRef]);

  const pasteClipboard = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    void (async () => {
      let text: string;
      try {
        text = await navigator.clipboard.readText();
      } catch {
        return;
      }
      if (!text) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, insert: text, to },
        selection: { anchor: from + text.length },
      });
      view.focus();
    })();
  }, [viewRef]);

  return {
    copySelection,
    cutSelection,
    formatFromMenu,
    hasSelection,
    onContextMenuOpenChange,
    pasteClipboard,
    runSelectionText,
    runStatementAtCursor,
    runWholeDocument,
    selectAllFromMenu,
    toggleCommentFromMenu,
  };
}
