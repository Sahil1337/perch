// TTY styling. Every helper is a no-op when stdout is not a terminal or NO_COLOR is set, so
// piping `perch run ... --format csv` into a file never smuggles escape codes along with it.

function isTTY(): boolean {
  return Boolean(process.stdout.isTTY) && !process.env["NO_COLOR"];
}

function wrap(code: string, s: string): string {
  return isTTY() ? `\x1b[${code}m${s}\x1b[0m` : s;
}

export const bold = (s: string): string => wrap("1", s);
export const dim = (s: string): string => wrap("2", s);
export const red = (s: string): string => wrap("31", s);

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function oneLine(sql: string, max = 80): string {
  const flat = sql.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}
