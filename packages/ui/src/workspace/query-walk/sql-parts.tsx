"use client";

// A spliced statement, with the substitutions marked — and only the substitutions moving.
//
// This is the whole point of the per-row SQL: `takes.ID = s.ID` becomes `takes.ID = '12345'`, and
// the lesson is that ONE thing changed. Re-rendering the block as the cursor moves re-flows every
// line and the eye loses its place, so the text around a literal is rendered once and stays put
// while the literal itself cross-fades in a grid cell of its own — the same trick the stage's column
// headers use to swap a label without the header jumping.

import type * as React from "react";
import type { SqlPart } from "./clauses";
import { highlightSql } from "../sql-editor/highlight-sql";
import { Crossfade } from "./crossfade";

export function SqlParts({ parts }: { readonly parts: readonly SqlPart[] }): React.ReactElement {
  return (
    <pre className="whitespace-pre-wrap rounded-md bg-muted p-2 font-mono text-sm leading-5">
      {parts.map((part, index) =>
        part.over === null ? (
          // Keyed by position: the parts are a fixed splice of one statement, so a run's place in
          // the list IS its identity, and what changes about it is only its text.
          <span key={index}>{highlightSql(part.text)}</span>
        ) : (
          <Crossfade
            className="relative inline-grid align-bottom"
            key={`${index}:${part.over}`}
            textClassName="col-start-1 row-start-1 rounded-sm bg-info/15 px-0.5 text-info-foreground"
            title={`in place of ${part.over}`}
            value={part.text}
          />
        ),
      )}
    </pre>
  );
}
