// The Files sidebar: what is open, and what is openable.
//
// Two sections. Open is `buffers` — editor state, including scratch tabs that exist nowhere on disk.
// Workspace is the server's view of the directories `Settings.workspaces` permits, and the only
// source of paths `openFile` can legally be called with.
//
// Scratch buffers are called out rather than blended in: a scratch reads muted and italic with a
// badge, while a file buffer keeps the dirty dot a scratch can never earn, having no disk copy to
// differ from.
//
// The tree is assembled here because the server sends a flat list, and `FileEntry.path` is the whole
// structure. Directories may arrive as entries, arrive after their children, or never arrive, so
// paths are threaded onto a node map keyed by full path and missing directories are synthesised.
//
// Async follows the rule in types.ts: loaded data is never replaced by a skeleton.

import {
  FilePlusIcon,
  FolderPlusIcon,
  NotebookIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
} from "lucide-react";
import * as React from "react";
import { cn } from "../../lib/utils";
import { Button } from "../../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../ui/dropdown-menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../../ui/tooltip";
import { useWorkspace } from "../context";
import { FolderPicker } from "../folder-picker";
import { asyncData } from "../types";
import { BufferRow } from "./buffer-row";
import { GroupHeader } from "./group-header";
import { buildForest, toggle } from "./tree-helpers";
import { FileNodes, RootRow } from "./tree-rows";
import { useFolders } from "./use-folders";
import { EmptyWorkspace, OpenFolder, WorkspaceSkeleton } from "./workspace-states";

export function FilesList({ className }: { className?: string }): React.ReactElement {
  const {
    activeBufferId,
    buffers,
    closeBuffer,
    focusBuffer,
    newScratch,
    openFile,
    refreshWorkspace,
    roots,
    setBufferView,
    workspace,
  } = useWorkspace();

  const entries = asyncData(workspace);
  const refreshing =
    workspace.status === "loading" || (workspace.status === "ready" && workspace.stale);

  // Roots open, directories shut: a closed root is a dead row, but expanding everything buries
  // the shallow files most sessions want.
  const [collapsedRoots, setCollapsedRoots] = React.useState<ReadonlySet<string>>(() => new Set());

  // Folding the Open list is what the old `max-h-48` cap was standing in for: with a dozen tabs
  // open the tree used to be scrolled off the panel, and a cap on a list is a worse answer than a
  // handle on it. The cap stays as a backstop; the fold is the one you reach for.
  const [openExpanded, setOpenExpanded] = React.useState(true);
  const [pickingRoot, setPickingRoot] = React.useState(false);
  const { open: openRoot, close: closeRoot, error: rootError, clearError } = useFolders();
  const [expandedDirs, setExpandedDirs] = React.useState<ReadonlySet<string>>(() => new Set());

  const groups = React.useMemo(() => buildForest(entries ?? [], roots), [entries, roots]);
  const empty = groups.every((group) => group.children.length === 0);
  // Only once a listing has arrived: an unloaded tree is empty too, and deserves skeleton rows
  // rather than an empty state the panel may be about to take back.
  const emptyTree = entries !== undefined && empty;

  // `openFile` focuses an already-open buffer rather than opening a second one, so the row says
  // so before the click.
  const openPaths = React.useMemo(
    () => new Set(buffers.map((buffer) => buffer.path).filter((path) => path !== null)),
    [buffers],
  );

  const openNotebook = (): void => setBufferView(newScratch(), "notebook");

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      {/* Making a document belongs to the list the document joins: a new query is an open buffer
          before it is anything else. One menu here replaces the two full-width buttons that used
          to sit in a footer at the bottom of this tab — where they were both the loudest thing in
          the panel and invisible from the other two tabs. */}
      <GroupHeader
        count={buffers.length}
        expanded={openExpanded}
        label="Open"
        onToggle={() => setOpenExpanded((previous) => !previous)}
      >
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button aria-label="New document" size="icon-xs" variant="ghost" />}
          >
            <PlusIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={() => newScratch()}>
              <FilePlusIcon />
              New query
            </DropdownMenuItem>
            <DropdownMenuItem onClick={openNotebook}>
              <NotebookIcon />
              New notebook
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </GroupHeader>

      {openExpanded && (
        <div className="max-h-48 shrink-0 overflow-y-auto pb-1">
          {buffers.length === 0 ? (
            <Note>Nothing open.</Note>
          ) : (
            buffers.map((buffer) => (
              <BufferRow
                active={buffer.id === activeBufferId}
                buffer={buffer}
                key={buffer.id}
                onClose={() => closeBuffer(buffer.id)}
                onFocus={() => focusBuffer(buffer.id)}
              />
            ))
          )}
        </div>
      )}

      <GroupHeader label="Workspace">
        {/* Hidden while the panel below is empty: that state offers the same action in the middle
            of the space it is explaining, and two ways to open a folder six pixels apart is one
            more than the panel needs. */}
        {!emptyTree && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  aria-label="Open folder"
                  onClick={() => setPickingRoot(true)}
                  size="icon-xs"
                  variant="ghost"
                >
                  <FolderPlusIcon />
                </Button>
              }
            />
            <TooltipPopup>Open another folder</TooltipPopup>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                aria-label="Refresh workspace"
                disabled={refreshing}
                onClick={() => void refreshWorkspace()}
                size="icon-xs"
                variant="ghost"
              >
                <RefreshCwIcon className={cn(refreshing && "animate-spin")} />
              </Button>
            }
          />
          <TooltipPopup>{refreshing ? "Refreshing…" : "Refresh workspace"}</TooltipPopup>
        </Tooltip>
      </GroupHeader>
      <FolderPicker onOpenChange={setPickingRoot} onPick={openRoot} open={pickingRoot} />

      {rootError !== null && <ErrorBanner onDismiss={clearError}>{rootError}</ErrorBanner>}

      {/* Above the tree, not instead of it: a browsable stale tree beats an empty panel. */}
      {workspace.status === "error" && <ErrorBanner>{workspace.error}</ErrorBanner>}

      <div className="min-h-0 flex-1 overflow-y-auto pb-1">
        {entries === undefined ? (
          workspace.status === "error" ? null : (
            <WorkspaceSkeleton />
          )
        ) : empty ? (
          roots.length === 0 ? (
            <OpenFolder />
          ) : (
            <EmptyWorkspace onOpen={() => setPickingRoot(true)} />
          )
        ) : (
          groups.map((group) => {
            const open = !collapsedRoots.has(group.root);

            return (
              <React.Fragment key={group.root}>
                <RootRow
                  expanded={open}
                  onClose={() => void closeRoot(group.root)}
                  onToggle={() => setCollapsedRoots((previous) => toggle(previous, group.root))}
                  root={group.root}
                />
                {open && (
                  <FileNodes
                    depth={1}
                    expanded={expandedDirs}
                    nodes={group.children}
                    onOpenFile={(path) => void openFile(path)}
                    onToggleDir={setExpandedDirs}
                    openPaths={openPaths}
                  />
                )}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
}

function Note({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="px-2 py-1.5 text-muted-foreground text-xs">{children}</p>;
}

/** The panel's full-width failure line. Sits above the tree, never in place of it. */
function ErrorBanner({
  children,
  onDismiss,
}: {
  children: React.ReactNode;
  onDismiss?: () => void;
}): React.ReactElement {
  return (
    <p
      className="flex shrink-0 items-start gap-1.5 border-destructive/24 border-y bg-destructive/8 px-2 py-1.5 text-destructive-foreground text-xs"
      onClick={onDismiss}
      role="alert"
    >
      <TriangleAlertIcon className="size-3.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
