// TTY styling. Every helper is a no-op when stdout is not a terminal or NO_COLOR is set, so
// redirecting `perch status --json` into a file never smuggles escape codes along with it.

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
