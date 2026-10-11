import { stripComments } from "@perch/sql";

/**
 * The key a run is looked up by. Two texts the server would run identically map to the same key:
 * comments go (with `@perch/sql`'s own scanner, so `'-- not a comment'` survives), whitespace runs
 * collapse, trailing semicolons drop, and everything outside a quoted literal or identifier is
 * lower-cased. Quoted text is kept byte for byte — `'LC'` and `'lc'` are different queries.
 */
export function normaliseSql(sql: string): string {
  const text = stripComments(sql).sql;
  let out = "";
  let space = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\s/.test(ch)) {
      space = true;
      i++;
      continue;
    }
    if (space && out.length > 0) out += " ";
    space = false;
    const end = quotedEnd(text, i);
    if (end > i) {
      out += text.slice(i, end);
      i = end;
      continue;
    }
    out += ch.toLowerCase();
    i++;
  }
  return out.replace(/[\s;]+$/, "");
}

/** Where a quoted run starting at `i` ends, or `i` when nothing is quoted there. */
function quotedEnd(text: string, i: number): number {
  const ch = text[i];
  if (ch === "'" || ch === '"' || ch === "`") {
    for (let j = i + 1; j < text.length; j++) {
      if (text[j] === "\\" && ch !== "`") {
        j++;
        continue;
      }
      if (text[j] === ch) {
        if (text[j + 1] === ch) {
          j++;
          continue;
        }
        return j + 1;
      }
    }
    return text.length;
  }
  if (ch === "$") {
    const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))?.[0];
    if (!tag) return i;
    const close = text.indexOf(tag, i + tag.length);
    return close === -1 ? text.length : close + tag.length;
  }
  return i;
}
