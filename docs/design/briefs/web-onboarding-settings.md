# Onboarding flow + Settings surface (packages/ui)

Two new surfaces built on the workspace contract (packages/ui/src/workspace/types.ts — read it
whole; it now has addConnection/updateConnection/removeConnection/testConnection, settings with
formatOnSave + keywordCase, `source`). Components only; they read `useWorkspace()` and never
import @perch/client. Design system: packages/ui/src/ui/* primitives (Base UI, not Radix), tokens in
packages/ui/src/styles.css, motion from packages/ui/src/lib/motion.ts (SPRING/FADE, one spring,
respect reduced motion). Reference material you may port from (copy pixel-for-pixel, adapt
imports/tokens): the vendored component kit's onboarding wizard (stepper, pop-in/fade-up
keyframes) and its Base UI primitives — dialog, switch, select, field, label, radio-group. Port
only what you use into packages/ui/src/ui/ and export them.

Files you own: packages/ui/src/onboarding/**, packages/ui/src/settings/**, packages/ui/src/ui/
{dialog,switch,select,field,label,radio-group}.tsx (ported), packages/ui/src/index.ts (add
exports), packages/ui/src/styles.css (additive keyframes only). Do NOT edit apps/web/app/page.tsx,
apps/web/lib/*, other workspace components, or apps/server. No new packages. Do not commit.

## 1. Onboarding — `<Onboarding onDone={() => void} />` + `useNeedsOnboarding(): boolean`
Shown full-screen (over the workspace, bg-background) the first time, like VS Code's welcome:
- `useNeedsOnboarding` = settings ready && (workspaces empty || connections empty) &&
  !localStorage["perch.onboarded"]. Provide `markOnboarded()`.
- Layout: centered card max-w-xl, a left rail stepper (port the wizard's stepper with its
  progress line and pop-in checks), the step content on the right; steps slide (x ±16, opacity)
  with AnimatePresence mode="wait" using SPRING; a "Skip for now" link bottom-left; primary
  button bottom-right ("Continue" / "Finish").
- Steps:
  1. Welcome — product name "perch" (see apps/web/app/layout.tsx), one sentence, the three
     things it does (connect, query, files) as three small rows with lucide icons; no marketing.
  2. Workspace — "Where do your .sql files live?" one path Input with a folder icon, placeholder
     `/Users/you/queries`, helper text "Absolute path; the server reads and writes only here."
     Adds it via `updateSettings({ workspaces: [...roots, path] })`. Allow skipping.
  3. Connection — dialect choice as two selectable cards (Postgres / MySQL, with a small SVG
     mark drawn inline, no brand logos), then the form: name, then either a URL field OR the
     expanded fields (a "Use URL" / "Use fields" toggle, both animated height), password field.
     "Test" secondary button: `addConnection` then `testConnection`; show latency + server
     version in a success row (check icon pops in) or the error message inline; the primary
     button becomes "Continue" only after a save. Existing connections (if any) listed above to
     pick instead.
  4. Database — pick from `databases` (radio list, current pre-selected, skeleton while
     loading); `connect(id, db)`.
  5. Done — a check that pops in, "You're set", the three choices summarised, "Open workspace".
- Keyboard: Enter advances when the step is valid; Esc = skip.

## 2. Settings — `<SettingsDialog open onOpenChange />` + `<SettingsButton />` (the gear)
A Dialog (ported), width 720, height 520, left nav (Editor / Query / Files / Connections /
Appearance) with the motion layoutId active indicator; right pane scrolls. Every control writes
through `updateSettings` immediately (optimistic; show a subtle "Saved" tick that fades) — no
Save button. Sections:
- Editor: Format on save (Switch), Keyword case (Select: preserve/upper/lower), and a live
  example line that re-renders with the chosen case.
- Query: Max rows (number Input, 100–100000), Statement timeout ms (0 = none), with one-line
  help each.
- Files: Autosave (Switch) + delay (number), Workspaces list (each row: path in mono, remove
  icon button) + add path input.
- Connections: list rows (dot by status, name, dialect·host:port/db, Test / Edit / Remove);
  Edit opens the same connection form as onboarding step 3 inline (share the component:
  `packages/ui/src/onboarding/connection-form.tsx` is used by both); Add.
- Appearance: Theme radio (dark active; light/system disabled with "coming soon") and the
  editor font size (localStorage `perch.editor.fontSize`, expose `useEditorFontSize()`; the
  editor may consume it later).
- The gear: `<SettingsButton />` renders the icon button + dialog; hotkey ⌘, opens it.

Quality bar: senior design engineer. Consistent 8px rhythm, 13px body, muted helper text, no
emoji, no gradients, tokens only. Every async action has loading/success/error states. Nothing
mounted twice. `cd packages/ui && npx tsc --noEmit -p tsconfig.json` clean; `cd apps/web && npx
tsc --noEmit && npx eslint .` clean (exports only; page integration is not yours). No test
files. Reply under 25 lines: files, exported names + props, anything you chose differently.
