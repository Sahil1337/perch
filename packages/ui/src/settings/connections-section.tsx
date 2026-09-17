"use client";

// Settings → Connections.
//
// Three things stacked, in the order they are needed: what you already have, what is already on
// this machine, and — only once you ask for it — a form. The discovery scan starts when the pane
// mounts rather than when you press Add, because the answer takes a second to arrive and the
// whole point is that it is waiting for you when you get there.
//
// This file owns only which of those is open. The list, the row and the two write actions live in
// `connections/`.

import type { ConnectionSummary } from "@perch/protocol";
import { PlusIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useSpring } from "../lib/motion";
import { ConnectionForm } from "../onboarding/connection-form";
import { DiscoveredServers } from "../onboarding/discovered-servers";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { useWorkspace } from "../workspace/context";
import type { ConnectionInput } from "../workspace/types";
import { SavedConnectionsList } from "./connections/saved-connections-list";
import { useConnectionActions } from "./connections/use-connection-actions";

/**
 * Which form is showing, if any. `seq` is what re-keys the animation when a second discovered
 * server is picked while the form for the first is still open.
 */
type Editor =
  | { kind: "none" }
  | { kind: "add"; initial?: ConnectionInput; seq: number }
  | { kind: "edit"; id: string; initial: ConnectionInput };

function inputOf(connection: ConnectionSummary): ConnectionInput {
  return {
    name: connection.name,
    dialect: connection.dialect,
    host: connection.host,
    port: connection.port,
    user: connection.user,
    database: connection.database,
    ssl: connection.ssl,
  };
}

export function ConnectionsSection(): React.ReactElement {
  const { connections } = useWorkspace();
  const spring = useSpring();
  const actions = useConnectionActions();

  const [editor, setEditor] = React.useState<Editor>({ kind: "none" });
  const [confirming, setConfirming] = React.useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <SavedConnectionsList
        actions={actions}
        confirmingId={confirming}
        connections={connections}
        editingId={editor.kind === "edit" ? editor.id : null}
        onConfirmRemove={(id) =>
          actions.remove(id, () => {
            setConfirming(null);
            setEditor((previous) =>
              previous.kind === "edit" && previous.id === id ? { kind: "none" } : previous,
            );
          })
        }
        onEdit={(connection) =>
          setEditor((previous) =>
            previous.kind === "edit" && previous.id === connection.id
              ? { kind: "none" }
              : { kind: "edit", id: connection.id, initial: inputOf(connection) },
          )
        }
        onRequestRemove={(id) => setConfirming((previous) => (previous === id ? null : id))}
      />

      <Separator />

      <DiscoveredServers
        onSelect={(input) =>
          setEditor((previous) => ({
            kind: "add",
            initial: input,
            seq: (previous.kind === "add" ? previous.seq : 0) + 1,
          }))
        }
      />

      <AnimatePresence initial={false} mode="wait">
        {editor.kind === "none" ? (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key="closed"
            transition={spring}
          >
            <Button onClick={() => setEditor({ kind: "add", seq: 0 })} size="sm" variant="outline">
              <PlusIcon />
              Add connection
            </Button>
          </motion.div>
        ) : (
          <motion.div
            animate={{ height: "auto", opacity: 1 }}
            className="overflow-hidden"
            exit={{ height: 0, opacity: 0 }}
            initial={{ height: 0, opacity: 0 }}
            key={editor.kind === "edit" ? `edit-${editor.id}` : `add-${editor.seq}`}
            transition={spring}
          >
            <ConnectionForm
              connectionId={editor.kind === "edit" ? editor.id : undefined}
              initial={editor.initial}
              onCancel={() => setEditor({ kind: "none" })}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
