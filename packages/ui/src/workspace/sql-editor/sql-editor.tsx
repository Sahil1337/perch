// The SQL editor, on CodeMirror 6. A plain textarea cannot put a squiggle on the character the
// server blamed, complete a column name, or answer "which statement is my cursor in" — the gesture
// this app is used through.
//
// Two rules shape everything below. The EditorView is created once per document and never recreated
// for a setting change — dialect, schema and gutter swap through Compartments, since rebuilding the
// view drops the cursor, scroll position and undo history. And nothing hardcodes a colour:
// highlighting maps to theme-token classes and the chrome reads `var(--color-*)`.

import { autocompletion } from "@codemirror/autocomplete";
import { sql } from "@codemirror/lang-sql";
import { setDiagnostics, type Diagnostic } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { highlightActiveLineGutter, lineNumbers, type EditorView } from "@codemirror/view";
import type { CompletionMode, Dialect, Settings } from "@perch/protocol";
import { splitStatements } from "@perch/sql";
import * as React from "react";
import { cn } from "../../lib/utils";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../../ui/context-menu";
import { useWorkspace } from "../context";
import { asyncData, type CursorPosition } from "../types";
import { hotkeyLabel } from "../use-hotkey";
import { completionNamespace, defaultSchemaName } from "./completion";
import { completionConf, createEditorView, gutterConf, languageConf } from "./create-view";
import { dialectFor } from "./dialect";
import { useEditorCommands, type EditorBridge } from "./editor-commands";
import {
  formatDocument,
  FORMAT_DOCUMENT_EVENT,
  type FormatDocumentEventDetail,
} from "./format-document";
import { smartCompletionSource } from "./smart-completion";
import { queryErrorDiagnostic } from "./statements";

// `Hotkey` descriptors rather than strings, so `hotkeyLabel` renders the platform's own glyphs.
const RUN_HOTKEY = { key: "Enter", mod: true } as const;
const RUN_ALL_HOTKEY = { key: "Enter", mod: true, shift: true } as const;
const FORMAT_HOTKEY = { key: "f", shift: true, alt: true } as const;
const TOGGLE_COMMENT_HOTKEY = { key: "/", mod: true } as const;

export function SqlEditor({
  fileId,
  value: controlledValue,
  onChange: controlledOnChange,
  onRunStatement,
  className,
  autoFocus = false,
  minimal = false,
}: {
  /** Reads and writes the contract's buffer for this file. Required unless `value` is given. */
  fileId?: string;
  /** Controlled mode, for text that is not a file — a notebook cell, a palette scratch buffer. */
  value?: string;
  /** Controlled mode: the next text on every edit, instead of `editBuffer(fileId, …)`. */
  onChange?: (value: string) => void;
  /** Mod-Enter / Mod-Shift-Enter target. Defaults to the contract's `run`. */
  onRunStatement?: (sql: string) => void;
  className?: string;
  autoFocus?: boolean;
  /** No gutter: for cells and previews, where line numbers are noise. */
  minimal?: boolean;
}): React.ReactElement {
  const { activeRun, connection, editBuffer, buffers, run, schema, setCursor, settings } =
    useWorkspace();

  const controlled = controlledValue !== undefined;
  const value = controlled
    ? controlledValue
    : (buffers.find((file) => file.id === fileId)?.content ?? "");

  const dialect: Dialect = connection?.dialect ?? "postgres";
  const schemaData = schema.status === "idle" || schema.status === "loading" ? undefined : schema.data;
  // "lower" is a deliberate floor, not a preference: the formatter defaults to "upper", so a
  // format fired before settings load would upper-case every keyword in the file.
  const keywordCase: Settings["keywordCase"] = asyncData(settings)?.keywordCase ?? "lower";
  // "smart" is the stored default, so a popup opened before settings load behaves the way it will
  // a moment later rather than briefly offering the whole dictionary.
  const completionMode: CompletionMode = asyncData(settings)?.completion ?? "smart";

  /* The view reads its callbacks through a ref, so a new closure on every render never costs a
     reconfiguration — and the keymap built at creation stays correct forever. */
  const bridge = React.useRef<EditorBridge>({
    applyChange: () => {},
    dialect,
    keywordCase,
    run: () => {},
    setCursor: () => {},
  });
  /* Refilled after the commit rather than in render: React may discard a render, and the keymap
     holds this ref for the life of the view — a callback from UI that never shipped would keep
     firing. */
  React.useEffect(() => {
    bridge.current = {
      applyChange: (next: string) => {
        if (controlled) controlledOnChange?.(next);
        else if (fileId) editBuffer(fileId, next);
      },
      dialect,
      keywordCase,
      run: (sql: string) => {
        if (onRunStatement) onRunStatement(sql);
        else void run(sql);
      },
      setCursor,
    };
  });

  const language = React.useMemo(
    () =>
      sql({
        defaultSchema: defaultSchemaName(schemaData, dialect),
        dialect: dialectFor(dialect),
        schema: completionNamespace(schemaData),
        upperCaseKeywords: false,
      }),
    [dialect, schemaData],
  );

  const completion = React.useMemo<Extension>(() => {
    if (completionMode === "off") return [];
    if (completionMode === "basic") return autocompletion({ icons: true });
    // `override` is the only way to drop lang-sql's own dictionary source: a language-data facet
    // value cannot be removed once the language provides it.
    return autocompletion({
      icons: true,
      override: [
        smartCompletionSource({
          defaultSchema: defaultSchemaName(schemaData, dialect),
          dialect,
          keywordCase,
          schema: schemaData,
        }),
      ],
    });
  }, [completionMode, dialect, keywordCase, schemaData]);

  const gutter = React.useMemo<Extension>(
    () => (minimal ? [] : [lineNumbers(), highlightActiveLineGutter()]),
    [minimal],
  );

  /**
   * The failing statement's squiggle. The run record names the failure only by omission: `results`
   * holds what completed, so the next index threw. Locating the run's SQL in the document covers
   * both a whole-file run and a Mod-Enter run, and an edit since simply stops matching.
   */
  const diagnostics = React.useMemo<readonly Diagnostic[]>(() => {
    const error = activeRun?.error;
    if (!error || (error.position === undefined && error.line === undefined)) return [];
    const runOffset = value.indexOf(activeRun.sql);
    if (runOffset === -1) return [];
    const statements = splitStatements(activeRun.sql);
    // The failing statement never emits a `result` event, so the count of completed results is its
    // index. This is the server's own formula, not an inference.
    const failed = statements[activeRun.results?.length ?? 0] ?? statements[0];
    if (!failed) return [];
    const diagnostic = queryErrorDiagnostic(error, runOffset + failed.offset, value);
    return diagnostic ? [diagnostic] : [];
  }, [activeRun, value]);

  const hostRef = React.useRef<HTMLDivElement>(null);
  const viewRef = React.useRef<EditorView | null>(null);
  const reported = React.useRef<CursorPosition>({ col: 1, line: 1 });
  const initial = React.useRef({ autoFocus, completion, gutter, language, minimal, value });
  /* After the commit, and declared above the effect that builds the view, so the view is always
     created from props that actually rendered. */
  React.useEffect(() => {
    initial.current = { autoFocus, completion, gutter, language, minimal, value };
  });

  const commands = useEditorCommands(viewRef, bridge);

  /* Keyed on the document's identity only: setting changes reconfigure a compartment below,
     because tearing the view down would drop the cursor, scroll offset and undo history. */
  React.useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    const view = createEditorView({ bridge, initial: initial.current, parent, reported });
    viewRef.current = view;
    if (initial.current.autoFocus) view.focus();

    return () => {
      viewRef.current = null;
      view.destroy();
    };
  }, [fileId]);

  /* Targets a buffer by id, since several panes in a split can each hold a live editor.
     `bridge.current` is read at fire time, so this needs no settings dependencies. */
  React.useEffect(() => {
    if (!fileId) return;
    const onFormat = (event: Event): void => {
      const detail = (event as CustomEvent<FormatDocumentEventDetail>).detail;
      const view = viewRef.current;
      if (!view || detail?.bufferId !== fileId) return;
      void formatDocument(view, bridge.current.dialect, bridge.current.keywordCase);
    };
    window.addEventListener(FORMAT_DOCUMENT_EVENT, onFormat);
    return () => window.removeEventListener(FORMAT_DOCUMENT_EVENT, onFormat);
  }, [fileId]);

  /* Schema or dialect changed: swap the language in place. */
  React.useEffect(() => {
    viewRef.current?.dispatch({ effects: languageConf.reconfigure(language) });
  }, [language]);

  React.useEffect(() => {
    viewRef.current?.dispatch({ effects: gutterConf.reconfigure(gutter) });
  }, [gutter]);

  React.useEffect(() => {
    viewRef.current?.dispatch({ effects: completionConf.reconfigure(completion) });
  }, [completion]);

  /* Adopt changes made to the buffer from outside (a save round-trip, a palette insertion). The
     equality check is what stops this from fighting the updateListener on every keystroke. */
  React.useEffect(() => {
    const view = viewRef.current;
    if (!view || value === view.state.doc.toString()) return;
    view.dispatch({ changes: { from: 0, insert: value, to: view.state.doc.length } });
  }, [value]);

  React.useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const length = view.state.doc.length;
    const inRange = diagnostics
      .filter((diagnostic) => diagnostic.from <= length)
      .map((diagnostic) => ({ ...diagnostic, to: Math.min(diagnostic.to, length) }));
    view.dispatch(setDiagnostics(view.state, inRange));
  }, [diagnostics]);

  return (
    <ContextMenu onOpenChange={commands.onContextMenuOpenChange}>
      <ContextMenuTrigger
        className={cn(
          // The CodeMirror theme paints `.cm-editor` with `--color-background` (see
          // `editorThemeBase`), so the host itself stays unstyled beyond its box.
          "block w-full",
          // A pane editor fills its pane and scrolls inside it; a cell editor grows with its text,
          // so a notebook card is exactly as tall as the query in it.
          minimal ? "overflow-visible" : "h-full min-h-0 overflow-hidden",
          className,
        )}
        ref={hostRef}
      />
      <ContextMenuPopup>
        <ContextMenuItem onClick={commands.runStatementAtCursor}>
          Run statement
          <ContextMenuShortcut>{hotkeyLabel(RUN_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!commands.hasSelection} onClick={commands.runSelectionText}>
          Run selection
          <ContextMenuShortcut>{hotkeyLabel(RUN_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={commands.runWholeDocument}>
          Run all
          <ContextMenuShortcut>{hotkeyLabel(RUN_ALL_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={commands.visualiseFromMenu}>Visualise query</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={commands.formatFromMenu}>
          Format document
          <ContextMenuShortcut>{hotkeyLabel(FORMAT_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={commands.toggleCommentFromMenu}>
          Toggle comment
          <ContextMenuShortcut>{hotkeyLabel(TOGGLE_COMMENT_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!commands.hasSelection} onClick={commands.cutSelection}>
          Cut
        </ContextMenuItem>
        <ContextMenuItem disabled={!commands.hasSelection} onClick={commands.copySelection}>
          Copy
        </ContextMenuItem>
        <ContextMenuItem onClick={commands.pasteClipboard}>Paste</ContextMenuItem>
        <ContextMenuItem onClick={commands.selectAllFromMenu}>Select all</ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
