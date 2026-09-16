// Expected, user-facing CLI failures. `main.ts` prints a CliError as one clean line, no stack.

/** Thrown by commands for expected, user-facing failures (bad args, not found, etc). */
export class CliError extends Error {}

/** Throws a CliError — use for expected failures so main() prints a clean message (no stack). */
export function die(message: string): never {
  throw new CliError(message);
}
