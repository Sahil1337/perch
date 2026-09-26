// The sidebar's three panes, and the strip that switches them.
//
// The same two motions as the settings dialog, because it is the same gesture: one indicator that
// slides between the tabs rather than three that blink, and a crossfade where a cut would
// otherwise land. The strip is <Tabs>, whose indicator already slides; the crossfade reads its
// timing from lib/motion, so the two surfaces cannot drift apart.

import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useFade } from "../lib/motion";
import { Tabs, TabsList, TabsTab } from "../ui/tabs";
import type { SidebarTab } from "./types";

const TABS: readonly { value: SidebarTab; label: string }[] = [
  { value: "schema", label: "Schema" },
  { value: "files", label: "Files" },
  { value: "history", label: "History" },
];

export function SidebarTabs({
  tab,
  onTabChange,
  children,
}: {
  tab: SidebarTab;
  onTabChange: (tab: SidebarTab) => void;
  /** The pane for `tab`. Swapped and keyed by it, so changing tabs crossfades. */
  children: React.ReactNode;
}): React.ReactElement {
  const fade = useFade();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-2">
        <Tabs
          onValueChange={(value) => onTabChange(value as SidebarTab)}
          value={tab}
        >
          <TabsList className="w-full" size="sm">
            {TABS.map((item) => (
              <TabsTab className="flex-1" key={item.value} value={item.value}>
                {item.label}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {/* `popLayout`, as in the settings dialog: `wait` would leave this region empty for the
          length of both transitions, and an empty region is a collapsed one. */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <AnimatePresence initial={false} mode="popLayout">
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className="h-full"
            exit={{ opacity: 0, y: -4 }}
            initial={{ opacity: 0, y: 4 }}
            key={tab}
            transition={fade}
          >
            {children}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
