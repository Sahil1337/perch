// The regex tokeniser the editor grew out of. It survives only as `highlightSql`, for read-only
// previews where a full editor per row would be absurd.

import type * as React from "react";

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
