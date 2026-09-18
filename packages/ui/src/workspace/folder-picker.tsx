// Picking a workspace folder by looking at the machine, rather than typing a path from memory.
//
// The obvious control — a native folder dialog — is not available to us. `showDirectoryPicker()`
// returns a handle scoped to the browser sandbox, not a path, and every path in perch is a path
// the *server* opens. So the picker is a thin filesystem browser over `GET /api/browse`: folders
// only, one level at a time, starting at home.
//
// Typing is still there for the people who know exactly where they are going, and Recent is still
// the fastest route back to yesterday's folder. This exists because neither helps the case that
// matters most — the first run, on a machine whose layout perch cannot guess.

import type { BrowseResult } from "@perch/protocol";
import { ChevronRightIcon, CornerLeftUpIcon, FolderIcon, HouseIcon } from "lucide-react";
import * as React from "react";
import { messageOf } from "../lib/errors";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Skeleton } from "../ui/skeleton";
import { useWorkspace } from "./context";
import { ErrorText } from "./error-text";
import { asyncData, asyncError, asyncIdle, asyncReady, asyncRefreshing, type Async } from "./types";

export type FolderPickerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the chosen absolute path. The caller decides what opening means. */
  onPick: (path: string) => void | Promise<void>;
};

export function FolderPicker({
  open,
  onOpenChange,
  onPick,
}: FolderPickerProps): React.ReactElement {
  const { browse } = useWorkspace();
  const [listing, setListing] = React.useState<Async<BrowseResult>>(asyncIdle);
  const [opening, setOpening] = React.useState(false);

  const result = asyncData(listing);
  // Skeletons for a navigation too, not only the first read: you asked to go somewhere else, so
  // the folder you left is no longer the answer to what is on screen.
  const loading = listing.status === "loading" || (listing.status === "ready" && listing.stale);
  const error = listing.status === "error" ? listing.error : null;

  // Held in a ref so a provider that rebuilds its action closures each render cannot re-trigger
  // the listing; it runs when the dialog opens and when the user navigates, and at no other time.
  const list = React.useRef(browse);
  list.current = browse;

  const go = React.useCallback((path?: string) => {
    setListing(asyncRefreshing);
    list.current(path).then(
      (value) => setListing(asyncReady(value)),
      (cause: unknown) => setListing((previous) => asyncError(messageOf(cause), previous)),
    );
  }, []);

  React.useEffect(() => {
    if (!open) return;
    go(undefined); // home, every time it opens: a picker that resumes somewhere odd is worse
  }, [open, go]);

  async function pick(): Promise<void> {
    if (!result || opening) return;
    setOpening(true);
    try {
      await onPick(result.path);
      onOpenChange(false);
    } catch (cause) {
      setListing((previous) => asyncError(messageOf(cause), previous));
    } finally {
      setOpening(false);
    }
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Open a folder</DialogTitle>
          <DialogDescription>
            Perch reads and writes .sql files inside the folders you open. Pick one, or open its
            parent to see everything at once.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2 px-4">
          <div className="flex items-center gap-1">
            <Button
              aria-label="Home"
              disabled={loading}
              onClick={() => go(undefined)}
              size="icon-sm"
              variant="ghost"
            >
              <HouseIcon />
            </Button>
            <Button
              aria-label="Up one folder"
              disabled={loading || result?.parent === null || result === null}
              onClick={() => result?.parent !== null && go(result?.parent)}
              size="icon-sm"
              variant="ghost"
            >
              <CornerLeftUpIcon />
            </Button>
            <span
              className="min-w-0 flex-1 truncate rounded-md bg-muted px-2 py-1 font-mono text-xs"
              title={result?.path ?? ""}
            >
              {result?.path ?? "…"}
            </span>
          </div>

          <div className="h-64 overflow-y-auto rounded-md border border-border">
            {loading ? (
              <div className="flex flex-col gap-1 p-2" aria-label="Loading folders" role="status">
                {[0, 1, 2, 3, 4].map((row) => (
                  <Skeleton className="h-6 w-full" key={row} />
                ))}
              </div>
            ) : error !== null ? (
              <ErrorText className="p-3">{error}</ErrorText>
            ) : (result?.entries.length ?? 0) === 0 ? (
              <p className="p-3 text-muted-foreground text-xs">
                No sub-folders here. Open this one, or go up.
              </p>
            ) : (
              <ul>
                {result?.entries.map((entry) => (
                  <li key={entry.path}>
                    <button
                      className="flex h-8 w-full cursor-pointer items-center gap-2 px-2 text-left text-sm outline-none hover:bg-accent focus-visible:inset-ring-2 focus-visible:inset-ring-ring"
                      onClick={() => go(entry.path)}
                      type="button"
                    >
                      <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 truncate">{entry.name}</span>
                      <ChevronRightIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button
            disabled={result === null || loading}
            loading={opening}
            onClick={() => void pick()}
          >
            Open this folder
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
