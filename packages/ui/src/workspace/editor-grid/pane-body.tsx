import { motion } from "motion/react";
import * as React from "react";
import { useWorkspace } from "../context";
import { Notebook } from "../notebook";
import { paneBufferId, type PaneId } from "../pane-layout";
import { ResultsPanel } from "../results-panel";
import { SqlEditor } from "../sql-editor";
import { ConflictBar } from "./conflict-bar";
import { useGrid } from "./grid-context";

/**
 * How long the results pane takes to drop out of sight, in ms. It cannot simply be removed from the
 * layout — `reconcile` would reclaim the space on the same frame and the editor would snap taller —
 * so the tree keeps it for exactly this long. Must stay in step with the transition below.
 */
export const RESULTS_EXIT_MS = 260;

export function PaneBody({ pane }: { pane: PaneId }): React.ReactElement | null {
  const { buffers } = useWorkspace();
  const { resultsLeaving } = useGrid();
  const bufferId = paneBufferId(pane);

  // Out through the bottom edge it arrived on: any other exit reads as the pane being deleted.
  if (bufferId === null) {
    return (
      <motion.div
        animate={{ y: resultsLeaving ? "100%" : 0 }}
        className="h-full overflow-hidden"
        initial={false}
        transition={{ duration: RESULTS_EXIT_MS / 1000, ease: [0.4, 0, 1, 1] }}
      >
        <ResultsPanel className="h-full" />
      </motion.div>
    );
  }

  const buffer = buffers.find((candidate) => candidate.id === bufferId);
  if (!buffer) return null;

  // A notebook puts each result under the cell that produced it; the pane has nothing to add.
  const editor =
    buffer.view === "notebook" ? (
      <Notebook className="h-full min-h-0" fileId={buffer.id} key={buffer.id} />
    ) : (
      <SqlEditor className="h-full min-h-0" fileId={buffer.id} key={buffer.id} />
    );

  if (buffer.conflict === undefined) return editor;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ConflictBar buffer={buffer} />
      <div className="min-h-0 flex-1">{editor}</div>
    </div>
  );
}
