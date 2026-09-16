// This app pins ESLint 9 (its own nested copy) while the rest of the monorepo runs ESLint 10 from
// the root eslint.config.js: eslint-config-next bundles an eslint-plugin-react that still calls
// the context.getFilename() ESLint 10 removed. ESLint stops at this file and never reaches the
// root config.
//
// @shadcn/lint enforces the design system: the rule is Tailwind first, theme tokens only, and
// plain CSS only for what Tailwind cannot express (keyframes). The errors are written to be
// actionable by an agent, which is the point of having it here rather than in review.

import { plugin as shadcn } from "@shadcn/lint";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["**/*.{ts,tsx}"],
    plugins: { shadcn },
    settings: {
      shadcn: {
        ui: "@perch/ui",
        componentImports: ["^@perch/ui(/|$)"],
      },
    },
    rules: {
      "shadcn/no-restyle": ["error", { allow: ["layout"] }],
      "shadcn/no-raw-colors": "error",
      "shadcn/no-arbitrary-values": "error",
      "shadcn/no-inline-styles": "error",
      "shadcn/no-unknown-classes": "error",
      "shadcn/require-static-classes": "error",
      // Matches the root config, so a `_`-prefixed throwaway means the same thing in both.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // The vendored shadcn/Base UI primitives ARE the design system: defining variants and base
    // classes is their job, so the restyling rule cannot apply to them.
    files: ["../../packages/ui/src/ui/**"],
    rules: { "shadcn/no-restyle": "off" },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts"]),
]);

export default eslintConfig;
