import { useEffect, useRef, useState } from "react";
import { INSTALL_COMMAND } from "./release";

const COPIED_MS = 1600;

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type CopyInstallCommand = {
  /** True for a moment after a successful copy. */
  copied: boolean;
  /** Copies the install command; false when the clipboard said no. */
  copy: () => Promise<boolean>;
};

/** Copies the `curl … | sh` line, says so for a moment, and calls `onCopy` (the bird's flutter). */
export function useCopyInstallCommand(onCopy?: () => void): CopyInstallCommand {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = async () => {
    if (!(await copyText(INSTALL_COMMAND))) return false;
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
    onCopy?.();
    return true;
  };

  return { copied, copy };
}
