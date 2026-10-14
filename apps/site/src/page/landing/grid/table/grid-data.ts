import type { Row } from "@perch/protocol";
import { recordedResult } from "../../../../shared/replay/fixtures";

function table(name: string): Row[] {
  return recordedResult((r) => r.key === `select * from ${name}`)?.rows ?? [];
}

function byId(rows: Row[]): Map<number, Row> {
  return new Map(rows.map((row) => [Number(row[0]), row]));
}

export type GridColumn = { name: string; width: number; numeric: boolean };

/** Characters of padding either side of a value; the hairline runs through the middle of a gap. */
export const PAD = 1;

/**
 * Every recorded sighting, joined to its species, site and observer the way a query would return
 * them. The values are the fixture's; only the shape is the grid's.
 */
function joinedSightings(): { columns: string[]; rows: string[][] } {
  const species = byId(table("species"));
  const families = byId(table("families"));
  const sites = byId(table("sites"));
  const observers = byId(table("observers"));
  const checklists = byId(table("checklists"));
  const columns = [
    "id",
    "species",
    "count",
    "behaviour",
    "seen_at",
    "site",
    "region",
    "habitat",
    "lat",
    "lon",
    "observer",
    "scientific_name",
    "family",
    "status",
  ];
  const rows = table("sightings").map(([id, checklistId, speciesId, count, behaviour, seenAt]) => {
    const kind = species.get(Number(speciesId)) ?? [];
    const checklist = checklists.get(Number(checklistId)) ?? [];
    const site = sites.get(Number(checklist[2])) ?? [];
    const observer = observers.get(Number(checklist[1])) ?? [];
    const family = families.get(Number(kind[3])) ?? [];
    return [
      String(id),
      String(kind[1] ?? ""),
      String(count),
      String(behaviour),
      String(seenAt ?? "").slice(0, 16).replace("T", " "),
      String(site[1] ?? ""),
      String(site[2] ?? ""),
      String(site[3] ?? ""),
      String(site[4] ?? ""),
      String(site[5] ?? ""),
      String(observer[1] ?? ""),
      String(kind[2] ?? ""),
      String(family[1] ?? ""),
      String(kind[4] ?? ""),
    ];
  });
  return { columns, rows };
}

const NUMERIC = new Set(["id", "count", "lat", "lon"]);
const MAX_WIDTH = 24;

export type GridData = {
  columns: GridColumn[];
  /** Character offset where each column's cell starts, gap included. */
  starts: number[];
  /** The whole width in characters. */
  width: number;
  /** The rows as values, so a tick can change one and re-render that line. */
  values: string[][];
};

let cached: GridData | null = null;

export function gridData(): GridData {
  if (cached) return cached;
  const { columns: names, rows } = joinedSightings();
  const columns = names.map((name, index) => {
    const longest = rows.reduce((max, row) => Math.max(max, (row[index] ?? "").length), name.length);
    return { name, width: Math.min(MAX_WIDTH, longest), numeric: NUMERIC.has(name) };
  });
  const starts: number[] = [];
  let width = 0;
  for (const column of columns) {
    starts.push(width);
    width += column.width + PAD * 2;
  }
  cached = { columns, starts, width, values: rows };
  return cached;
}

/** One line of the grid: every value fitted to its column, separated by the padding gaps. */
export function lineOf(data: GridData, values: string[]): string {
  let line = "";
  data.columns.forEach((column, index) => {
    let value = values[index] ?? "";
    if (value.length > column.width) value = `${value.slice(0, column.width - 1)}…`;
    const fitted = column.numeric ? value.padStart(column.width) : value.padEnd(column.width);
    line += " ".repeat(PAD) + fitted + " ".repeat(PAD);
  });
  return line;
}

export function headerLine(data: GridData): string {
  return lineOf(
    data,
    data.columns.map((column) => column.name),
  );
}
