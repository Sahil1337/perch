// ESLint config for the perch monorepo: one config, every workspace, one ESLint 10.
//
// apps/web used to be the exception — eslint-config-next bundled an eslint-plugin-react that still
// called the context.getFilename() ESLint 10 removed, so the app pinned ESLint 9 behind a nested
// config and the root `lint` script shelled out to it. Next is gone and so is the pin.
//
// Flat-config `files` globs resolve against this file's directory, so the paths below are
// repo-relative however eslint is invoked.

import { plugin as shadcn } from "@shadcn/lint";
import js from "@eslint/js";
import tseslint from "typescript-eslint";

const base = tseslint.config(js.configs.recommended, ...tseslint.configs.recommended, {
  rules: {
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "@typescript-eslint/consistent-type-imports": [
      "warn",
      { prefer: "type-imports", fixStyle: "inline-type-imports" },
    ],
  },
});

/**
 * The design system, enforced. Tailwind first: theme tokens rather than raw colors, real utilities
 * rather than arbitrary values, and plain CSS only for what Tailwind cannot express (keyframes).
 *
 * `packages/ui/src/ui/**` is excluded — it is vendored registry output, and regenerating a component
 * would undo anything fixed there. The cost is real, so re-run the class check over it by hand after
 * adding or updating a component:
 *     bunx eslint packages/ui/src/ui --rule '{"shadcn/no-unknown-classes":"error"}'
 * Expect false positives for tw-animate-css utilities, which the linter cannot see because
 * packages/ui has no Tailwind entry point of its own.
 */
const shadcnRules = {
  // Only layout is a surface's business. Spacing was tried as an allowance and turned out not to
  // be needed — every violation it would have permitted had a better fix in the primitive's own
  // size/variant. Colour, shape and effects stay owned by the primitive.
  "shadcn/no-restyle": ["error", { allow: ["layout"] }],
  "shadcn/no-raw-colors": "error",
  "shadcn/no-unknown-classes": "error",
  "shadcn/require-static-classes": "error",
  "shadcn/no-arbitrary-values": "error",
  "shadcn/no-inline-styles": "error",
};

const designSystem = [
  {
    files: ["apps/web/src/**/*.{ts,tsx}"],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: "@perch/ui",
        // The app only ever reaches primitives by package name.
        componentImports: ["^@perch/ui(/|$)"],
      },
    },
    rules: shadcnRules,
  },
  {
    files: ["packages/ui/src/**/*.{ts,tsx}"],
    ignores: ["packages/ui/src/ui/**"],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: "@perch/ui",
        // Apps import primitives as "@perch/ui"; files inside the package reach them by relative
        // path, from one or two levels down. Without every pattern no-restyle silently matches
        // nothing here.
        componentImports: [
          "^@perch/ui(/|$)",
          "^\\.\\./\\.\\./ui(/|$)",
          "^\\.\\./ui(/|$)",
          "^\\./ui(/|$)",
        ],
      },
    },
    rules: shadcnRules,
  },
];

export default [
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      // The web bundle the server ships, and the copy staged for embedding.
      "apps/server/ui/**",
      "apps/server/webui/static/**",
      // Written by the TanStack Start plugin on every dev start and build, and gitignored.
      "apps/web/src/routeTree.gen.ts",
    ],
  },
  ...base,
  ...designSystem,
];
