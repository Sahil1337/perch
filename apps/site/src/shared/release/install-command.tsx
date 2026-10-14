import { Check, Copy } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { cn } from "../cn";
import { INSTALL_COMMAND } from "./release";
import { useCopyInstallCommand } from "./use-copy-install-command";

/** A row's own copy control: `copy` copies the command (or selects it if the clipboard says no). */
export type InstallCommandAction = (state: { copied: boolean; copy: () => void }) => ReactNode;

export type InstallCommandProps = {
  className?: string;
  /** After a successful copy: a moment for the bird to flutter. */
  onCopy?: () => void;
  /** Drawn at the end of the row in place of the Copy button. */
  action?: InstallCommandAction;
};

/** The exact `curl … | sh` line, scrollable on a narrow screen, with a Copy → Copied button. */
export function InstallCommand({ className, onCopy, action }: InstallCommandProps) {
  const { copied, copy } = useCopyInstallCommand(onCopy);
  const code = useRef<HTMLElement>(null);

  const copyOrSelect = async () => {
    // the clipboard said no: select the whole command so a keyboard copy still gets all of it
    if (!(await copy()) && code.current) getSelection()?.selectAllChildren(code.current);
  };

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-border bg-card py-1.5 pr-1.5 pl-3 font-mono text-sm text-card-foreground",
        className,
      )}
    >
      <div
        role="region"
        aria-label="Install command"
        tabIndex={0}
        className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto py-1 whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span aria-hidden className="text-muted-foreground select-none">
          $
        </span>
        <code ref={code}>{INSTALL_COMMAND}</code>
      </div>
      {action ? (
        action({ copied, copy: () => void copyOrSelect() })
      ) : (
        <button
          type="button"
          onClick={copyOrSelect}
          aria-label={copied ? "Install command copied" : "Copy install command"}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 font-sans text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {copied ? <Check aria-hidden className="size-3.5" /> : <Copy aria-hidden className="size-3.5" />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      )}
      <span role="status" className="sr-only">
        {copied ? "Install command copied" : ""}
      </span>
    </div>
  );
}
