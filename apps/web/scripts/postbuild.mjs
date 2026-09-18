// Copies the built client into apps/server/ui/, which `perch` packs and serves at `/`.
// Kept as a script rather than a shell one-liner so it behaves the same on Windows CI.
//
// `dist/client` is the client half of a TanStack Start build; `dist/server` is the server half,
// which SPA mode only runs at build time to prerender the shell and which nothing ships.

import { cpSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "..", "dist", "client");
const uiDir = path.join(here, "..", "..", "server", "ui");

if (!existsSync(path.join(out, "index.html"))) {
  console.error(
    `No index.html in ${out}. The server serves that file for every unmatched path, so a build\n` +
      `without it is not servable — check the \`spa\` block in vite.config.ts.`,
  );
  process.exit(1);
}

rmSync(uiDir, { recursive: true, force: true });
cpSync(out, uiDir, { recursive: true });
console.log(`@perch/web: built to ${path.relative(path.join(here, "..", "..", ".."), uiDir)}/`);
