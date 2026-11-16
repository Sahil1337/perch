import { cn } from "../../../shared/cn";
import { BUILDS, useRelease } from "../../../shared/release";

/**
 * Every build as a list of links, platform and size, with this machine's marked. The rows are drawn
 * from release.ts's BUILDS rather than from the API, so the list is the same six rows before,
 * during and without it; the release only fills in each row's link and size.
 */
export function BuildList({ className }: { className?: string }) {
  const { assets, primary, releasesUrl } = useRelease();

  return (
    <ul
      aria-label="Every build"
      className={cn("flex flex-col divide-y divide-border rounded-lg border border-border text-sm", className)}
    >
      {BUILDS.map((build) => {
        const asset = assets.find(
          (a) => a.os === build.os && a.arch === build.arch && a.installer === build.installer,
        );
        const mine = asset !== undefined && asset === primary;
        const portable = build.os === "windows" && !build.installer;
        return (
          <li key={`${build.os}-${build.arch}${build.installer ? "-installer" : ""}`}>
            <a
              href={asset?.url ?? releasesUrl}
              aria-label={
                asset
                  ? `Download for ${build.label}${portable ? ", no install" : ""}, ${asset.sizeLabel}${mine ? ", this machine" : ""}`
                  : `${build.label}, on the releases page`
              }
              className="flex items-center gap-3 px-3 py-2 transition-colors lg:py-1.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{build.label}</span>
              {portable ? <span className="text-xs text-muted-foreground">no install</span> : null}
              {mine ? <span className="text-xs text-muted-foreground">This machine</span> : null}
              <span className="w-16 text-right font-mono text-xs text-muted-foreground tabular-nums">
                {asset?.sizeLabel}
              </span>
            </a>
          </li>
        );
      })}
    </ul>
  );
}
