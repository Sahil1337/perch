"use client";

// The SQL editor, on CodeMirror 6. A plain textarea cannot put a squiggle on the character the
// server blamed, complete a column name, or answer "which statement is my cursor in" — the gesture
// this app is used through. The regex tokeniser survives only as `highlightSql`, for read-only
// previews where a full editor per row would be absurd.
//
// Two rules shape everything below. The EditorView is created once per document and never recreated
// for a setting change — dialect, schema and gutter swap through Compartments, since rebuilding the
// view drops the cursor, scroll position and undo history. And nothing hardcodes a colour:
// highlighting maps to theme-token classes and the chrome reads `var(--color-*)`.

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  type Completion,
} from "@codemirror/autocomplete";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  selectAll,
  toggleComment,
} from "@codemirror/commands";
import { MySQL, PostgreSQL, sql, type SQLNamespace } from "@codemirror/lang-sql";
import {
  bracketMatching,
  HighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from "@codemirror/language";
import { lintKeymap, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { DatabaseSchema, Dialect, QueryError, Settings } from "@perch/protocol";
import { formatSql, splitStatements, type SplitStatement } from "@perch/sql";
import * as React from "react";
import { cn } from "../lib/utils";
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { useWorkspace } from "./context";
import { asyncData, type CursorPosition } from "./types";
import { hotkeyLabel } from "./use-hotkey";

/* ------------------------------------------------------- read-only preview */

const KEYWORDS: ReadonlySet<string> = new Set(
  (
    "select from where group by order limit offset insert into values update set delete " +
    "create table view index drop alter add column join inner left right full outer on " +
    "as and or not null is in like ilike between case when then else end distinct union " +
    "all having with asc desc interval now current_date primary key foreign references " +
    "default constraint returning exists any some cast true false begin commit rollback " +
    "explain analyze using natural cross over partition window filter"
  ).split(" "),
);

const TOKEN_RE =
  /(--[^\n]*)|(\/\*[\s\S]*?\*\/)|('(?:[^']|'')*')|("(?:[^"]|"")*")|(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_$]*)/g;

/**
 * Tokenises SQL into themed spans for surfaces that only display it. Not a parser: it shares the
 * editor's palette, not its accuracy. Anything editable should mount a `SqlEditor`.
 */
export function highlightSql(sql: string): React.ReactNode {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;

  TOKEN_RE.lastIndex = 0;
  let match = TOKEN_RE.exec(sql);
  while (match !== null) {
    if (match.index > last) out.push(sql.slice(last, match.index));

    const [text, lineComment, blockComment, single, double, num, word] = match;
    let className: string | null = null;

    if (lineComment || blockComment) className = "text-muted-foreground";
    else if (single || double) className = "text-success-foreground";
    else if (num) className = "text-warning-foreground";
    else if (word) {
      if (KEYWORDS.has(word.toLowerCase())) className = "text-info-foreground";
      else if (sql.slice(match.index + word.length).trimStart().startsWith("("))
        className = "text-foreground/80";
    }

    out.push(
      className ? (
        <span className={className} key={`t${key++}`}>
          {text}
        </span>
      ) : (
        text
      ),
    );

    last = match.index + text.length;
    match = TOKEN_RE.exec(sql);
  }

  if (last < sql.length) out.push(sql.slice(last));
  return out;
}

/* -------------------------------------------------------------- statements */

/**
 * The statement the cursor is in, for Mod-Enter. Uses the same splitter the server runs. A cursor
 * in the blank space after a statement belongs to it; one before the first belongs to the first.
 */
export function statementAtCursor(doc: string, pos: number): SplitStatement | undefined {
  let previous: SplitStatement | undefined;
  for (const statement of splitStatements(doc)) {
    if (pos < statement.offset) return previous ?? statement;
    if (pos <= statement.offset + statement.sql.length) return statement;
    previous = statement;
  }
  return previous;
}

/* ------------------------------------------------------------- diagnostics */

const WORD_CHAR = /[A-Za-z0-9_$]/;

/** End of the identifier at `from`, so the squiggle covers a token rather than one character. */
function tokenEnd(doc: string, from: number): number {
  let end = from;
  while (end < doc.length && WORD_CHAR.test(doc[end] ?? "")) end++;
  return end > from ? end : Math.min(from + 1, doc.length);
}

/** Offset of the `line`-th 1-based line of the statement starting at `statementOffset`. */
function lineStart(doc: string, statementOffset: number, line: number): number {
  let at = statementOffset;
  for (let seen = 1; seen < line; seen++) {
    const next = doc.indexOf("\n", at);
    if (next === -1) return at;
    at = next + 1;
  }
  return at;
}

/**
 * A server error, placed on the character that caused it. `QueryError.position` is an offset into
 * the *statement*, so `statementOffset` is what turns it into a document position. `line` is the
 * fallback for drivers that report one without an offset; with neither, render the message elsewhere.
 */
export function queryErrorDiagnostic(
  error: QueryError,
  statementOffset: number,
  doc: string,
): Diagnostic | null {
  const from =
    error.position !== undefined
      ? statementOffset + error.position
      : error.line !== undefined
        ? lineStart(doc, statementOffset, error.line)
        : null;
  if (from === null) return null;

  const at = Math.min(Math.max(from, 0), doc.length);
  return {
    from: at,
    message: error.hint ? `${error.message}\n\n${error.hint}` : error.message,
    severity: "error",
    source: error.code ? `server · ${error.code}` : "server",
    to: tokenEnd(doc, at),
  };
}

/* ---------------------------------------------------------------- language */

/**
 * The contract's schema, as completion data. `{ "<schema>.<table>": columns }` is the shape `sql()`
 * wants for a qualified namespace. The driver type is the `detail` line, and primary keys get a
 * marker and a distinct icon so the join column is visible at a glance.
 */
function completionNamespace(schema: DatabaseSchema | undefined): SQLNamespace | undefined {
  if (!schema) return undefined;
  const namespace: Record<string, readonly Completion[]> = {};
  for (const entry of schema.schemas) {
    for (const table of entry.tables) {
      namespace[`${entry.name}.${table.name}`] = table.columns.map((column) => ({
        detail: column.pk ? `${column.type} · pk` : column.type,
        label: column.name,
        type: column.pk ? "constant" : "property",
      }));
    }
  }
  return namespace as SQLNamespace;
}

/** The schema whose tables can be typed unqualified: `public` on PostgreSQL, the database on MySQL. */
function defaultSchemaName(schema: DatabaseSchema | undefined, dialect: Dialect): string | undefined {
  if (!schema) return undefined;
  const names = schema.schemas.map((entry) => entry.name);
  const preferred = dialect === "mysql" ? schema.database : "public";
  return names.includes(preferred) ? preferred : names[0];
}

/* ------------------------------------------------------------------ theme */

/** Lezer tags → theme-token classes, so `highlightSql` and the editor cannot drift apart. */
const sqlHighlighting = HighlightStyle.define([
  { class: "text-info-foreground", tag: tags.keyword },
  { class: "text-success-foreground", tag: [tags.string, tags.special(tags.string)] },
  { class: "text-warning-foreground", tag: [tags.number, tags.bool, tags.null] },
  { class: "text-muted-foreground italic", tag: [tags.lineComment, tags.blockComment] },
  { class: "text-foreground/80", tag: [tags.typeName, tags.standard(tags.name)] },
  { class: "text-muted-foreground", tag: [tags.operator, tags.punctuation] },
]);

/**
 * CodeMirror's chrome. A style object is legitimate here because the library renders its own DOM and
 * takes one, so every value is still a theme token. The active line must be translucent: CodeMirror
 * paints the selection in a layer behind the content, and an opaque background would hide it.
 */
/**
 * Height is the one thing a pane editor and a cell editor disagree about: a pane fills its space and
 * scrolls inside it, a cell grows with its content. CodeMirror does the latter by not being told a height.
 */
const paneHeight = EditorView.theme({ "&": { height: "100%" } });
const cellHeight = EditorView.theme({
  "&": { height: "auto" },
  ".cm-scroller": { overflow: "visible" },
});

const editorThemeBase = EditorView.theme({
  "&": {
    backgroundColor: "var(--color-background)",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-mono)",
    fontSize: "0.8125rem",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "inherit", lineHeight: "1.6875", overflow: "auto" },
  ".cm-content": { caretColor: "var(--color-foreground)", padding: "0.5rem 0" },
  ".cm-line": { padding: "0 0.75rem" },
  ".cm-cursor, .cm-dropCursor": {
    borderLeftColor: "var(--color-foreground)",
    borderLeftWidth: "2px",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
    backgroundColor: "color-mix(in oklab, var(--color-info) 30%, transparent)",
  },
  ".cm-activeLine": {
    backgroundColor: "color-mix(in oklab, var(--color-accent) 55%, transparent)",
  },
  ".cm-selectionMatch": {
    backgroundColor: "color-mix(in oklab, var(--color-warning) 22%, transparent)",
  },
  "&.cm-focused .cm-matchingBracket, .cm-matchingBracket": {
    backgroundColor: "var(--color-muted)",
    outline: "1px solid var(--color-border)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--color-background)",
    borderRight: "1px solid var(--color-border)",
    color: "var(--color-muted-foreground)",
    fontVariantNumeric: "tabular-nums",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "color-mix(in oklab, var(--color-accent) 55%, transparent)",
    color: "var(--color-foreground)",
  },
  ".cm-lineNumbers .cm-gutterElement": { minWidth: "2.5rem", padding: "0 0.5rem 0 0.75rem" },
  // CodeMirror's default squiggle is an inlined SVG in a fixed red; an underline in the
  // destructive token is the same signal and follows the theme.
  ".cm-lintRange-error": {
    backgroundImage: "none",
    textDecoration: "underline wavy var(--color-destructive)",
    textUnderlineOffset: "0.2rem",
  },
  ".cm-tooltip": {
    backgroundColor: "var(--color-popover)",
    border: "1px solid var(--color-border)",
    borderRadius: "var(--radius-md)",
    color: "var(--color-popover-foreground)",
    fontFamily: "var(--font-sans)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--font-mono)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": { padding: "0.125rem 0.5rem" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    backgroundColor: "var(--color-accent)",
    color: "var(--color-accent-foreground)",
  },
  ".cm-completionDetail": {
    color: "var(--color-muted-foreground)",
    fontStyle: "normal",
    marginLeft: "0.5rem",
  },
  ".cm-diagnostic-error": { borderLeft: "3px solid var(--color-destructive)" },
  ".cm-panels": {
    backgroundColor: "var(--color-sidebar)",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-sans)",
  },
});

/* ----------------------------------------------------------------- format */

/**
 * "Format document" fires this on `window`, scoped to the buffer it means. A DOM event rather than a
 * `WorkspaceApi` method because formatting belongs to an editor instance, not to the workspace —
 * several panes can hold live editors at once, and the contract has no notion of a focused pane.
 */
export const FORMAT_DOCUMENT_EVENT = "perch:format";

/** `FORMAT_DOCUMENT_EVENT`'s payload: which buffer should format itself. */
export type FormatDocumentEventDetail = { bufferId: string };

/**
 * Formats the whole document via `formatSql`, then restores the cursor.
 *
 * One whole-document replacement, since `formatSql` already did the per-statement work. CodeMirror
 * cannot map a point selection through a replace that spans it — the position collapses to one edge,
 * reading as "cursor jumped to the top of the file" — so the line and column are recorded first and
 * reapplied afterwards, clamped to the reformatted document.
 */
async function formatDocument(
  view: EditorView,
  dialect: Dialect,
  keywordCase: Settings["keywordCase"],
): Promise<void> {
  const doc = view.state.doc.toString();
  const headBefore = view.state.selection.main.head;
  const lineBefore = view.state.doc.lineAt(headBefore);
  const lineNumber = lineBefore.number;
  const column = headBefore - lineBefore.from;

  let formatted: string;
  try {
    formatted = await formatSql(doc, { dialect, keywordCase });
  } catch {
    // formatSql catches parse failures per statement, so a throw here has nothing to recover
    // into: leave the document alone.
    return;
  }
  if (formatted === doc) return;

  view.dispatch({ changes: { from: 0, insert: formatted, to: doc.length }, scrollIntoView: true });

  const newDoc = view.state.doc;
  const line = newDoc.line(Math.min(lineNumber, newDoc.lines));
  const head = Math.min(line.from + column, line.to);
  view.dispatch({ selection: { anchor: head } });
}

/* ----------------------------------------------------------------- editor */

// Compartments hold no state of their own — they are keys into a state's configuration — so one
// set at module scope serves every mounted editor without them interfering.
const languageConf = new Compartment();
const gutterConf = new Compartment();

// `Hotkey` descriptors rather than strings, so `hotkeyLabel` renders the platform's own glyphs.
const RUN_HOTKEY = { key: "Enter", mod: true } as const;
const RUN_ALL_HOTKEY = { key: "Enter", mod: true, shift: true } as const;
const FORMAT_HOTKEY = { key: "f", shift: true, alt: true } as const;
const TOGGLE_COMMENT_HOTKEY = { key: "/", mod: true } as const;

type EditorBridge = {
  applyChange: (next: string) => void;
  dialect: Dialect;
  keywordCase: Settings["keywordCase"];
  run: (sql: string) => void;
  setCursor: (cursor: CursorPosition) => void;
};

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

  /* The view reads its callbacks through a ref, so a new closure on every render never costs a
     reconfiguration — and the keymap built at creation stays correct forever. */
  const bridge = React.useRef<EditorBridge>({
    applyChange: () => {},
    dialect,
    keywordCase,
    run: () => {},
    setCursor: () => {},
  });
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

  const language = React.useMemo(
    () =>
      sql({
        defaultSchema: defaultSchemaName(schemaData, dialect),
        dialect: dialect === "mysql" ? MySQL : PostgreSQL,
        schema: completionNamespace(schemaData),
        upperCaseKeywords: false,
      }),
    [dialect, schemaData],
  );

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
  const initial = React.useRef({ autoFocus, gutter, language, minimal, value });
  initial.current = { autoFocus, gutter, language, minimal, value };

  /* -------------------------------------------------------- context menu */

  // Captured on open rather than read live, so "Run selection" cannot flicker if focus moves
  // while the menu is showing.
  const [hasSelection, setHasSelection] = React.useState(false);

  const onContextMenuOpenChange = React.useCallback((open: boolean) => {
    if (!open) return;
    const selection = viewRef.current?.state.selection.main;
    setHasSelection(!!selection && selection.from !== selection.to);
  }, []);

  const runStatementAtCursor = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const doc = view.state.doc.toString();
    const sqlText = statementAtCursor(doc, view.state.selection.main.head)?.sql;
    if (sqlText) bridge.current.run(sqlText);
  }, []);

  const runSelectionText = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    const sqlText = view.state.doc.sliceString(from, to).trim();
    if (sqlText) bridge.current.run(sqlText);
  }, []);

  const runWholeDocument = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const all = view.state.doc.toString().trim();
    if (all) bridge.current.run(all);
  }, []);

  const formatFromMenu = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    void formatDocument(view, bridge.current.dialect, bridge.current.keywordCase);
  }, []);

  const toggleCommentFromMenu = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    toggleComment(view);
    view.focus();
  }, []);

  const selectAllFromMenu = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    selectAll(view);
    view.focus();
  }, []);

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
  }, []);

  const copySelection = React.useCallback(() => {
    const view = viewRef.current;
    if (!view) return;
    const { from, to } = view.state.selection.main;
    if (from === to) return;
    const text = view.state.doc.sliceString(from, to);
    void navigator.clipboard.writeText(text).catch(() => {
      // Same as cut: nothing to recover into without clipboard access.
    });
  }, []);

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
  }, []);

  /* Keyed on the document's identity only: setting changes reconfigure a compartment below,
     because tearing the view down would drop the cursor, scroll offset and undo history. */
  React.useEffect(() => {
    const parent = hostRef.current;
    if (!parent) return;

    const runInEditor = (view: EditorView, whole: boolean): boolean => {
      const doc = view.state.doc.toString();
      if (whole) {
        const all = doc.trim();
        if (all) bridge.current.run(all);
        return true;
      }
      const { from, to } = view.state.selection.main;
      const selected = doc.slice(from, to).trim();
      const sqlText = selected || statementAtCursor(doc, from)?.sql;
      if (sqlText) bridge.current.run(sqlText);
      return true;
    };

    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: initial.current.value,
        extensions: [
          gutterConf.of(initial.current.gutter),
          languageConf.of(initial.current.language),
          // Ahead of defaultKeymap, which binds Mod-Enter to "insert blank line".
          Prec.highest(
            keymap.of([
              { key: "Mod-Enter", preventDefault: true, run: (view) => runInEditor(view, false) },
              {
                key: "Mod-Shift-Enter",
                preventDefault: true,
                run: (view) => runInEditor(view, true),
              },
              {
                key: "Shift-Alt-f",
                preventDefault: true,
                run: (view) => {
                  void formatDocument(view, bridge.current.dialect, bridge.current.keywordCase);
                  return true;
                },
              },
            ]),
          ),
          history(),
          drawSelection(),
          dropCursor(),
          rectangularSelection(),
          crosshairCursor(),
          highlightSpecialChars(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          indentOnInput(),
          indentUnit.of("  "),
          bracketMatching(),
          closeBrackets(),
          autocompletion({ icons: false }),
          syntaxHighlighting(sqlHighlighting),
          editorThemeBase,
          initial.current.minimal ? cellHeight : paneHeight,
          EditorState.allowMultipleSelections.of(true),
          // `indentWithTab` traps Tab, which is why it goes last and why defaultKeymap's
          // Ctrl-m / Shift-Alt-m (tab-focus mode) is left bound: that is the way back out.
          keymap.of([
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...completionKeymap,
            ...lintKeymap,
            indentWithTab,
          ]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) bridge.current.applyChange(update.state.doc.toString());
            if (!update.docChanged && !update.selectionSet) return;
            const head = update.state.selection.main.head;
            const line = update.state.doc.lineAt(head);
            const next = { col: head - line.from + 1, line: line.number };
            if (next.col === reported.current.col && next.line === reported.current.line) return;
            reported.current = next;
            bridge.current.setCursor(next);
          }),
        ],
      }),
    });

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
    <ContextMenu onOpenChange={onContextMenuOpenChange}>
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
        <ContextMenuItem onClick={runStatementAtCursor}>
          Run statement
          <ContextMenuShortcut>{hotkeyLabel(RUN_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onClick={runSelectionText}>
          Run selection
          <ContextMenuShortcut>{hotkeyLabel(RUN_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={runWholeDocument}>
          Run all
          <ContextMenuShortcut>{hotkeyLabel(RUN_ALL_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={formatFromMenu}>
          Format document
          <ContextMenuShortcut>{hotkeyLabel(FORMAT_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem onClick={toggleCommentFromMenu}>
          Toggle comment
          <ContextMenuShortcut>{hotkeyLabel(TOGGLE_COMMENT_HOTKEY)}</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={!hasSelection} onClick={cutSelection}>
          Cut
        </ContextMenuItem>
        <ContextMenuItem disabled={!hasSelection} onClick={copySelection}>
          Copy
        </ContextMenuItem>
        <ContextMenuItem onClick={pasteClipboard}>Paste</ContextMenuItem>
        <ContextMenuItem onClick={selectAllFromMenu}>Select all</ContextMenuItem>
      </ContextMenuPopup>
    </ContextMenu>
  );
}
