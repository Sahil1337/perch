// @perch/sql carries verbatim copies of files that apps/server owns. The copy exists because the
// frontend needs the same statement boundaries the server will use, and cannot import them:
// apps/server builds with plain tsc and publishes with five runtime dependencies, so a private
// `@perch/*` import would survive into dist/ and break `npm i perch`.
//
// A copy that drifts is worse than no copy at all — the editor would offer to run one range and
// the server would run another. So the copies must stay byte-identical, and this fails if they do
// not. Edit apps/server's file, then re-run with `--fix` to bring this package back in line.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgSrc = path.join(here, "..", "src");
const serverSrc = path.join(here, "..", "..", "..", "apps", "server", "src");

/** copy in this package → the file in apps/server that owns it. */
const MIRRORED = {
  "split.ts": path.join(serverSrc, "core", "sql", "split.ts"),
};

const fix = process.argv.includes("--fix");
const drifted = [];

for (const [name, origin] of Object.entries(MIRRORED)) {
  const copy = path.join(pkgSrc, name);
  const want = readFileSync(origin, "utf8");
  if (readFileSync(copy, "utf8") === want) continue;
  if (fix) {
    writeFileSync(copy, want);
    console.log(`@perch/sql: synced src/${name} from ${path.relative(path.join(here, "..", "..", ".."), origin)}`);
  } else {
    drifted.push(`src/${name}  <=  ${path.relative(path.join(here, "..", "..", ".."), origin)}`);
  }
}

if (drifted.length > 0) {
  console.error("@perch/sql has drifted from the files apps/server owns:\n  " + drifted.join("\n  "));
  console.error("\napps/server is the authority. Re-sync with:\n  bun run --filter @perch/sql check -- --fix");
  process.exit(1);
}
console.log("@perch/sql: in-sync check passed");
