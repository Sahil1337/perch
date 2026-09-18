import { useDroppable } from "@dnd-kit/core";
import { FilePlusIcon } from "lucide-react";
import * as React from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import { Kbd } from "../../ui/kbd";
import { useWorkspace } from "../context";
import { isGroup, type PaneBranch, type PaneGroup, type PaneNode } from "../pane-layout";
import { PaneTabs, bodyDroppableId } from "../pane-tabs";
import { DropRegion } from "./drop-affordances";
import { useGrid } from "./grid-context";
import { PaneBody } from "./pane-body";

/** A pane smaller than this is unreadable, and one dragged to nothing is a way to lose a query. */
const MIN_PANE = "12%";

export function NodeView({ node }: { node: PaneNode }): React.ReactElement {
  return isGroup(node) ? <GroupView group={node} /> : <BranchView branch={node} />;
}

function BranchView({ branch }: { branch: PaneBranch }): React.ReactElement {
  const { resize } = useGrid();
  const horizontal = branch.direction === "row";

  return (
    <Group
      className="h-full w-full"
      id={branch.id}
      // A `Layout` is keyed by panel id, not ordered, so it is read back through the children —
      // which also keeps it correct after a drop reorders them.
      onLayoutChanged={(layout: Layout) =>
        resize(
          branch.id,
          branch.children.map((child) => layout[child.id] ?? 0),
        )
      }
      orientation={horizontal ? "horizontal" : "vertical"}
      // The invisible target around the hairline: it should look like a rule and act like a handle.
      resizeTargetMinimumSize={{ coarse: 16, fine: 8 }}
    >
      {branch.children.map((child, index) => (
        <React.Fragment key={child.id}>
          {index > 0 && <Separator className={separatorClass(horizontal)} />}
          {/* A bare number would be read as pixels, so the percentage is spelled out. `id` is what
              ties a panel to its size when one is added or removed beside it. */}
          <Panel
            className="h-full w-full min-w-0"
            defaultSize={`${branch.sizes[index] ?? 0}%`}
            id={child.id}
            minSize={MIN_PANE}
          >
            <NodeView node={child} />
          </Panel>
        </React.Fragment>
      ))}
    </Group>
  );
}

function separatorClass(horizontal: boolean): string {
  return cn(
    "relative bg-border outline-none transition-colors hover:bg-primary focus-visible:bg-primary",
    horizontal ? "w-px cursor-col-resize" : "h-px cursor-row-resize",
  );
}

function GroupView({ group }: { group: PaneGroup }): React.ReactElement {
  const { layout, drop, activate, close, addScratch } = useGrid();
  const { setNodeRef } = useDroppable({
    id: bodyDroppableId(group.id),
    data: { kind: "body", groupId: group.id },
  });

  const focused = layout.focusedGroup === group.id;
  const target = drop?.groupId === group.id ? drop : null;
  // A strip drop names an index and shows a caret; a body drop names a region and shades it.
  const insertAt = target && target.index !== undefined ? target.index : null;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col bg-background">
      <PaneTabs
        activePane={group.activePane}
        focused={focused}
        groupId={group.id}
        insertAt={insertAt}
        onActivate={(pane) => activate(group.id, pane)}
        onClose={close}
        onNew={() => addScratch(group.id)}
        panes={group.panes}
      />

      <div
        className="relative min-h-0 flex-1"
        onFocusCapture={() => {
          if (!focused && group.activePane) activate(group.id, group.activePane);
        }}
        ref={setNodeRef}
      >
        {/* Every pane in the group stays mounted; only the active one is visible.

            Rendering just the active pane meant a tab switch unmounted an editor and mounted
            another, and `PaneBody` keys `SqlEditor` by buffer id — so each switch tore down a
            CodeMirror instance and built a fresh one. That is the flash, and it took the cursor
            and the scroll position with it, which is the part people notice second.

            `invisible` rather than `hidden` on purpose: `visibility: hidden` keeps the element's
            box, so CodeMirror stays measured and has nothing to re-measure when it comes back —
            `display: none` would collapse it to zero and hand back a mis-sized editor on the next
            switch. It also drops the subtree out of the tab order and stops pointer events, so a
            hidden pane cannot be reached by accident. */}
        {group.activePane === null ? (
          <EmptyGroup />
        ) : (
          group.panes.map((pane) => (
            <div
              aria-hidden={pane !== group.activePane}
              className={cn("absolute inset-0", pane !== group.activePane && "invisible")}
              key={pane}
            >
              <PaneBody pane={pane} />
            </div>
          ))
        )}
        {target && target.index === undefined && <DropRegion edge={target.edge} />}
      </div>
    </div>
  );
}

/**
 * An empty pane offers the thing you would do next. Naming ⌘P instead would assume a workspace —
 * with no folder open there are no files to find. An untitled query assumes nothing, which is why
 * perch is useful a second after connecting.
 */
function EmptyGroup(): React.ReactElement {
  const { newScratch } = useWorkspace();
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground text-sm">
      <span>No file open</span>
      <Button onClick={() => newScratch()} size="sm" variant="outline">
        <FilePlusIcon />
        New query
      </Button>
      <span className="flex items-center gap-1.5 text-xs">
        or find a file with <Kbd>⌘P</Kbd>
      </span>
    </div>
  );
}
