import { cn } from "../../shared/cn";

/**
 * The ↵ glazed on the first view's return key, drawn as a line: no face on the page carries the
 * glyph legibly at a key's size, and the font's own arrow would come from a fallback face.
 */
export function ReturnGlyph({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 24 14" fill="none" stroke="currentColor" className={cn("shrink-0", className)}>
      <path d="M22 1v8H2m5-4.5L2 9l5 4.5" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
