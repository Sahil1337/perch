// What the completion scene's popup offers on its second join, in the app's own order: after
// `from sightings g join checklists c on g.checklist_id = c.id`, `join ` and ⌃Space rank the tables
// a foreign key reaches from either of them first, then the rest; `on ` and ⌃Space offer the
// condition written out from that key, already selected.

export type TableOffer = { name: string; detail: string };

/** The popup's first rows: three related tables, then the alphabetical rest begins. */
export const TABLES: TableOffer[] = [
  { name: "observers", detail: "~6 rows" },
  { name: "sites", detail: "~12 rows" },
  { name: "species", detail: "~51 rows" },
  { name: "checklist_summary", detail: "view" },
];

/** The table the scene takes; the highlight opens on the first row and steps down to it. */
export const PICK = 1;

export const CONDITION = { text: "c.site_id = t.id", detail: "foreign key" };
