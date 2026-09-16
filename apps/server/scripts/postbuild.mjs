// Marks the built CLI executable. Kept as a file rather than an inline `node -e` one-liner:
// the quoting survives npm, zsh and PowerShell alike, and Windows has no chmod.

import { chmodSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli", "main.js");
chmodSync(cli, 0o755);
