import { AnimatePresence, motion } from "motion/react";
import { useCollapse } from "../../lib/motion";
import * as React from "react";
import { Skeleton } from "../../ui/skeleton";
import { SKELETON_ROWS } from "./utils";

export function Disclosure({
  children,
  open,
}: {
  children: React.ReactNode;
  open: boolean;
}): React.ReactElement {
  const collapse = useCollapse();

  return (
    <AnimatePresence initial={false}>
      {open && (
        <motion.div
          animate={{ height: "auto", opacity: 1 }}
          className="overflow-hidden"
          exit={{ height: 0, opacity: 0 }}
          initial={{ height: 0, opacity: 0 }}
          transition={collapse}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function SchemaSkeleton(): React.ReactElement {
  return (
    <div aria-label="Loading schema" role="status">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div className="flex h-7 items-center gap-1.5 ps-6 pe-2" key={index}>
          <Skeleton className="size-3.5 shrink-0" />
          <Skeleton className="h-3 w-32 max-w-full" />
        </div>
      ))}
    </div>
  );
}
