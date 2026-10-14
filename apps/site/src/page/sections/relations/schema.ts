import { birdwatch } from "../../../shared/replay/fixtures";

/** A foreign key: `from` holds the column, `to` is the table it references. */
export type ForeignKey = { from: string; to: string };

const databases = Object.values(birdwatch.schemas);

/**
 * The foreign keys between `tables`, as a real Perch read them off the birdwatch database: the
 * wires the Relationship View draws between those cards, in the order the schema lists them.
 */
export function foreignKeysAmong(tables: readonly string[]): ForeignKey[] {
  const shown = new Set(tables);
  return databases.flatMap((database) =>
    database.schemas.flatMap((schema) =>
      schema.tables
        .filter((table) => shown.has(table.name))
        .flatMap((table) =>
          table.foreignKeys.filter((key) => shown.has(key.refTable)).map((key) => ({ from: table.name, to: key.refTable })),
        ),
    ),
  );
}
