import { type Ref, useRef } from "react";
import { useLoop } from "../../materials";
import { notebookLoop } from "./loop";
import { Strip } from "./strip";

/**
 * A notebook told in paper: the .sql file on one strip, torn into cells at its `-- %%` lines, each
 * cell printing its result on a slip of its own. The bird stands on the file's tab.
 */
export function NotebookPiece({ perchRef }: { perchRef: Ref<HTMLElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  useLoop(ref, notebookLoop);
  return (
    <div ref={ref} aria-hidden className="absolute inset-0 flex justify-center pt-14 lg:items-center lg:pt-0">
      <div className="relative isolate w-full max-w-sm pr-28 lg:max-w-md">
        <Strip tabRef={perchRef} />
      </div>
    </div>
  );
}
