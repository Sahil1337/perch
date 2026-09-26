// Where the first-run card's content column actually is.
//
// The card has two columns, not one. Its bordered rows — saved connections, discovered servers,
// the alert, the empty state — span the full content box, but their own 1px border plus `px-2`
// puts what is *inside* them 9px in from each edge. That inner line is the one the eye reads,
// because it is where the icons, the names and the Connect buttons sit.
//
// Anything not inside a row is flush with the outer box, and so lands 9px wide on both sides
// unless it wears this.
//
// The matching `-ml-2` / `-mr-2` on the ghost buttons stays declared in each file that uses it:
// `shadcn/require-static-classes` cannot follow an imported constant onto a <Button>.

/** Puts a flush element — a section heading, a header's action, the footer — on the row's column. */
export const ROW_COLUMN = "mx-px px-2";
