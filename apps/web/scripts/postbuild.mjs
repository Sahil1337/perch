// Copies the static export into apps/server/ui/, which `perch` packs and serves at `/`.
// Kept as a script rather than a shell one-liner so it behaves the same on Windows CI.

import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "out");
const uiDir = path.join(here, "..", "..", "server", "ui");

if (!existsSync(out)) {
  console.error(`No static export at ${out}. Did \`next build\` run with output: "export"?`);
  process.exit(1);
}

rmSync(uiDir, { recursive: true, force: true });
cpSync(out, uiDir, { recursive: true });
console.log(`@perch/web: exported to ${path.relative(path.join(here, "..", "..", ".."), uiDir)}/`);
