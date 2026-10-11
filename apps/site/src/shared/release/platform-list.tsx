import { cn } from "../cn";
import { OS_NAMES } from "./release";
import { useRelease } from "./use-release";

export type PlatformListProps = {
  className?: string;
  /** Leave out this machine's own build (shown by DownloadButton). Default false. */
  excludePrimary?: boolean;
};

const PLATFORMS = ["darwin", "linux", "windows"] as const;

/**
 * Every build in the latest release, with checksums.txt and the releases page. When the release
 * cannot be read, each platform still links somewhere real: the releases page.
 */
export function PlatformList({ className, excludePrimary = false }: PlatformListProps) {
  const { status, assets, primary, releasesUrl, checksumsUrl } = useRelease();
  const rows = assets.filter((asset) => !(excludePrimary && asset === primary));

  return (
    <div className={cn("flex flex-col gap-3 text-sm", className)}>
      {status === "ready" && rows.length > 0 ? (
        <ul aria-label="Builds" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {rows.map((asset) => (
            <li key={asset.name}>
              <a
                href={asset.url}
                aria-label={`Download for ${asset.label}, ${asset.kind}, ${asset.sizeLabel}`}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex-1 text-foreground">{asset.label}</span>
                <span className="font-mono text-xs text-muted-foreground">{asset.kind}</span>
                <span className="w-16 text-right font-mono text-xs text-muted-foreground tabular-nums">
                  {asset.sizeLabel}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <ul aria-label="Platforms" className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {PLATFORMS.map((os) => (
            <li key={os}>
              <a
                href={releasesUrl}
                className="flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex-1 text-foreground">{OS_NAMES[os]}</span>
                <span className="text-xs text-muted-foreground">Releases page</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <p className="flex gap-4 text-muted-foreground">
        {checksumsUrl ? (
          <a href={checksumsUrl} className="underline-offset-4 hover:text-foreground hover:underline">
            checksums.txt
          </a>
        ) : null}
        <a href={releasesUrl} className="underline-offset-4 hover:text-foreground hover:underline">
          All releases
        </a>
      </p>
    </div>
  );
}
