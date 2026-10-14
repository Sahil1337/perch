import { cn } from "../../../shared/cn";
import { Slip } from "../../materials";
import type { TagRow } from "./tag-rows";

const TONE: Record<TagRow["tone"], string> = {
  muted: "text-paper-muted",
  ink: "",
  strong: "font-medium",
};

/**
 * A paper tag hanging from its knot. The knot is the top of this box, which the loop turns it about.
 * Every line keeps its height while the release loads, so nothing moves when the words arrive.
 */
export function Tag({ rows }: { rows: TagRow[] }) {
  return (
    <div data-tag="" className="absolute top-18.5 left-38 w-28 origin-top">
      <svg
        viewBox="0 0 8 20"
        stroke="currentColor"
        className="absolute -top-1 left-1/2 z-10 h-5 w-2 -translate-x-1/2 text-paper-muted"
      >
        <path d="M4 4v15" />
        <circle cx="4" cy="4" r="2.5" fill="currentColor" stroke="none" />
      </svg>
      <Slip className="mt-1.5 flex h-22 flex-col items-center rounded-t-xl px-2 pt-1 text-xs leading-4">
        <span className="size-2.5 shrink-0 rounded-full border-2 border-paper-edge" />
        <span className="mt-1.5 flex flex-col items-center">
          {rows.map((row, line) => (
            <span key={line} className={cn("flex h-4 items-center whitespace-nowrap", TONE[row.tone])}>
              {row.text ?? <span className="w-8 border-b border-dashed border-paper-muted/60" />}
            </span>
          ))}
        </span>
      </Slip>
    </div>
  );
}
