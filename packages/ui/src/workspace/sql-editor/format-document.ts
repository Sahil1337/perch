import type { EditorView } from "@codemirror/view";
import type { Dialect, Settings } from "@perch/protocol";
import { formatSql } from "@perch/sql";

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
export async function formatDocument(
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
