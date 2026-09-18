import * as React from "react";
import { TriangleAlertIcon } from "lucide-react";
import { Button } from "../../ui/button";
import { useWorkspace } from "../context";
import { type Buffer } from "../types";

/**
 * Someone else changed the file while you had unsaved edits. There is no safe automatic answer —
 * reloading discards yours, keeping yours discards theirs — so both are offered and neither is
 * default. `resolveConflict` writes the choice and clears the flag.
 */
export function ConflictBar({ buffer }: { buffer: Buffer }): React.ReactElement {
  const { resolveConflict } = useWorkspace();
  const [busy, setBusy] = React.useState<"reload" | "keep" | null>(null);

  async function choose(choice: "reload" | "keep"): Promise<void> {
    setBusy(choice);
    try {
      await resolveConflict(buffer.id, choice);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-2 border-warning/24 border-b bg-warning/8 px-3 py-1.5 text-xs"
      role="alert"
    >
      <TriangleAlertIcon className="size-3.5 shrink-0 text-warning-foreground" />
      <span className="min-w-0">
        <span className="font-medium">{buffer.name}</span> changed on disk while you were editing
        it.
      </span>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          disabled={busy !== null}
          loading={busy === "reload"}
          onClick={() => void choose("reload")}
          size="xs"
          variant="outline"
        >
          Use the file on disk
        </Button>
        <Button
          disabled={busy !== null}
          loading={busy === "keep"}
          onClick={() => void choose("keep")}
          size="xs"
          variant="outline"
        >
          Keep my version
        </Button>
      </div>
    </div>
  );
}
