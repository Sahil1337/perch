import type { EditorView } from "@codemirror/view";
import type { Dialect, Settings } from "@perch/protocol";
import { formatSql } from "@perch/sql";
import { showFormatNotice } from "./format-notice";

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
 * Statements the parser cannot read come back as they were typed, which on screen is
 * indistinguishable from "already formatted" — so those are named in a notice under the editor
 * rather than passed over in silence.
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

  let result: Awaited<ReturnType<typeof formatSql>>;
  try {
    result = await formatSql(doc, { dialect, keywordCase });
  } catch {
    // formatSql catches parse failures per statement, so a throw here has nothing to recover
    // into: leave the document alone.
    return;
  }

  // Lines are read from the document as it stands now: formatting is about to renumber them.
  const notice = unformattedNotice(view, result.unformatted);
  const formatted = result.text;

  if (formatted !== doc) {
    view.dispatch({ changes: { from: 0, insert: formatted, to: doc.length }, scrollIntoView: true });
  }
  if (notice) showFormatNotice(view, notice);
  if (formatted === doc) return;

  const newDoc = view.state.doc;
  const line = newDoc.line(Math.min(lineNumber, newDoc.lines));
  const head = Math.min(line.from + column, line.to);
  view.dispatch({ selection: { anchor: head } });
}

/** How many statements to name before the list stops being useful. */
const MAX_LISTED_LINES = 3;

/** `null` when everything formatted. */
function unformattedNotice(view: EditorView, offsets: number[]): string | null {
  if (offsets.length === 0) return null;

  const lines = offsets.map((offset) => view.state.doc.lineAt(offset).number);
  const listed = lines.slice(0, MAX_LISTED_LINES).join(", ");
  const rest = lines.length - MAX_LISTED_LINES;

  return lines.length === 1
    ? `Couldn't format the statement on line ${listed} — unsupported syntax, left as written.`
    : `Couldn't format ${lines.length} statements (lines ${listed}${rest > 0 ? `, +${rest} more` : ""}) — unsupported syntax, left as written.`;
}
