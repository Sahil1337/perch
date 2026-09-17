// Where one statement ends and the next begins, and where in the document the server's error lands.
// Both answers come from the splitter the server itself runs, so the editor and the backend cannot
// disagree about what a statement is.

import type { Diagnostic } from "@codemirror/lint";
import type { QueryError } from "@perch/protocol";
import { splitStatements, type SplitStatement } from "@perch/sql";

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

const WORD_CHAR = /[A-Za-z0-9_$]/;

/** End of the identifier at `from`, so the squiggle covers a token rather than one character. */
function tokenEnd(doc: string, from: number): number {
  let end = from;
  while (end < doc.length && WORD_CHAR.test(doc[end] ?? "")) end++;
  return end > from ? end : Math.min(from + 1, doc.length);
}

/**
 * A 1-based line/column into a character offset, clamped to the document.
 *
 * Two callers with the same arithmetic: the palette turning `cursor` into an offset for
 * `statementAtCursor`, and `queryErrorDiagnostic` turning a driver's reported line into a document
 * position. `from` is where line 1 starts — 0 for the document, a statement's offset for an error
 * reported against that statement.
 */
export function offsetOfPosition(doc: string, line: number, col = 1, from = 0): number {
  let at = from;
  for (let seen = 1; seen < line && at < doc.length; seen++) {
    const next = doc.indexOf("\n", at);
    if (next === -1) break;
    at = next + 1;
  }
  return Math.min(doc.length, at + Math.max(0, col - 1));
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
        ? offsetOfPosition(doc, error.line, 1, statementOffset)
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
