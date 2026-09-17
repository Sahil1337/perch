"use client";

import { FolderOpenIcon } from "lucide-react";
import * as React from "react";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import { Skeleton } from "../../ui/skeleton";
import { useWorkspace } from "../context";
import { ErrorText } from "../error-text";
import { FolderPicker } from "../folder-picker";
import { asyncData } from "../types";
import { useFolders } from "./use-folders";

const SKELETON_ROWS = 5;

/**
 * An open folder with no .sql files in it. The panel has already said "empty" by being empty, so the
 * only thing worth offering is the other way out — a different folder — centred, where the eye is.
 */
export function EmptyWorkspace({ onOpen }: { onOpen: () => void }): React.ReactElement {
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
export function OpenFolder(): React.ReactElement {
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
        <ErrorText>{error}</ErrorText>
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

export function WorkspaceSkeleton(): React.ReactElement {
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
