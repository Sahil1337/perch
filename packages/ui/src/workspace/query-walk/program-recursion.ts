// Reading a recursive CTE into the two halves the walk can show.
//
// Every test below is a REFUSAL and the bar is proof: a recursive CTE the walk mis-splits does not
// fail visibly, it hangs, or returns rows until something runs out. See the doc on `readRecursion`.

import type { Dialect } from "@perch/protocol";
import {
  bareName,
  isSetOp,
  isUnsupported,
  parseStatement,
  type Cte,
  type Range,
} from "./clauses";
import type { Recursion, RootMap, SelfRef } from "./program-types";
import { recursionSentences } from "./narration/recursion-sentences";
import { placeSpan } from "./root-map";

/**
 * The two halves of a recursive CTE, or null when the shape is anything but the one we can read.
 *
 * EVERY test below is a refusal, and each one protects the same thing. The probes built from this
 * run on the reader's database: a "step" that is not really a step, or an "anchor" that turns out
 * to need the CTE, is not a mislabelled card — it is a statement that recurses without a base case
 * or joins a table to itself with nothing to stop it, and a query like that does not fail politely.
 * It hangs, or it returns rows until something runs out. So the bar is proof, not likelihood:
 *
 *  - Two branches and one operator, and that operator UNION or UNION ALL. INTERSECT and EXCEPT are
 *    not how a recursive CTE is written, and a third branch means one of the two roles is shared by
 *    branches we would then have to decide between.
 *  - Both branches plain SELECTs. A nested set operation inside a branch has its own two halves,
 *    and which of them carries the self-reference is a question this function does not ask.
 *  - Branch 0 silent about the CTE and branch 1 loud about it. Written the other way round — which
 *    some dialects accept — the two roles are swapped, and a "START" that names the CTE would be a
 *    query that cannot run at all.
 *  - Every BARE mention of the name in branch 1 in a SOURCE position. This is the one that matters
 *    most: a self-reference in a WHERE subquery, or in a scalar in the select list, is not something
 *    a derived table can be spliced in place of, and splicing the anchor into the FROM while LEAVING
 *    that mention behind would build a statement that still names an undefined table. The test is
 *    the splice itself — blank every source we found and ask what of the name survives — because
 *    that asks about the text we are about to rewrite rather than about our model of it. What may
 *    survive is a QUALIFIER, and why that is safe is the subtle part: see `survivesSplice`.
 */
export function readRecursion(
  root: string,
  dialect: Dialect,
  cte: Cte,
  host: string,
  map: RootMap | null,
): Recursion | null {
  const body = host.slice(cte.body.from, cte.body.to);
  const parsed = parseStatement(body, dialect);
  if (isUnsupported(parsed) || !isSetOp(parsed)) return null;
  if (parsed.branches.length !== 2 || parsed.operators.length !== 1) return null;

  const between = parsed.operators[0]!;
  if (between.op !== "union" && between.op !== "union all") return null;
  const [anchorBranch, stepBranch] = parsed.branches;
  if (anchorBranch === undefined || stepBranch === undefined) return null;
  const anchorParsed = anchorBranch.parsed;
  const stepParsed = stepBranch.parsed;
  if (anchorParsed.kind !== "select" || stepParsed.kind !== "select") return null;

  // Branch ranges index `body`, and so do the sources inside `stepParsed`: a set operation's
  // branches are parsed over the whole text rather than over a slice of it.
  const anchorSql = body.slice(anchorBranch.range.from, anchorBranch.range.to);
  const stepSql = body.slice(stepBranch.range.from, stepBranch.range.to);
  if (mentionsWord(anchorSql, cte.name) || !mentionsWord(stepSql, cte.name)) return null;

  const wanted = bareName(cte.name).toLowerCase();
  const selfRefs: SelfRef[] = [];
  for (const source of [stepParsed.first, ...stepParsed.joins.map((join) => join.source)]) {
    // A derived table is a parenthesised query that happens to be called something; it is never the
    // CTE, and `(select … from chain) chain` would put the real self-reference out of reach.
    if (source.kind === "derived") continue;
    if (bareName(source.name).toLowerCase() !== wanted) continue;
    selfRefs.push({
      range: {
        from: source.range.from - stepBranch.range.from,
        to: source.range.to - stepBranch.range.from,
      },
      alias: source.alias ?? cte.name,
      root: placeSpan(root, map, host, {
        from: cte.body.from + source.range.from,
        to: cte.body.from + source.range.to,
      }),
    });
  }
  if (selfRefs.length === 0) return null;
  const blanked = blankOut(
    stepSql,
    selfRefs.map((ref) => ref.range),
  );
  if (
    survivesSplice(
      blanked,
      cte.name,
      selfRefs.map((ref) => ref.alias),
    )
  )
    return null;

  const operator = body.slice(between.range.from, between.range.to);
  const place = (range: Range): Range | null =>
    placeSpan(root, map, host, { from: cte.body.from + range.from, to: cte.body.from + range.to });
  return {
    name: cte.name,
    anchorSql,
    stepSql,
    operator,
    dedupes: between.op === "union",
    anchor: place(anchorBranch.range),
    step: place(stepBranch.range),
    selfRefs,
    sentences: recursionSentences(
      cte.name,
      operator,
      between.op === "union",
      anchorParsed,
      stepParsed,
    ),
  };
}

/** The ranges replaced by spaces of their own length, so offsets stay put and no two words that
 *  were apart are pushed together. Used to ask what a piece of SQL says with something taken out. */
function blankOut(text: string, ranges: readonly Range[]): string {
  let out = text;
  for (const range of [...ranges].sort((a, b) => b.from - a.from)) {
    out = out.slice(0, range.from) + " ".repeat(range.to - range.from) + out.slice(range.to);
  }
  return out;
}

/**
 * Whether the CTE's name still says something the splice has not accounted for — the last and
 * strictest test in `readRecursion`, run over the step with every spliced source already blanked.
 *
 * A BARE mention is fatal and a QUALIFIED one is not, and the difference is what the splice leaves
 * behind. `from chain` becomes `from (…) chain`: the derived table keeps the name as its alias,
 * because that is what the rest of the term is already calling it. So `where chain.depth < 5` —
 * the usual way to write a depth guard — still resolves afterwards, against the derived table
 * instead of against the CTE, and nothing about the statement has changed but where those rows come
 * from. A bare `chain` has no such alias to land on: it is a second, un-spliced reference to the
 * recursive CTE, and leaving it in is how the REPEAT probe would name a table that isn't there —
 * or, worse, name the real recursive CTE and run the recursion this walk exists not to run.
 *
 * Three ways that could be got wrong, and how each is closed:
 *
 *  - The qualifier must match the alias the splice will ACTUALLY keep, not the CTE's name. When the
 *    reader wrote `from chain c` the derived table is called `c`, so a surviving `chain.x` resolves
 *    to nothing and this falls back. That is why the aliases are passed in rather than assumed.
 *  - Quoting and case are compared the way SQL compares them — through `bareName`, lower-cased — so
 *    `CHAIN.depth` and a quoted alias answer to each other and a raw string match never decides it.
 *  - A near miss is not a mention. The pattern is the one `mentionsWord` uses, so `chained.x` does
 *    not count as `chain.x`, `e.chain` is a column and not a source, and the scan resumes at the end
 *    of the NAME rather than past the character after it — otherwise `chain chain` would hide its
 *    second half inside the first's trailing character.
 *
 * A schema qualifier reads as a match here and is harmless: a CTE lives in no schema, so `chain.foo`
 * is some other object entirely, the splice leaves it exactly as written, and it goes on meaning
 * what it meant.
 */
function survivesSplice(text: string, name: string, aliases: readonly string[]): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(^|[^\\w.$"\`])(${escaped})($|[^\\w$"\`])`, "gi");
  const kept = new Set(aliases.map((alias) => bareName(alias).toLowerCase()));
  for (let hit = pattern.exec(text); hit !== null; hit = pattern.exec(text)) {
    const end = hit.index + hit[1]!.length + hit[2]!.length;
    if (text[end] !== "." || !kept.has(bareName(hit[2]!).toLowerCase())) return true;
    pattern.lastIndex = end;
  }
  return false;
}

/** `r` inside `select n+1 from r`, but not inside `router` or `'r'`. */
export function mentionsWord(text: string, word: string): boolean {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w.$"\`])${escaped}($|[^\\w$"\`])`, "i").test(text);
}
