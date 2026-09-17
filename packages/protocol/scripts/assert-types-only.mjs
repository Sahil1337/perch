// @perch/protocol is consumed as raw .ts source by both a NodeNext build (apps/server) and a
// bundler (apps/web). That only works because every export is a type: TypeScript erases the
// imports entirely, so the contract never reaches a runtime bundle and needs no build step.
// One runtime value (a const, an enum, a function) would silently break that. This guards it.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src");
const RUNTIME_EXPORT = /^export\s+(?!type\b)(const|let|var|function|class|enum|default\b)/m;

const offenders = [];
for (const entry of readdirSync(srcDir, { withFileTypes: true, recursive: true })) {
  if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
  const file = path.join(entry.parentPath ?? srcDir, entry.name);
  const source = readFileSync(file, "utf8");
  for (const [i, line] of source.split("\n").entries()) {
    if (RUNTIME_EXPORT.test(line))
      offenders.push(`${path.relative(srcDir, file)}:${i + 1}  ${line.trim()}`);
  }
}

if (offenders.length > 0) {
  console.error(
    "@perch/protocol must export types only. Runtime exports found:\n  " + offenders.join("\n  "),
  );
  console.error("\nMove the value into the package that owns it (apps/server, or @perch/client).");
  process.exit(1);
}
console.log(`@perch/protocol: types-only check passed`);
