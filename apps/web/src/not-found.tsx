import { PerchLogo } from "@perch/ui";
import { Link } from "@tanstack/react-router";
import type * as React from "react";

/**
 * The 404, mounted as the root route's `notFoundComponent`. It matters more here than in a typical
 * app: the build is static and served by the `perch` server with an SPA fallback, so every stale
 * bookmark and mistyped deep link is handed this same bundle and lands here. It stays deliberately
 * plain — no chrome that implies a working connection.
 */
export function NotFound(): React.ReactElement {
  return (
    <main className="flex h-svh flex-col items-center justify-center gap-6 px-6 text-center">
      {/* The one piece of chrome this screen gets. A bookmark that lands here should still be able
          to tell what it landed on, and the logo says that without implying a live connection. */}
      <PerchLogo />

      <div className="flex flex-col gap-2">
        <p className="font-mono text-muted-foreground text-sm">404</p>
        <h1 className="font-medium text-xl tracking-tight">This page does not exist</h1>
        <p className="max-w-sm text-muted-foreground text-sm">
          The link may be from an older version of the app, or the path may be mistyped.
        </p>
      </div>

      <Link
        className="inline-flex h-8 items-center rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm outline-none transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring"
        to="/"
      >
        Back to the workspace
      </Link>
    </main>
  );
}
