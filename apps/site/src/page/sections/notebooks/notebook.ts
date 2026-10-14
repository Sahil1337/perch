import fixture from "../../../shared/replay/fixtures/birdwatch.json";

/** The notebook the real scene opens. */
const PATH = "~/birdwatch/field-notes.sql";

/** The line that starts a new cell; on disk it is only a comment. */
export const CELL_BREAK = "-- %%";

type Result = { columns: { align?: string }[]; rows: string[][] };
type Recording = { scene?: string; request?: { sql?: string }; record?: { results?: Result[] } };

export type Cell = {
  sql: string;
  /** The rows its run returned, as the app recorded them. */
  rows: string[][];
  /** Per column, whether the app right-aligns it. */
  right: boolean[];
};

export const FILE_NAME = PATH.slice(PATH.lastIndexOf("/") + 1);

const text = fixture.files.find((file) => file.path === PATH)?.content ?? "";
const recordings = fixture.recordings as Recording[];

function split(source: string): string[] {
  const cells: string[][] = [[]];
  for (const line of source.split("\n")) {
    if (line.trim() === CELL_BREAK) cells.push([]);
    else cells[cells.length - 1]?.push(line);
  }
  return cells.map((lines) => lines.join("\n").trim()).filter(Boolean);
}

function resultOf(sql: string): Result | undefined {
  const run = recordings.find((recording) => recording.scene === "notebook" && recording.request?.sql?.trim() === sql);
  return run?.record?.results?.[0];
}

/** field-notes.sql's cells, each with the result its own Run button got in the recording. */
export const CELLS: Cell[] = split(text).map((sql) => {
  const result = resultOf(sql);
  return {
    sql,
    rows: result?.rows ?? [],
    right: result?.columns.map((column) => column.align === "right") ?? [],
  };
});
