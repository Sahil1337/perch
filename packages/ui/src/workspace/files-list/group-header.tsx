import { ChevronRightIcon } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { useFade } from "../../lib/motion";

/**
 * The label over a group of rows, and the home for that group's actions.
 *
 * One component for both groups, because they had drifted into two different headings — "Open" was
 * a bare label, "Workspace" a bordered strip with buttons on it — and a panel whose two sections
 * cannot agree on what a heading looks like reads as two panels that happen to be stacked. The
 * border is gone with them: the type is quiet enough to separate the groups on its own, and a rule
 * every 28px is what made this tab look like a form.
 *
 * `onToggle` makes the group foldable; the count is the reason folding is worth offering, since it
 * is the thing you still want to know once the list is shut.
 */
export function GroupHeader({
  label,
  count,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  count?: number;
  expanded?: boolean;
  onToggle?: () => void;
  children?: React.ReactNode;
}): React.ReactElement {
  const fade = useFade();

  const title = (
    <>
      {onToggle !== undefined && (
        <motion.span
          animate={{ rotate: expanded === true ? 90 : 0 }}
          className="flex shrink-0 text-muted-foreground"
          initial={false}
          transition={fade}
        >
          <ChevronRightIcon className="size-3.5" />
        </motion.span>
      )}
      <span className="truncate font-medium text-muted-foreground text-xs">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="shrink-0 text-muted-foreground/72 text-xs tabular-nums">{count}</span>
      )}
    </>
  );

  return (
    // Sticky so the label survives its own list being scrolled; the sidebar's own background,
    // because a transparent sticky header shows the rows sliding under it.
    <div className="sticky top-0 z-10 flex h-7 shrink-0 items-center gap-1.5 bg-sidebar px-2">
      {onToggle === undefined ? (
        <span className="flex min-w-0 flex-1 items-center gap-1.5">{title}</span>
      ) : (
        <button
          aria-expanded={expanded}
          className="-outline-offset-2 flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-ring"
          onClick={onToggle}
          type="button"
        >
          {title}
        </button>
      )}
      {children}
    </div>
  );
}
