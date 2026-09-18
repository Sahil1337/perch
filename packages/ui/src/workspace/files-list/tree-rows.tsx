import { ChevronRightIcon, FileTextIcon, FolderIcon, FolderOpenIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import * as React from "react";
import { useFade } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { Badge } from "../../ui/badge";
import { Button } from "../../ui/button";
import { indent, toggle, type TreeNode } from "./tree-helpers";

export function FileNodes({
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

/** An open workspace folder: a tree row with an action, so chevron and close are siblings. */
export function RootRow({
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

export function TreeRow({
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
