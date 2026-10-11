import { cn } from "../../shared/cn";
import { useRelease } from "../../shared/release";
import { container } from "../layout/container";
import { Brand, GitHubIcon } from "./mark";
import { useScrolled } from "./use-scrolled";

const link =
  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

export function Nav() {
  const scrolled = useScrolled();
  const { version, releasesUrl } = useRelease();
  return (
    <header
      data-site-nav
      data-scrolled={scrolled || undefined}
      className="sticky top-0 z-50 isolate border-b border-transparent transition-colors duration-200 data-scrolled:border-border"
    >
      <div className={cn(container, "flex h-14 items-center justify-between gap-4 lg:h-16")}>
        <Brand />
        <nav aria-label="Site" className="flex items-center gap-0.5">
          <a href="#features" className={cn(link, "max-sm:hidden")}>
            Features
          </a>
          <a href="#download" className={link}>
            Download
          </a>
          {/* On a phone the mark alone, so the row fits a 320px screen with the version in it. */}
          <a href="https://github.com/Sahil1337/perch" className={link}>
            <GitHubIcon />
            <span className="max-sm:sr-only">GitHub</span>
          </a>
          {/* Holds its width before the release answers, so the links never shift. */}
          <a
            href={releasesUrl}
            aria-hidden={!version || undefined}
            tabIndex={version ? undefined : -1}
            className={cn(
              "ml-2 rounded-full border border-border px-2 py-0.5 font-mono text-xs text-muted-foreground tabular-nums transition-colors hover:border-input hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              !version && "invisible",
            )}
          >
            {version ?? "v0.0.0"}
          </a>
        </nav>
      </div>
    </header>
  );
}
