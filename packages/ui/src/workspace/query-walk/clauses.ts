// Slices one SELECT into its clauses, as character ranges into the text the user wrote.
//
// The walk's step queries are built by splicing those ranges back together, never by regenerating
// SQL, so what runs is the user's own spelling of every clause. The slicing rides on the editor's
// own grammar: keywords are `Keyword` nodes, a parenthesised group is one `Parens` node, and a
// string or comment is its own node, so a `where` inside a string literal never matches.
//
// The slicer is a family of modules now; this is the path they are read through, and it carries
// only what the rest of the walk asks for. The parser toolkit under them — the tree, its depth-zero
// tokens, the small predicates that read them — stays behind `clause-tokens.ts`, because a caller
// that needs one of those is doing parsing rather than reading a parse.
//
// - `clause-types.ts`     what a sliced statement IS
// - `clause-tokens.ts`    the tree and its depth-zero tokens
// - `parse-select.ts`     one SELECT, clause by clause
// - `parse-setop.ts`      a UNION / INTERSECT / EXCEPT chain, branch by branch
// - `statement-shape.ts`  what KIND of statement the text is
// - `scan-predicates.ts`  what is inside a clause body
// - `correlation.ts`      which references point outward
// - `counting.ts`         rewriting a subquery into one that counts
// - `splice.ts`           putting the ranges back together

export { bareName, normalizeRef, splitRef } from "./clause-tokens";
export {
  isSetOp,
  isUnsupported,
  type Cte,
  type InList,
  type JoinClause,
  type KeyPair,
  type ParsedSelect,
  type ParsedSetOp,
  type Range,
  type SelectSubquery,
  type SetBranch,
  type SetOperator,
  type SetTree,
  type SourceRef,
  type SqlPart,
  type SubqueryPredicate,
  type SubqueryPredicateKind,
  type Unsupported,
} from "./clause-types";
export { refRanges } from "./correlation";
export { canWidenSelectList, collapsesToOneRow, countingRewrite, countingWrap } from "./counting";
export { parseSelect } from "./parse-select";
export { parseStatement, regroups } from "./parse-setop";
export { conjuncts, inLists, selectSubqueries, subqueryPredicates } from "./scan-predicates";
export { spliceParts, spliceRanges, WALK_PREFIX } from "./splice";
export { statementShape } from "./statement-shape";
