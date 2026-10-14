import { Check, Laptop } from "lucide-react";
import { useEffect, useState } from "react";

// How long "Link copied" stands in for the pill's label.
const COPIED_MS = 2200;

/**
 * The window's pill on a phone, where the editor stays the demo's: a touch keyboard over a cropped,
 * moving window is no way to write SQL. It sends the page on to a computer instead, through the
 * share sheet where there is one, or by copying its address.
 */
export function SendPill() {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const send = async () => {
    const url = location.origin + location.pathname;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (error) {
        // Closing the sheet is an answer; anything else falls through to the copy.
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // No clipboard either (an insecure origin): the address bar still has the link.
    }
  };

  return (
    // On the window's bottom edge: at a phone's size the top edge is the titlebar's address, and
    // the bird's perch.
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex translate-y-1/2 justify-center">
      <button
        type="button"
        data-try-pill=""
        onClick={() => void send()}
        className="pointer-events-auto flex h-8 items-center gap-2 rounded-full bg-porcelain px-3.5 font-medium text-paper-ink text-sm shadow-(--bui-shadow-overlay) transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-glaze focus-visible:outline-offset-2"
      >
        {copied ? <Check aria-hidden className="size-3.5" /> : <Laptop aria-hidden className="size-3.5" />}
        <span aria-live="polite">{copied ? "Link copied" : "Send to my computer"}</span>
      </button>
    </div>
  );
}
