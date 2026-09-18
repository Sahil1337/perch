import * as React from "react";
import { type EditorLayout, type PaneId } from "../pane-layout";
import { type DropTarget } from "./dnd";

export type GridContextValue = {
  layout: EditorLayout;
  drop: DropTarget | null;
  /** The results pane is on its way out; see `RESULTS_EXIT_MS`. */
  resultsLeaving: boolean;
  activate: (groupId: string, pane: PaneId) => void;
  close: (pane: PaneId) => void;
  addScratch: (groupId: string) => void;
  resize: (branchId: string, sizes: number[]) => void;
};

/** Local to the grid, so a branch need not forward seven props through arbitrary nesting. */
export const GridContext = React.createContext<GridContextValue | null>(null);

export function useGrid(): GridContextValue {
  const value = React.useContext(GridContext);
  if (!value) throw new Error("Grid internals must render inside <EditorGrid>.");
  return value;
}
