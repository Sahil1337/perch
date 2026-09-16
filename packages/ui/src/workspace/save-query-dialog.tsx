"use client";

// Saving an untitled query. The question is *where*, and the answer depends on what is open: a
// workspace folder is the obvious home, and the first one is preselected. With none open, perch
// offers the folder it made for itself and opens that as a workspace on the way past, so the file
// is visible in the Files panel rather than filed somewhere you cannot browse.
//
// Reached by a window event, like the editor's format command: ⌘S is bound at the app shell and the
// save menu sits in the topbar, and neither should own this dialog or thread a callback to it.

import { FolderIcon, SaveIcon } from "lucide-react";
import * as React from "react";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "../ui/input-group";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { useWorkspace } from "./context";
import { isScratch } from "./types";

/** Dispatch on `window` to save the active buffer, asking where when it has never been saved. */
export const SAVE_QUERY_EVENT = "perch:save";

/** Windows paths come back with backslashes; join the way the folder is already spelled. */
function join(folder: string, name: string): string {
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return `${folder.replace(/[\\/]+$/, "")}${separator}${name}`;
}

/**
 * "Query 1" → "query-1": a name you would have typed, so most people press Enter. `.sql` is shown as
 * a suffix inside the field rather than in the value, and re-attached on submit.
 */
function suggest(name: string): string {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/\.sql$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return base.length > 0 ? base : "query";
}

/** Abbreviates the home prefix, which is noise in a small dialog. */
function tilde(path: string): string {
  return path
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~")
    .replace(/^[A-Za-z]:\\Users\\[^\\]+(?=\\|$)/, "~");
}

export function SaveQueryDialog(): React.ReactElement {
  const { activeBuffer, roots, server, save, saveAs, updateSettings } = useWorkspace();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("query");
  const [folder, setFolder] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Only when it is not already a root: offering it twice would imply the two differ.
  const ownFolder = server.queriesDir;
  const folders = React.useMemo(
    () => (ownFolder !== null && !roots.includes(ownFolder) ? [...roots, ownFolder] : [...roots]),
    [roots, ownFolder],
  );

  // A buffer that already has a path needs no dialog; that is an ordinary save.
  const request = React.useCallback(() => {
    const buffer = activeBuffer;
    if (!buffer) return;
    if (!isScratch(buffer)) {
      void save();
      return;
    }
    setName(suggest(buffer.name));
    setFolder(folders[0] ?? null);
    setError(null);
    setOpen(true);
  }, [activeBuffer, folders, save]);

  React.useEffect(() => {
    const listener = (): void => request();
    window.addEventListener(SAVE_QUERY_EVENT, listener);
    return () => window.removeEventListener(SAVE_QUERY_EVENT, listener);
  }, [request]);

  async function submit(): Promise<void> {
    const buffer = activeBuffer;
    const target = folder;
    if (!buffer || target === null || name.trim().length === 0 || busy) return;
    const file = `${name.trim().replace(/\.sql$/, "")}.sql`;
    setBusy(true);
    setError(null);
    try {
      // The server may not write outside a workspace, so open the folder as one first.
      if (!roots.includes(target)) await updateSettings({ workspaces: [...roots, target] });
      await saveAs(buffer.id, join(target, file));
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const only = folders.length === 1 ? (folders[0] ?? null) : null;

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {/* Narrow on purpose. This asks for a filename and confirms a folder; at `max-w-md` with the
          header's default `p-6` it read as a settings page for a one-line question. */}
      <DialogPopup size="sm">
        <div className="flex items-center gap-2.5 p-3.5 pe-9">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <SaveIcon className="size-3.5" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <DialogTitle size="sm">Save query</DialogTitle>
            <DialogDescription size="sm">
              {folders.length > 1 ? "Name it and pick a folder." : "Name it — perch files the rest."}
            </DialogDescription>
          </div>
        </div>

        <div className="flex flex-col gap-2 px-3.5 pb-3.5">
          {/* The extension is a suffix, not something to type: `.sql` is the only one a query can
              have, so the field holds the part that is actually a choice. */}
          <InputGroup>
            <InputGroupInput
              aria-label="File name"
              autoComplete="off"
              autoFocus
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                void submit();
              }}
              onValueChange={setName}
              placeholder="query"
              spellCheck={false}
              value={name}
            />
            <InputGroupAddon align="inline-end">
              <InputGroupText variant="mono">.sql</InputGroupText>
            </InputGroupAddon>
          </InputGroup>

          {folders.length === 0 ? (
            <p className="rounded-md border border-border border-dashed px-2.5 py-2 text-center text-muted-foreground text-xs">
              No folder yet — open one in the Files panel first.
            </p>
          ) : only !== null ? (
            /* One destination is a fact, not a choice: a radio group of one asks a question with
               no second answer. */
            <div className="flex h-8 items-center gap-2 rounded-md bg-muted/48 px-2.5">
              <FolderIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs" title={only}>
                {tilde(only)}
              </span>
              {only === ownFolder && (
                <Badge size="sm" variant="secondary">
                  perch
                </Badge>
              )}
            </div>
          ) : (
            <Select
              onValueChange={(value) => setFolder(String(value))}
              value={folder ?? ""}
            >
              <SelectTrigger className="w-full" size="sm">
                <SelectValue>
                  {(value: unknown) => (
                    <span className="truncate font-mono text-xs">{tilde(String(value))}</span>
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup>
                {folders.map((option) => (
                  <SelectItem key={option} value={option}>
                    <span className="truncate font-mono text-xs">{tilde(option)}</span>
                    {option === ownFolder && (
                      <span className="shrink-0 text-muted-foreground text-xs">perch&rsquo;s</span>
                    )}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          )}

          {error !== null && (
            <p className="text-destructive-foreground text-xs" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-1.5 pt-1">
            <DialogClose render={<Button size="sm" variant="ghost" />}>Cancel</DialogClose>
            <Button
              disabled={folder === null || name.trim().length === 0}
              loading={busy}
              onClick={() => void submit()}
              size="sm"
            >
              Save
            </Button>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

/** What ⌘S and the save menu call. Saves outright, or asks where first. */
export function requestSaveQuery(): void {
  window.dispatchEvent(new CustomEvent(SAVE_QUERY_EVENT));
}
