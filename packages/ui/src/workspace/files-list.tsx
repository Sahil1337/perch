"use client";

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

import type { FileEntry } from "@perch/protocol";
import {
  ChevronRightIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
  FolderPlusIcon,
  NotebookIcon,
  PlusIcon,
  RefreshCwIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useFade } from "../lib/motion";
import * as React from "react";
import { cn } from "../lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Input } from "../ui/input";
import { Skeleton } from "../ui/skeleton";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useWorkspace } from "./context";
import { FolderPicker } from "./folder-picker";
import { asyncData, type Buffer, isScratch } from "./types";

/** Pixels. Indentation is the one row value that depends on data, so it is the one inline value. */
const INDENT_BASE = 8;
const INDENT_STEP = 12;

const SKELETON_ROWS = 5;

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

      {rootError !== null && (
        <p
          className="flex shrink-0 items-start gap-1.5 border-destructive/24 border-y bg-destructive/8 px-2 py-1.5 text-destructive-foreground text-xs"
          onClick={clearError}
          role="alert"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="min-w-0">{rootError}</span>
        </p>
      )}

      {workspace.status === "error" && (
        // Above the tree, not instead of it: a browsable stale tree beats an empty panel.
        <p
          className="flex shrink-0 items-start gap-1.5 border-destructive/24 border-y bg-destructive/8 px-2 py-1.5 text-destructive-foreground text-xs"
          role="alert"
        >
          <TriangleAlertIcon className="size-3.5 shrink-0" />
          <span className="min-w-0">{workspace.error}</span>
        </p>
      )}

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

/* ---------------------------------------------------------------- buffers */

/**
 * One open tab. The row and its close control are sibling buttons inside a presentational wrapper,
 * since a button nested in a button is invalid HTML and unreachable by keyboard. The close control
 * keeps its slot whether or not the pointer is here, so revealing it never shifts the name.
 */
function BufferRow({
  active,
  buffer,
  onClose,
  onFocus,
}: {
  active: boolean;
  buffer: Buffer;
  onClose: () => void;
  onFocus: () => void;
}): React.ReactElement {
  const scratch = isScratch(buffer);
  const Icon = buffer.view === "notebook" ? NotebookIcon : FileTextIcon;

  return (
    <div
      className={cn(
        "flex h-7 items-center gap-1 rounded-sm pe-1",
        "hover:bg-sidebar-accent/60",
        active && "bg-sidebar-accent",
      )}
    >
      <button
        aria-current={active ? "true" : undefined}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-1.5 ps-2 text-left text-sm",
          "-outline-offset-2 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring",
        )}
        onClick={onFocus}
        title={buffer.path ?? `${buffer.name} — scratch buffer, not saved to disk`}
        type="button"
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className={cn("truncate", scratch && "text-muted-foreground italic")}>
          {buffer.name}
        </span>
        {scratch ? (
          <Badge size="sm" variant="secondary">
            scratch
          </Badge>
        ) : (
          buffer.dirty && (
            // A dot says "unsaved" without stealing the width the filename needs.
            <span
              aria-label="Unsaved changes"
              className="size-1.5 shrink-0 rounded-full bg-foreground/70"
              role="img"
            />
          )
        )}
      </button>
      <Button
        aria-label={`Close ${buffer.name}`}
        className="shrink-0"
        onClick={onClose}
        size="icon-xs"
        variant="ghost"
      >
        <XIcon />
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------- workspace */

function FileNodes({
  depth,
  expanded,
  nodes,
  onOpenFile,
  onToggleDir,
  openPaths,
}: {
  depth: number;
  expanded: ReadonlySet<string>;
  nodes: readonly TreeNode[];
  onOpenFile: (path: string) => void;
  onToggleDir: React.Dispatch<React.SetStateAction<ReadonlySet<string>>>;
  openPaths: ReadonlySet<string>;
}): React.ReactElement {
  return (
    <>
      {nodes.map((node) => {
        if (node.kind === "dir") {
          const open = expanded.has(node.path);

          return (
            <React.Fragment key={node.path}>
              <TreeRow
                depth={depth}
                expanded={open}
                icon={
                  open ? (
                    <FolderOpenIcon className="size-3.5" />
                  ) : (
                    <FolderIcon className="size-3.5" />
                  )
                }
                label={node.name}
                onClick={() => onToggleDir((previous) => toggle(previous, node.path))}
                title={node.path}
              />
              {open && (
                <FileNodes
                  depth={depth + 1}
                  expanded={expanded}
                  nodes={node.children}
                  onOpenFile={onOpenFile}
                  onToggleDir={onToggleDir}
                  openPaths={openPaths}
                />
              )}
            </React.Fragment>
          );
        }

        const alreadyOpen = openPaths.has(node.path);

        return (
          <TreeRow
            depth={depth}
            icon={<FileTextIcon className="size-3.5" />}
            key={node.path}
            label={node.name}
            onClick={() => onOpenFile(node.path)}
            title={node.path}
            trailing={
              alreadyOpen && (
                // What the click will actually do: focus the open buffer, not open a duplicate.
                <Badge size="sm" variant="outline">
                  open
                </Badge>
              )
            }
          />
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ rows */

/** An open workspace folder: a tree row with an action, so chevron and close are siblings. */
function RootRow({
  expanded,
  onClose,
  onToggle,
  root,
}: {
  expanded: boolean;
  onClose: () => void;
  onToggle: () => void;
  root: string;
}): React.ReactElement {
  const fade = useFade();

  return (
    <div className="flex h-7 items-center gap-1 rounded-sm pe-1 hover:bg-sidebar-accent/60">
      <button
        aria-expanded={expanded}
        className={cn(
          "flex h-7 min-w-0 flex-1 items-center gap-1.5 ps-2 text-left text-sm",
          "-outline-offset-2 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring",
        )}
        onClick={onToggle}
        title={root}
        type="button"
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            initial={false}
            transition={fade}
          >
            <ChevronRightIcon className="size-3.5" />
          </motion.span>
        </span>
        <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{root}</span>
      </button>
      <Button aria-label={`Close ${root}`} className="shrink-0" onClick={onClose} size="icon-xs" variant="ghost">
        <XIcon />
      </Button>
    </div>
  );
}

function TreeRow({
  depth,
  expanded,
  icon,
  label,
  onClick,
  title,
  trailing,
}: {
  depth: number;
  /** `undefined` for a row with nothing to open. */
  expanded?: boolean;
  icon: React.ReactNode;
  label: React.ReactNode;
  onClick: () => void;
  title?: string;
  trailing?: React.ReactNode;
}): React.ReactElement {
  const fade = useFade();

  return (
    <button
      aria-expanded={expanded}
      className={cn(
        "flex h-7 w-full items-center gap-1.5 rounded-sm pe-2 ps-(--tree-indent) text-left text-sm",
        // The focus ring is drawn inside the row: rows run the full width of a scrolling pane, so
        // an outward ring would be clipped on both edges.
        "-outline-offset-2 cursor-pointer outline-none focus-visible:outline-2 focus-visible:outline-ring",
        "hover:bg-sidebar-accent/60",
      )}
      onClick={onClick}
      style={{ "--tree-indent": indent(depth) } as React.CSSProperties}
      title={title}
      type="button"
    >
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {expanded !== undefined && (
          <motion.span
            animate={{ rotate: expanded ? 90 : 0 }}
            initial={false}
            transition={fade}
          >
            <ChevronRightIcon className="size-3.5" />
          </motion.span>
        )}
      </span>
      <span className="flex size-3.5 shrink-0 items-center justify-center text-muted-foreground">
        {icon}
      </span>
      <span className="truncate">{label}</span>
      {trailing && <span className="ms-auto shrink-0">{trailing}</span>}
    </button>
  );
}

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
function GroupHeader({
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

function Note({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="px-2 py-1.5 text-muted-foreground text-xs">{children}</p>;
}

/**
 * Opening and closing workspace folders. Shared by the three places that do it: the empty state,
 * the panel header, and the close button on each open folder — so opening the wrong folder is not
 * a one-way door out to a trash icon in Settings.
 */
function useFolders(): {
  open: (folder: string) => Promise<void>;
  close: (folder: string) => Promise<void>;
  busy: string | null;
  error: string | null;
  clearError: () => void;
} {
  const { roots, updateSettings } = useWorkspace();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const write = React.useCallback(
    async (folder: string, next: string[]): Promise<void> => {
      setBusy(folder);
      setError(null);
      try {
        await updateSettings({ workspaces: next });
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setBusy(null);
      }
    },
    [updateSettings],
  );

  return {
    open: React.useCallback(
      async (folder: string) => {
        const value = folder.trim();
        if (value.length === 0 || roots.includes(value)) return;
        await write(value, [...roots, value]);
      },
      [roots, write],
    ),
    // Closing stops perch reading the folder; the path stays under Recent.
    close: React.useCallback(
      async (folder: string) => write(folder, roots.filter((root) => root !== folder)),
      [roots, write],
    ),
    busy,
    error,
    clearError: React.useCallback(() => setError(null), []),
  };
}

/**
 * An open folder with no .sql files in it. The panel has already said "empty" by being empty, so the
 * only thing worth offering is the other way out — a different folder — centred, where the eye is.
 */
function EmptyWorkspace({ onOpen }: { onOpen: () => void }): React.ReactElement {
  return (
    <div className="flex h-full flex-col items-center justify-center p-4">
      {/* Outline, not ghost: a ghost button is a label until you hover it, which is fine in a
          toolbar full of other controls and useless as the only thing on an empty panel — the one
          affordance here has to look pressable before it is pointed at. */}
      <Button onClick={onOpen} size="sm" variant="outline">
        <FolderOpenIcon />
        Open workspace
      </Button>
    </div>
  );
}

/**
 * What the Files panel is when no folder is open: an offer to open one, not a pointer at Settings.
 *
 * Recent folders are listed because the common case is reopening the one you had. The path field is
 * free-form because the server owns the filesystem — a browser cannot show a directory picker for
 * it — so anything typed is checked there (absolute, exists, is a directory) and the refusal shown
 * here. Queries need none of this: "New query" below opens a buffer that never touches disk.
 */
function OpenFolder(): React.ReactElement {
  const { settings, roots } = useWorkspace();
  const [path, setPath] = React.useState("");
  const [picking, setPicking] = React.useState(false);
  const { open: openFolder, busy, error } = useFolders();

  const recent = (asyncData(settings)?.recentWorkspaces ?? []).filter(
    (folder) => !roots.includes(folder),
  );

  async function open(folder: string): Promise<void> {
    await openFolder(folder);
    setPath("");
  }

  return (
    <div className="flex flex-col gap-3 px-2 py-3">
      <p className="text-muted-foreground text-xs">
        No folder open. Open one to browse and save <code>.sql</code> files — or just start an
        untitled query below.
      </p>

      <Button className="w-full" onClick={() => setPicking(true)} size="xs" variant="outline">
        <FolderOpenIcon />
        Open folder…
      </Button>
      <FolderPicker onOpenChange={setPicking} onPick={open} open={picking} />

      <div className="flex flex-col gap-1.5">
        <span className="text-muted-foreground text-xs">Or type a path</span>
        <div className="flex items-center gap-1.5">
          <Input
            aria-label="Folder path"
            autoComplete="off"
            className="flex-1"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              void open(path);
            }}
            onValueChange={setPath}
            placeholder="/Users/you/queries"
            size="sm"
            spellCheck={false}
            value={path}
          />
          <Button
            disabled={path.trim().length === 0}
            loading={busy === path.trim()}
            onClick={() => void open(path)}
            size="xs"
            variant="outline"
          >
            Open
          </Button>
        </div>
        {error !== null && (
          <p className="text-destructive-foreground text-xs" role="alert">
            {error}
          </p>
        )}
      </div>

      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-medium text-muted-foreground text-xs">Recent</span>
          <ul className="flex flex-col">
            {recent.map((folder) => (
              <li key={folder}>
                <button
                  className="flex h-7 w-full cursor-pointer items-center gap-1.5 rounded-sm px-1.5 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  disabled={busy !== null}
                  onClick={() => void open(folder)}
                  title={folder}
                  type="button"
                >
                  <FolderOpenIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 truncate font-mono">{folder}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function WorkspaceSkeleton(): React.ReactElement {
  return (
    <div aria-label="Loading workspace" role="status">
      {Array.from({ length: SKELETON_ROWS }, (_, index) => (
        <div className="flex h-7 items-center gap-1.5 pe-2 ps-6" key={index}>
          <Skeleton className="size-3.5 shrink-0" />
          <Skeleton className="h-3 w-28 max-w-full" />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ tree */

type TreeNode = {
  readonly path: string;
  readonly name: string;
  readonly kind: FileEntry["kind"];
  readonly children: TreeNode[];
};

type Group = { readonly root: string; readonly children: readonly TreeNode[] };

/**
 * The flat listing, re-nested. `FileEntry` carries no parent link, so the path is the structure.
 * Interning nodes by full path makes the walk order-independent: a child arriving before its
 * directory synthesises it, and the real entry later finds the node already there.
 *
 * Grouping is by `roots`, in configured order. An entry no root claims still gets a group keyed by
 * its parent, rather than being silently dropped.
 */
function buildForest(entries: readonly FileEntry[], roots: readonly string[]): readonly Group[] {
  const buckets = new Map<string, TreeNode[]>();
  const nodes = new Map<string, TreeNode>();

  // Seeded first, so a configured root keeps its heading and empty state when nothing is under it.
  for (const root of roots) buckets.set(root, []);

  const bucket = (key: string): TreeNode[] => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created: TreeNode[] = [];
    buckets.set(key, created);
    return created;
  };

  const ensure = (path: string, name: string, kind: FileEntry["kind"], root: string): TreeNode => {
    const existing = nodes.get(path);
    if (existing) return existing;

    const node: TreeNode = { children: [], kind, name, path };
    nodes.set(path, node);

    const parent = parentOf(path);
    if (parent !== "" && parent !== root && isUnder(parent, root)) {
      ensure(parent, baseName(parent), "dir", root).children.push(node);
    } else {
      bucket(root).push(node);
    }
    return node;
  };

  for (const entry of entries) {
    if (entry.path === "") continue;
    // Only what the current roots cover: the listing outlives the roots by a beat, since closing a
    // folder is a settings write whose refreshed listing arrives after.
    const root = roots.find((candidate) => isUnder(entry.path, candidate));
    if (root === undefined) continue;
    // The root's own heading already stands for this path; nesting it under itself is a duplicate.
    if (entry.path === root) continue;
    ensure(entry.path, entry.name === "" ? baseName(entry.path) : entry.name, entry.kind, root);
  }

  return [...buckets].map(([root, children]) => ({ children: sortNodes(children), root }));
}

/** Directories first, then name order — what a file browser has trained everyone to expect. */
function sortNodes(nodes: TreeNode[]): readonly TreeNode[] {
  for (const node of nodes) sortNodes(node.children);
  nodes.sort((a, b) =>
    a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1,
  );
  return nodes;
}

/**
 * Paths arrive in the server's native form, and the server runs on Windows too, so a path may use
 * either separator. The path is never rewritten — it goes back to the server verbatim — only split
 * for display.
 */
function lastSeparator(path: string): number {
  return Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
}

function parentOf(path: string): string {
  const cut = lastSeparator(path);
  return cut <= 0 ? path.slice(0, cut + 1) || "/" : path.slice(0, cut);
}

function baseName(path: string): string {
  const cut = lastSeparator(path);
  return cut === -1 ? path : path.slice(cut + 1);
}

function isUnder(path: string, root: string): boolean {
  if (path === root) return true;
  const trimmed = /[/\\]$/.test(root) ? root.slice(0, -1) : root;
  return path.startsWith(`${trimmed}/`) || path.startsWith(`${trimmed}\\`);
}

/* ------------------------------------------------------------------ util */

/** Depth-based indent, fed to `--tree-indent` so the padding stays a utility class. */
function indent(depth: number): string {
  return `${INDENT_BASE + depth * INDENT_STEP}px`;
}

function toggle(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
