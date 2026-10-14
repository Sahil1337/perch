// The statement the walk scene steps through, clause by clause, labelled as its rail labels them,
// with the rows that survive each clause as the walk's own probes counted them (fixtures/walk.json).

export type Clause = { label: string; text: string; rows: number };

export const CLAUSES: Clause[] = [
  { label: "FROM", text: "species s", rows: 51 },
  { label: "JOIN", text: "families f on f.id = s.family_id", rows: 51 },
  { label: "WHERE", text: "s.migrant", rows: 33 },
  { label: "GROUP BY", text: "f.name", rows: 18 },
  { label: "HAVING", text: "count(*) > 1", rows: 6 },
  { label: "SELECT", text: "f.name as family, count(*) as migrants", rows: 6 },
  { label: "ORDER BY", text: "migrants desc, family", rows: 6 },
  { label: "LIMIT", text: "4", rows: 4 },
];

/** Every count is printed this many digits wide, so the counts line up down the stack. */
export const PLACES = String(Math.max(...CLAUSES.map((clause) => clause.rows))).length;
