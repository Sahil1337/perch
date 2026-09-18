import { THEME_BOOT_SCRIPT } from "@perch/ui";
import { createRootRoute, HeadContent, Scripts } from "@tanstack/react-router";
import type * as React from "react";
import { NotFound } from "@/not-found";
import appCss from "@/styles.css?url";

// The product is "Perch"; the command, the scopes and `~/.perch` stay lowercase. The tab is the
// only label a local tool gets, so a route with something more specific to say — a database name,
// with several windows open on several databases — sets its own `title` here, which wins over this
// one. That is also why only the overridable half of the head lives in `head()`; the fixed half is
// written out in the shell below.
//
// No canonical URL, no Open Graph: this is served from loopback by the user's own machine, so there
// is nothing to link to and nothing to unfurl.
export const Route = createRootRoute({
  head: () => ({
    meta: [
      { title: "Perch" },
      { name: "description", content: "A fast, local SQL client for Postgres and MySQL." },
      { name: "application-name", content: "Perch" },
    ],
    links: [
      // A real <link> in the prerendered shell rather than a stylesheet the bundle injects once it
      // boots: the latter is a frame of unstyled markup on every cold load.
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
    ],
  }),
  notFoundComponent: NotFound,
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html
      className="dark h-full antialiased"
      lang="en"
      // The boot script may take `dark` off before React hydrates, which is the point of it.
      suppressHydrationWarning
    >
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        {/* The browser chrome, matched to the app's own surfaces so a dark UI is not framed in
            white. Written here rather than in `head()` because the router keys route meta by
            `name` and drops the duplicate, and these two differ only by `media`. */}
        <meta content="dark light" name="color-scheme" />
        <meta content="#ffffff" media="(prefers-color-scheme: light)" name="theme-color" />
        <meta content="#0a0a0a" media="(prefers-color-scheme: dark)" name="theme-color" />
        {/* Blocking, and as early as React will place it: a theme applied after the first paint is
            a flash, not a theme. React hoists <meta> and <link> above any inline script, so this
            lands under them — still parsed and run before the body, which is what matters. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
        <HeadContent />
      </head>
      <body className="h-full overflow-hidden bg-background text-foreground">
        {children}
        <Scripts />
      </body>
    </html>
  );
}
