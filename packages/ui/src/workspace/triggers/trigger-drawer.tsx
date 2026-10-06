import { XIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { Button } from "../../ui/button";
import type { LaneMotion } from "./lane-motion";

/**
 * The side drawer, over the right of the lane rather than beside it: the lane keeps its width, so
 * opening a trigger never reflows the columns the reader was looking at. It is only the frame; a
 * face (the detail or the form) fills it and owns its own scrolling and footer.
 */
export function TriggerDrawer({
  children,
  closeDisabled,
  faceKey,
  label,
  motion: laneMotion,
  onClose,
  open,
  title,
}: {
  children: React.ReactNode;
  /** A change is running, and the drawer stays until it lands. */
  closeDisabled: boolean;
  /** Changes whenever the face does, so one face cross-fades into the next rather than morphing. */
  faceKey: string;
  label: string;
  motion: LaneMotion;
  onClose: () => void;
  open: boolean;
  title: React.ReactNode;
}): React.ReactElement {
  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          animate={{ x: 0 }}
          aria-label={label}
          className="absolute inset-y-0 end-0 z-20 flex w-118 max-w-full flex-col border-s bg-popover shadow-lg"
          exit={{ x: "100%", transition: laneMotion.drawerExit }}
          initial={{ x: "100%" }}
          key="drawer"
          transition={laneMotion.drawer}
        >
          <header className="flex shrink-0 items-center gap-2 border-b py-2 ps-4 pe-2">
            <h2 className="min-w-0 flex-1 truncate font-medium text-sm">{title}</h2>
            <Button
              aria-label="Close drawer"
              disabled={closeDisabled}
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <XIcon />
            </Button>
          </header>
          <motion.div
            animate={{ opacity: 1 }}
            className="flex min-h-0 flex-1 flex-col"
            initial={{ opacity: 0 }}
            key={faceKey}
            transition={laneMotion.fade}
          >
            {children}
          </motion.div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}
