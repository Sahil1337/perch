import fixture from "../../../shared/replay/fixtures/birdwatch.json";

export type Arrival = { name: string; seen: string; birds: number };

type Recording = { scene?: string; key: string; record?: { results?: { rows: string[][] }[] } };

// "First arrivals of spring", spring-migration.sql: the rows the hero window's own run returns.
const SPRING = "select s.common_name, to_char(min(g.seen_at)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function day(iso: string): string {
  const [, month, date] = iso.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1] ?? ""}`;
}

const rows =
  (fixture.recordings as Recording[]).find((r) => r.key.startsWith(SPRING))?.record?.results?.[0]?.rows ?? [];

export const ARRIVALS: Arrival[] = rows.map(([name = "", seen = "", birds = "0"]) => ({
  name,
  seen: day(seen),
  birds: Number(birds),
}));

export const TOTAL_BIRDS = ARRIVALS.reduce((sum, row) => sum + row.birds, 0);

/** The editor's text, as the hero window holds it: the landing types the third and fourth lines. */
export const QUERY = {
  first: "select … from sightings g",
  typed: "join sp",
  completion: "species",
  alias: " s",
  on: "on s.id = g.species_id",
};

export const SUMMARY =
  `The bird types a join on porcelain keys: select … from sightings g join species s on s.id = g.species_id. ` +
  `Completion offers species, a table of about 51 rows, and the ON clause comes from the foreign key. ` +
  `Run, it returns ${ARRIVALS.length} migrant species and ${TOTAL_BIRDS.toLocaleString("en-GB")} birds, ` +
  `first seen from ${ARRIVALS[0]?.seen ?? ""} (${ARRIVALS[0]?.name ?? ""}) to ${ARRIVALS.at(-1)?.seen ?? ""}.`;
