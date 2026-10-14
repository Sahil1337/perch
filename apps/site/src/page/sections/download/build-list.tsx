import { cn } from "../../../shared/cn";
import { type Arch, type OS, useRelease } from "../../../shared/release";

// Every build the release workflow ships, in release.ts's order. The rows are drawn from this
// rather than from the API, so the table is the same five rows before, during and without it; the
// release only fills in each row's link and size.
const BUILDS: { os: Exclude<OS, "unknown">; arch: Arch; label: string; kind: ".tar.gz" | ".exe" }[] = [
  { os: "darwin", arch: "arm64", label: "macOS · Apple silicon", kind: ".tar.gz" },
  { os: "darwin", arch: "amd64", label: "macOS · Intel", kind: ".tar.gz" },
  { os: "linux", arch: "amd64", label: "Linux · x86-64", kind: ".tar.gz" },
  { os: "linux", arch: "arm64", label: "Linux · ARM64", kind: ".tar.gz" },
  { os: "windows", arch: "amd64", label: "Windows · x64", kind: ".exe" },
];

const link = "underline-offset-4 transition-colors hover:text-foreground hover:underline";

/** Every build as a table of links (platform, file kind, size), then checksums and releases. */
export function BuildList({ className }: { className?: string }) {
  const { assets, primary, releasesUrl, checksumsUrl } = useRelease();

  return (
    <div className={cn("flex flex-col gap-3 text-sm", className)}>
      <ul aria-label="Every build" className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {BUILDS.map((build) => {
          const asset = assets.find((a) => a.os === build.os && a.arch === build.arch);
          const mine = asset !== undefined && asset === primary;
          return (
            <li key={`${build.os}-${build.arch}`}>
              <a
                href={asset?.url ?? releasesUrl}
                aria-label={
                  asset
                    ? `Download for ${build.label}, ${build.kind}, ${asset.sizeLabel}${mine ? ", this machine" : ""}`
                    : `${build.label}, on the releases page`
                }
                className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 truncate text-foreground">{build.label}</span>
                {mine ? <span className="text-xs text-muted-foreground">This machine</span> : null}
                <span className="w-12 font-mono text-xs text-muted-foreground">{build.kind}</span>
                <span className="w-16 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {asset?.sizeLabel}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      {/* checksums.txt is listed on the releases page too, so before the release answers that is
          where it points, and the line never changes shape. */}
      <p className="flex gap-4 text-muted-foreground">
        <a href={checksumsUrl ?? releasesUrl} className={link}>
          checksums.txt
        </a>
        <a href={releasesUrl} className={link}>
          All releases
        </a>
      </p>
    </div>
  );
}
