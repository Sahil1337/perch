// A doubly-correlated subquery gets three sentences rather than two, because it has three things
// going on: what the section is, what happened for the bound OUTER row, and what happened in one
// CELL. The third only exists once a reader has picked one.

import type { BoundPlan, BoundRow } from "../bound";
import { cellFound, isNegativeKind, type GridBuild } from "../grid";
import { boundRowSentence, passRule } from "./bound-sentences";
import { code, list } from "./prose";

/** What a grid section IS: the loop it stands for, and what the predicate wants of it. */
export function gridSentence(plan: BoundPlan, grid: GridBuild): string {
  const refs = list(plan.columns.map((column) => code(column.ref)));
  const named = refs === "" ? "a value from the row it sits inside" : refs;
  const asks = grid.innerCondition
    ? `whether a row has ${code(grid.innerCondition)}`
    : "whether it has a row";
  const negativeInner = isNegativeKind(grid.innerKind);
  const rule = isNegativeKind(grid.middleKind)
    ? `passes the ${grid.rowNoun} only when no ${grid.driveNoun} comes back at all, which is to say only when every ${grid.driveNoun} ${negativeInner ? "found its match" : "failed to find one"}`
    : `passes the ${grid.rowNoun} as soon as one ${grid.driveNoun} comes back, which is to say as soon as a single ${grid.driveNoun} ${negativeInner ? "has no match" : "has one"}`;
  return `Every row of ${plan.outer.label} hands this subquery its own ${named}, so it runs once per ${grid.rowNoun} rather than once. Each run walks every row of ${code(grid.driveTitle)} and asks ${code(grid.innerSource)} ${asks}; a ${grid.driveNoun} ${negativeInner ? "with no such row" : "with such a row"} comes back as a row of this subquery. ${code(grid.middleKind)} then ${rule}.`;
}

/** What happened for the bound outer row, counted in driving rows rather than in bare matches. */
export function gridRowSentence(
  plan: BoundPlan,
  grid: GridBuild,
  row: BoundRow,
  columns: number,
): string {
  // Without a count there is no "3 of the 5" to write, and the ledger's own sentence already says
  // what can honestly be said about such a row.
  if (row.matches === null || columns === 0) return boundRowSentence(plan, row);
  const bound = list(
    plan.columns.map((column) => code(`${column.ref} = ${row.literals.get(column.ref) ?? "null"}`)),
  );
  const n = row.matches;
  // `1 of the 5 rows HAS`, `3 of the 5 rows HAVE`: the verb agrees with the count in front of it,
  // not with the rows behind it, and a sentence that gets that wrong reads as machine output.
  const have = `${n === 1 ? "has" : "have"} ${isNegativeKind(grid.innerKind) ? "no matching row in" : "a matching row in"}`;
  // The flourish is earned only in the case it describes: one row, under a predicate that needs
  // none. Anywhere else it would be a joke about a number that is not on screen.
  const twist =
    !row.pass && isNegativeKind(grid.middleKind) && n === 1 ? ", and one is not none" : "";
  return `With ${bound}, ${n} of the ${columns} rows of ${code(grid.driveTitle)} ${have} ${code(grid.innerSource)}, so this subquery comes back with ${n} ${n === 1 ? "row" : "rows"} and the ${grid.rowNoun} ${row.pass ? "passes" : "fails"}: ${code(grid.middleKind)} needs ${passRule(grid.middleKind)}${twist}.`;
}

/** What happened in the picked cell: the one place in the walk with two of the reader's own values
 *  spliced into one statement. `rows` is how many the cell's own probe found, when it has landed. */
export function gridCellSentence(args: {
  readonly grid: GridBuild;
  /** The substitutions the cell's SQL made, as `ref = literal` pairs. */
  readonly bound: readonly string[];
  readonly label: string;
  readonly returned: boolean;
  readonly rows: number | null;
}): string {
  const { grid, label, returned, rows } = args;
  const found = cellFound(returned, grid.innerKind);
  const has = found
    ? rows === null
      ? "has a matching row"
      : `has ${rows} ${rows === 1 ? "row" : "rows"}`
    : "has no such row";
  const tail = returned
    ? `${code(label)} is one of the rows this subquery returns for this ${grid.rowNoun}.${
        isNegativeKind(grid.middleKind) ? ` One ${grid.driveNoun} is all it takes.` : ""
      }`
    : `${code(label)} is not returned: this ${grid.driveNoun} counts as ${found ? "matched" : "unmatched"}.`;
  return `With ${list(args.bound.map(code))}, ${code(grid.innerSource)} ${has}, so the inner ${code(grid.innerKind)} is ${returned} and ${tail}`;
}
