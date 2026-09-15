// Package version, resolved from package.json when running from source or an npm install.
// Inside a single-file binary (bun --compile) package.json is not on disk — and the relative
// walk can land on a *different* package.json (the monorepo root, when the binary was built from
// this workspace) — so the name is checked before the version is believed, and anything else
// falls back to the value baked in here. Keep FALLBACK_VERSION in sync with package.json.
import { createRequire } from "node:module";

const PACKAGE_NAME = "perch";
const FALLBACK_VERSION = "0.1.0";

export const VERSION: string = (() => {
  try {
    const pkg = createRequire(import.meta.url)("../../package.json") as {
      name?: string;
      version?: string;
    };
    if (pkg.name !== PACKAGE_NAME) return FALLBACK_VERSION;
    return pkg.version ?? FALLBACK_VERSION;
  } catch {
    return FALLBACK_VERSION;
  }
})();
