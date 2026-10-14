import type { Ref } from "react";

/**
 * The binary as a bar of porcelain, like a cake of soap: a lit top face a hair narrower than its
 * base, a deep skirt and a soft contact shadow, with `perch` fired into the glaze. Its legend sits
 * left of the string tied round the bar's right end.
 */
export function Ingot({ topRef }: { topRef: Ref<HTMLElement> }) {
  return (
    <div className="absolute top-10 left-0 h-17 w-36">
      <span className="porcelain-contact absolute -inset-x-2 -bottom-2.5 h-6" />
      <span className="porcelain-skirt absolute inset-x-0 top-2 bottom-0 rounded-2xl" />
      <span
        ref={topRef}
        className="porcelain absolute inset-x-0.75 top-0 flex h-14 items-center justify-center rounded-2xl pr-6 font-mono text-2xl leading-none text-glaze"
      >
        perch
      </span>
    </div>
  );
}
