// Prototype A's whole type scale. Four sizes and mono, nothing else: every heading, paragraph and
// caption on the page takes one of these, so the rhythm cannot drift section by section.
// (@perch/ui redefines text-sm to 13px for desktop density; the page's small size is that.)

/** The one display size: the H1. */
export const display =
  "text-5xl/none font-semibold tracking-tighter text-balance text-foreground sm:text-6xl/none lg:text-7xl/none";

/** Every H2. */
export const heading =
  "text-3xl/9 font-semibold tracking-tight text-balance text-foreground sm:text-4xl/10 lg:text-5xl/13";

/** Body copy, the hero lede included. The measure stays inside 52–60ch at either size. */
export const body = "max-w-lg text-base/6.5 text-pretty text-muted-foreground lg:text-lg/7";

/** Meta lines, notes, nav, captions. */
export const small = "text-sm text-muted-foreground";

/** Mono for real things only: commands, file names, shortcuts, the version. */
export const code = "font-mono text-foreground";
