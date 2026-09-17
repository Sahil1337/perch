// What a set operator does to the two results it meets.
//
// Its own file, rather than beside the other station sentences, because `steps.ts` is what calls it
// and the rest of the station sentences read `steps.ts` back — one import each way through the same
// module would be a cycle for the sake of a tidier folder.

import type { SetOperator } from "../clauses";

/** What the operator does to the two results, in the reader's terms. */
export function combineSentence(
  op: SetOperator,
  keepsDuplicates: boolean,
  tighter: boolean,
): string {
  const base = op.startsWith("union")
    ? "keeps every row that appeared on either side"
    : op.startsWith("intersect")
      ? "keeps only the rows that appeared on BOTH sides"
      : "keeps the rows from the left that did NOT appear on the right";
  const duplicates = keepsDuplicates
    ? " ALL keeps duplicates, so a row that appeared twice still appears twice — which is why the regions below are not drawn for it."
    : " Duplicates collapse: the result is a set, so a row that appeared on both sides appears once.";
  const binding = tighter
    ? " These two met before the rest of the chain because INTERSECT binds tighter than UNION and EXCEPT — not because they were written side by side."
    : "";
  return `This step ${base}.${duplicates}${binding}`;
}
