import type { ReactNode } from "react";
import { cn } from "../../../shared/cn";
import { useRelease } from "../../../shared/release";
import { code, small } from "../../layout/type";

// The binaries aren't signed yet, so a browser download meets one warning on these two. Linux and the
// install command never do.
const NOTES: Partial<Record<string, ReactNode>> = {
  darwin: (
    <>
      On macOS, run <code className={code}>xattr -d com.apple.quarantine ./perch</code> once after a browser
      download.
    </>
  ),
  windows: (
    <>
      On Windows, SmartScreen warns the first time: choose <span className="text-foreground">More info</span>, then{" "}
      <span className="text-foreground">Run anyway</span>.
    </>
  ),
};

/** The one first-run step a browser download needs on this visitor's platform, if it needs any. */
export function FirstRunNote({ className }: { className?: string }) {
  const { os } = useRelease();
  const note = NOTES[os];
  return note ? <p className={cn(small, "text-pretty", className)}>{note}</p> : null;
}
