import { cn } from "../../../shared/cn";
import { small } from "../../layout/type";
import type { ShortcutKey } from "./items";

type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

// The app labels its shortcuts ⌘ and ⌥ on a Mac and Ctrl and Alt everywhere else (hotkeyLabel in
// @perch/ui); the page says the same thing the visitor's copy of the app will.
const mac =
  typeof navigator === "undefined" ||
  /mac|iphone|ipad|ipod/i.test(
    (navigator as NavigatorWithUAData).userAgentData?.platform || navigator.platform || navigator.userAgent,
  );

const label = (key: ShortcutKey) => (key === "mod" ? (mac ? "⌘" : "Ctrl") : key === "alt" ? (mac ? "⌥" : "Alt") : key);

export function Keys({ keys, className }: { keys: readonly ShortcutKey[]; className?: string }) {
  return (
    <span className={cn("inline-flex shrink-0", className)}>
      <span className="sr-only">Shortcut: </span>
      <kbd className="inline-flex gap-1">
        {keys.map((key) => (
          <kbd
            key={key}
            className={cn(small, "inline-flex h-6 min-w-6 items-center justify-center rounded bg-muted px-1.5 font-mono leading-none")}
          >
            {label(key)}
          </kbd>
        ))}
      </kbd>
    </span>
  );
}
