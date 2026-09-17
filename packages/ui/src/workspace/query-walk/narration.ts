// One sentence per station, naming the real tables, keys and columns from the user's query, and
// the phases each station plays through.
//
// The sentences moved into `narration/`; this keeps the old import path working. `narration/prose.ts`
// is deliberately not re-exported: `code`, `list` and `clip` are how these sentences are written,
// not something the screens that read them have any business calling.

export * from "./narration/bound-sentences";
export * from "./narration/grid-sentences";
export * from "./narration/station-sentences";
export * from "./narration/tempo";
export * from "./narration/terminus-sentences";
