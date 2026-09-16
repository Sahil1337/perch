// One scaffold for every `perch` subcommand. A command declares its usage line, its options and the
// positionals it insists on; this handles the rest — `--help`, the `--json` switch every command
// offers, the "you forgot an argument" error, and turning a CliError into one clean line.

import { parseArgs } from "node:util";
import { CliError, die } from "./errors.js";
import { red } from "./ansi.js";

type OptionsConfig = NonNullable<NonNullable<Parameters<typeof parseArgs>[0]>["options"]>;

/** Every command answers to these two, so no command declares them itself. */
const COMMON = {
  json: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const satisfies OptionsConfig;

type Parsed<T extends OptionsConfig> = ReturnType<
  typeof parseArgs<{ args: string[]; options: T; allowPositionals: true; strict: true }>
>;

export type CommandContext<T extends OptionsConfig> = {
  values: Parsed<T & typeof COMMON>["values"];
  positionals: string[];
  /** `--json` was passed. */
  json: boolean;
};

export type CommandSpec<T extends OptionsConfig> = {
  /** Printed for `--help` and when a required positional is missing. */
  usage: string;
  options?: T;
  /** Names of the positionals the command cannot run without, in order. */
  positionals?: string[];
};

export function defineCommand<T extends OptionsConfig>(
  spec: CommandSpec<T>,
  handler: (ctx: CommandContext<T>) => Promise<void>,
): (argv: string[]) => Promise<void> {
  return async (argv: string[]): Promise<void> => {
    try {
      // parseArgs infers its result from a literal options object; `spec.options` is generic
      // here, so the shape comes back from `CommandContext<T>` instead.
      const parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: { ...spec.options, ...COMMON } as OptionsConfig,
      });
      const { positionals } = parsed;
      const common = parsed.values as { help?: boolean; json?: boolean };
      if (common.help) {
        console.log(spec.usage.trimEnd());
        return;
      }
      const required = spec.positionals ?? [];
      const missing = required.slice(positionals.length);
      if (missing.length > 0) die(`missing <${missing[0]}>\n${spec.usage.trimEnd()}`);
      await handler({
        values: parsed.values as CommandContext<T>["values"],
        positionals,
        json: Boolean(common.json),
      });
    } catch (err) {
      if (!(err instanceof CliError)) throw err;
      console.error(red(`error: ${err.message}`));
      process.exitCode = 1;
    }
  };
}
