"use client";

// The prose the reader wrote around their query, kept where it can be found and out of where it was
// in the way.
//
// An exercise question written as a five-line `--` header is part of the statement's text, so before
// this it was the first thing in every pane that echoed the query and the SQL itself was pushed off
// the bottom. The walk now strips the comments before it parses anything, which is why the rest of
// this screen is comment-free; this tab is where they go instead.
//
// The distinction that matters is WHERE the comment sat. A PREAMBLE — nothing of the query survives
// above it — is the question, and it belongs here and nowhere else: rendering three lines of prompt
// next to the SELECT station would put back the wall of text the strip removed. An INTERIOR comment
// is a remark about the clause it sits on (`-- one per student`), so it also gets a single muted
// line under the narrator's sentence while that clause is the station being walked.
//
// Consecutive `--` lines are grouped into one paragraph, because that is how a multi-line prompt is
// written; the group keeps the line number it started on, so the reader can find it in the editor.

import type { SqlComment } from "@perch/sql";
import type * as React from "react";
import type { Range } from "./clauses";

/** A comment nothing of the query precedes: the author's question, not a remark about a clause. */
function isPreamble(comment: SqlComment): boolean {
  return comment.anchor === 0;
}

/** A run of `--` lines read as one paragraph, starting at `line`. */
type Note = {
  readonly line: number;
  readonly text: string;
  readonly preamble: boolean;
};

/**
 * Comments in source order, with adjacent `--` lines merged.
 *
 * Only line comments merge, and only when the next one is on the very next line and sits on the same
 * side of the query's first character — two remarks separated by a clause are two remarks, and a
 * block comment is already a paragraph of its own.
 */
function group(comments: readonly SqlComment[]): Note[] {
  const out: Note[] = [];
  let last: SqlComment | null = null;
  for (const comment of comments) {
    const preamble = isPreamble(comment);
    const runs =
      last !== null &&
      last.kind === "line" &&
      comment.kind === "line" &&
      comment.line === last.line + 1 &&
      isPreamble(last) === preamble;
    const previous = out[out.length - 1];
    if (runs && previous !== undefined) {
      out[out.length - 1] = { ...previous, text: `${previous.text} ${comment.text}`.trim() };
    } else {
      out.push({ line: comment.line, text: comment.text, preamble });
    }
    last = comment;
  }
  return out.filter((note) => note.text !== "");
}

/**
 * How many notes the tab has to offer: paragraphs, not comments.
 *
 * A four-line `--` question is one note, and that is the number the tab should carry — a `Notes · 4`
 * beside a panel showing one paragraph is a count of something the reader cannot see. It is also
 * what decides whether the tab is enabled at all, so the tab is live exactly when the panel has
 * something in it: a statement whose only comment is an empty `--` has no notes and no tab.
 */
export function countNotes(comments: readonly SqlComment[]): number {
  return group(comments).length;
}

export function NotesPanel({ comments }: { comments: readonly SqlComment[] }): React.ReactElement {
  const notes = group(comments);
  const above = notes.filter((note) => note.preamble);
  const inside = notes.filter((note) => !note.preamble);
  return (
    <div className="flex flex-col gap-4">
      {above.length > 0 && <Group notes={above} title="Above the query" />}
      {inside.length > 0 && <Group notes={inside} title="In the query" />}
    </div>
  );
}

function Group({ title, notes }: { title: string; notes: readonly Note[] }): React.ReactElement {
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs">{title}</h3>
      {notes.map((note) => (
        <div className="flex min-w-0 gap-2" key={`${note.line}:${note.text}`}>
          {/* The line number is the way back to the comment in the editor, so it is monospaced and
              quiet — a gutter, not a label. */}
          <span className="shrink-0 font-mono text-muted-foreground/70 text-xs leading-5 tabular-nums">
            {note.line}
          </span>
          <p className="min-w-0 text-foreground text-sm leading-5">{note.text}</p>
        </div>
      ))}
    </section>
  );
}

/**
 * The interior comments that annotate the station being walked, as ONE line.
 *
 * Under the narrator's sentence, where a remark about this clause is worth a glance and a paragraph
 * would be the old problem again — so several notes are joined rather than stacked, and the line
 * truncates rather than growing. The full text is a hover away, and all of it is in the Notes tab.
 */
export function StationNote({
  comments,
  range,
}: {
  comments: readonly SqlComment[];
  /** The station's clause, in the same text the comment anchors index; null when it has none. */
  range: Range | null;
}): React.ReactElement | null {
  if (range === null) return null;
  const here = comments.filter(
    (comment) =>
      !isPreamble(comment) &&
      comment.text !== "" &&
      comment.anchor >= range.from &&
      comment.anchor <= range.to,
  );
  if (here.length === 0) return null;
  const text = here.map((comment) => comment.text).join(" · ");
  return (
    <p className="mt-1.5 truncate text-muted-foreground text-xs" title={text}>
      You noted: {text}
    </p>
  );
}
