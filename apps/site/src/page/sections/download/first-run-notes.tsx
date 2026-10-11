import type { ReactNode } from "react";
import { cn } from "../../../shared/cn";
import { useRelease } from "../../../shared/release";
import { code } from "../../layout/type";

const NOTES: { os: "darwin" | "windows"; name: string; text: ReactNode }[] = [
  {
    os: "darwin",
    name: "macOS",
    text: (
      <>
        Downloaded in a browser? Run <code className={code}>xattr -d com.apple.quarantine ./perch</code> once. The
        command above never needs it.
      </>
    ),
  },
  {
    os: "windows",
    name: "Windows",
    text: (
      <>
        SmartScreen warns the first time. Choose <span className="text-foreground">More info</span>, then{" "}
        <span className="text-foreground">Run anyway</span>.
      </>
    ),
  },
];

/** What a browser download meets on first run, this visitor's platform first. */
export function FirstRunNotes({ className }: { className?: string }) {
  const { os } = useRelease();
  const notes = os === "windows" ? [...NOTES].reverse() : NOTES;

  return (
    <dl aria-label="First run" className={cn("flex flex-col gap-5 text-sm", className)}>
      {notes.map((note) => (
        <div key={note.os} className="flex flex-col gap-1.5">
          <dt className="font-medium text-foreground">{note.name}</dt>
          <dd className="text-pretty text-muted-foreground">{note.text}</dd>
        </div>
      ))}
    </dl>
  );
}
