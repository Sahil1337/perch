// The three sentences a recursive CTE's stations carry.
//
// They live here rather than with the rest of the narration because `program.ts` is the only place
// holding both halves' parses, and these are written from them — so this module takes the two
// parses as arguments and `program.ts` calls it while it still has them.

import { bareName, type ParsedSelect } from "../clauses";
import type { RecursionSentences } from "../program";
import { code } from "./prose";

/**
 * What the three stations say, written here because this is the only place holding both halves'
 * parses — and so the only place that can name the tables each half actually reads.
 *
 * The hard part is that these have to be TRUE of what the probes below them show, and the probes
 * show ONE pass. So REPEAT says so in as many words rather than letting a reader who sees a rows
 * card assume it is the finished table, and SETTLE is explicit that the database ran every pass
 * even though the walk ran one. Nothing here promises the walk iterated, because it does not.
 */
export function recursionSentences(
  name: string,
  operator: string,
  dedupes: boolean,
  anchor: ParsedSelect,
  step: ParsedSelect,
): RecursionSentences {
  const cte = code(name);
  const op = code(operator);
  const start = `${cte} is two queries joined by ${op}, and this is the half that never mentions ${cte}: it ${reads(anchor, name)}, so it can run before anything at all has been collected. These rows are where the recursion begins — every row ${cte} ends up holding descends from one of them.`;
  const pass = `The other half is the step, and it ${reads(step, name)} — with ${cte} standing for what the pass before it produced. What is below is the FIRST PASS ONLY: ${cte} here is exactly the rows START found, spliced in where the step names it. The walk stops after that one pass; the database does not. Pass 2 runs the same step over pass 1's rows, pass 3 over pass 2's, and so on until a pass adds nothing and the recursion ends.`;
  const repeat = dedupes
    ? `${pass} And because the halves are joined by ${op} rather than ${code("union all")}, every pass's rows are matched against everything collected so far and the duplicates dropped — so the count below is an upper bound on what this pass really adds, not the number itself.`
    : pass;
  const settle = `These are the rows left when that repetition stops: ${cte} in full, as the database built it — every pass it ran, however many that was, collected into one table. START's rows are the first of them and REPEAT's are one pass's worth; this is all of them, and this is what the rest of the query reads under the name ${cte}.`;
  return { start, repeat, settle };
}

/** `reads `emp`` / `reads `emp` and `dept``: the tables a term is over, the CTE's own name left out
 *  because a sentence that said a query "reads chain" while explaining chain would explain nothing. */
function reads(parsed: ParsedSelect, name: string): string {
  const own = bareName(name).toLowerCase();
  const tables: string[] = [];
  for (const source of [parsed.first, ...parsed.joins.map((join) => join.source)]) {
    if (bareName(source.name).toLowerCase() === own) continue;
    if (!tables.includes(source.name)) tables.push(source.name);
  }
  if (tables.length === 0) return "reads no table of its own";
  const quoted = tables.map(code);
  return `reads ${quoted.length === 1 ? quoted[0] : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`}`;
}
