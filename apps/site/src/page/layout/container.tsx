import type { ReactNode, Ref } from "react";
import { cn } from "../../shared/cn";

/** The page's one measure: 1200px of content inside a 16 / 24 / 32px gutter. */
export const container = "mx-auto w-full max-w-316 px-4 sm:px-6 lg:px-8";

export function Container({
  className,
  children,
  ref,
}: {
  className?: string;
  children: ReactNode;
  ref?: Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={cn(container, className)}>
      {children}
    </div>
  );
}
