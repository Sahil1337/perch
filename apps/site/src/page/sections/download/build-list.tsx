import { cn } from "../../../shared/cn";
import { type Arch, type OS, useRelease } from "../../../shared/release";

// Every build the release workflow ships, in release.ts's order. The rows are drawn from this
// rather than from the API, so the list is the same five rows before, during and without it; the
// release only fills in each row's link and size.
const BUILDS: { os: Exclude<OS, "unknown">; arch: Arch; label: string }[] = [
  { os: "darwin", arch: "arm64", label: "macOS · Apple silicon" },
  { os: "darwin", arch: "amd64", label: "macOS · Intel" },
  { os: "linux", arch: "amd64", label: "Linux · x86-64" },
  { os: "linux", arch: "arm64", label: "Linux · ARM64" },
  { os: "windows", arch: "amd64", label: "Windows · x64" },
];

/** Every build as a list of links, platform and size, with this machine's marked. */
export function BuildList({ className }: { className?: string }) {
  const { assets, primary, releasesUrl } = useRelease();

  return (
    <ul
      aria-label="Every build"
      className={cn("flex flex-col divide-y divide-border rounded-lg border border-border text-sm", className)}
    >
      {BUILDS.map((build) => {
        const asset = assets.find((a) => a.os === build.os && a.arch === build.arch);
        const mine = asset !== undefined && asset === primary;
        return (
          <li key={`${build.os}-${build.arch}`}>
            <a
              href={asset?.url ?? releasesUrl}
              aria-label={
                asset
                  ? `Download for ${build.label}, ${asset.sizeLabel}${mine ? ", this machine" : ""}`
                  : `${build.label}, on the releases page`
              }
              className="flex items-center gap-3 px-3 py-2 transition-colors lg:py-1.5 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <span className="min-w-0 flex-1 truncate text-foreground">{build.label}</span>
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
