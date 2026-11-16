import { Download } from "lucide-react";
import { cn } from "../cn";
import { OS_NAMES } from "./release";
import { useRelease } from "./use-release";

export type DownloadButtonProps = {
  /** On the button itself, also when Windows puts the single .exe line under it. */
  className?: string;
};

/**
 * The build for this machine. Before the release API answers, and whenever it cannot, the link is
 * the releases page, so the button never goes nowhere. On Windows, when the button is the
 * installer, a line under it offers the single .exe.
 */
export function DownloadButton({ className }: DownloadButtonProps) {
  const { os, mobile, primary, binary, releasesUrl, version } = useRelease();
  const label = mobile
    ? "Get Perch for macOS, Linux or Windows"
    : os === "unknown"
      ? "Download Perch"
      : `Download for ${OS_NAMES[os]}`;
  const href = !mobile && primary ? primary.url : releasesUrl;
  const title = primary && !mobile ? `${version} · ${primary.label} · ${primary.sizeLabel}` : undefined;

  const button = (
    <a
      href={href}
      title={title}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none",
        className,
      )}
    >
      {/* On a phone it links to the builds rather than downloading one, and at 320px the label
          needs the icon's room to stay on one line. */}
      {mobile ? null : <Download aria-hidden className="size-4" />}
      <span className="whitespace-nowrap">{label}</span>
    </a>
  );
  if (mobile || os !== "windows") return button;

  // The line holds its room from the first paint and only shows once the release has an installer:
  // the landing's copy is centred, so a line arriving later would move the headline the bird stands on.
  const single = primary?.installer ? binary : undefined;
  return (
    <div className="flex shrink-0 flex-col gap-1.5">
      {button}
      <a
        href={single?.url ?? releasesUrl}
        title={single ? `${version} · ${single.label} · ${single.sizeLabel}` : undefined}
        className={cn(
          "text-center text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
          !single && "invisible",
        )}
      >
        or the single .exe
      </a>
    </div>
  );
}
