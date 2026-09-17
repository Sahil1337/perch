// The one station a section with no clause sequence gets: the statement, and what it returns.

import { WALK_PREFIX } from "../clauses";
import { station, type Station } from "../station-types";

/**
 * The whole walk for a section that produces a table but has no clauses to step through: one
 * station, which runs the statement and counts it.
 *
 * `text` is spliced in exactly as it stands, prefix and all, and NOTHING is appended to it — the
 * same rule the LIMIT station follows for the same reason. A `VALUES` list or a `select 1` may
 * carry a LIMIT of its own, and gluing a second one on the end would turn a query that runs into a
 * syntax error; the row cap the server applies through `maxRows` does the job either way.
 *
 * The count wraps the statement in a derived table, which is legal around a WITH prefix in both
 * dialects the walk speaks, so a CTE list in scope rides along untouched.
 */
export function buildResultStation(text: string): Station {
  return station({
    key: "result",
    id: "result",
    label: "RESULT",
    present: true,
    clause: { from: 0, to: text.length },
    batches: [
      [
        { id: "sample", label: "The query as written", sql: text },
        {
          id: "count",
          label: "Count",
          sql: `select count(*) from (\n${text}\n) as ${WALK_PREFIX}count`,
        },
      ],
    ],
  });
}
