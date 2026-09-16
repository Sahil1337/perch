# Auto-format SQL (format on save + palette + settings)

Read: docs/design/prototype-spec.md (Editor section), packages/ui/src/workspace/sql-editor.tsx
(has `formatDocument` on Shift-Alt-F already, per statement, skipping dollar-quoted bodies),
packages/sql/src/*, packages/protocol/src/settings.ts (now has `formatOnSave` and `keywordCase`),
apps/web/lib/mock-workspace.tsx (`commitSave`), packages/ui/src/workspace/command-palette.tsx.

Files you own: packages/sql/src/format.ts (new) + index.ts export, packages/sql/package.json
(add sql-formatter as a dependency — it is already installed in the root node_modules; no
install needed), packages/ui/src/workspace/sql-editor.tsx (formatting parts only),
packages/ui/src/workspace/command-palette.tsx (one action), apps/web/lib/mock-workspace.tsx
(`commitSave` only). Do NOT touch apps/web/app/page.tsx, live-workspace.tsx (another agent is
writing it; it will call your export), onboarding/settings, or apps/server. Do not commit.

1. `packages/sql/src/format.ts`: move the per-statement formatting out of the editor into
   `formatSql(sql, { dialect, keywordCase }): Promise<string>` (lazy `import("sql-formatter")`,
   dialect → `postgresql`/`mysql`, keywordCase "preserve" → sql-formatter `preserve`, per
   statement via `splitStatements`, keep original text for statements that throw or contain a
   dollar-quoted body, preserve a trailing newline). Also `formatForSave(content, dialect,
   settings)` = identity unless `settings.formatOnSave`. Note packages/sql has a `check` script
   asserting split.ts is in sync with the server copy — do not break it (format.ts is frontend-only).
2. Editor: `formatDocument` calls `formatSql` with `keywordCase` from `useWorkspace().settings`
   (fallback "lower"); keep the cursor/selection sane (map through changes; at minimum restore
   the line). Add a "Format document ⇧⌥F" entry to the command palette that formats the active
   editor: the editor listens for a `CustomEvent("perch:format")` on `window` scoped by buffer id,
   or expose a tiny command registry in context — pick the cleaner one and say why.
3. Mock provider: in `commitSave`, apply `formatForSave` when `settings.formatOnSave` is on
   before marking saved (so the buffer content updates too).
Verify: `bun run --filter @perch/sql typecheck`, `bun run --filter @perch/sql check`, `cd packages/ui
&& npx tsc --noEmit -p tsconfig.json`, `cd apps/web && npx tsc --noEmit && npx eslint .`. No test
files (a throwaway node script to eyeball formatSql output on the sample query is fine — delete
it). Reply under 15 lines.
