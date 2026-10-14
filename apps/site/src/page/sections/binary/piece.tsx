import { type Ref, useRef } from "react";
import { useRelease } from "../../../shared/release";
import { useLoop } from "../../materials";
import { Ingot } from "./ingot";
import { binaryLoop } from "./loop";
import { Tag } from "./tag";
import { tagRows } from "./tag-rows";
import { Thread } from "./thread";

/**
 * One binary: a porcelain bar glazed `perch`, with a paper tag tied on that gives the release's
 * version, this machine's platform and the real size of its build. The tag sways now and then.
 */
export function BinaryPiece({ perchRef }: { perchRef: Ref<HTMLElement> }) {
  const root = useRef<HTMLDivElement>(null);
  const release = useRelease();
  useLoop(root, binaryLoop);
  return (
    <div ref={root} aria-hidden className="flex size-full items-center justify-center">
      {/* Drawn at its size under lg and scaled up from lg, so the string stays tied to what it ties. */}
      <div className="relative h-44 w-68 shrink-0 lg:scale-150">
        <Ingot topRef={perchRef} />
        <Thread />
        <Tag rows={tagRows(release)} />
      </div>
    </div>
  );
}
