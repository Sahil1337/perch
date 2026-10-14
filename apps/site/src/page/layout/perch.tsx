import type { Ref } from "react";

/**
 * An invisible line at the top of its parent, as wide as the parent, for the bird to stand on: a
 * step's `at` (0..1) is measured along it. Lay it on a real edge, a window's top or a row of content;
 * a section's own line (`section`) stands for the section's heading, which the bird perches on instead.
 */
export function Perch({ ref, section }: { ref?: Ref<HTMLDivElement>; section?: boolean }) {
  return (
    <div
      ref={ref}
      aria-hidden
      data-section-perch={section || undefined}
      className="pointer-events-none absolute inset-x-0 top-0 h-px"
    />
  );
}
