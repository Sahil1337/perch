"use client";

// Settings → Connections.
//
// Three things stacked, in the order they are needed: what you already have, what is already on
// this machine, and — only once you ask for it — a form. The discovery scan starts when the pane
// mounts rather than when you press Add, because the answer takes a second to arrive and the
// whole point is that it is waiting for you when you get there.
//
// Test, Edit and Remove all report in the row they belong to. A connection list where the result
// of a test appears somewhere else on the screen is a list you cannot use with more than one
// connection in it.

import type { ConnectionSummary } from "@perch/protocol";
import { CheckIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useFade, useSpring } from "../lib/motion";
import { cn } from "../lib/utils";
import { ConnectionForm } from "../onboarding/connection-form";
import { DialectMark } from "../onboarding/dialect-mark";
import { DiscoveredServers } from "../onboarding/discovered-servers";
import { Button } from "../ui/button";
import { Separator } from "../ui/separator";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { useWorkspace } from "../workspace/context";
import { asyncData, type ConnectionInput, type ConnectionTest } from "../workspace/types";

type TestState =
  | { kind: "running" }
  | { kind: "ok"; test: ConnectionTest }
  | { kind: "error"; message: string };

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
  const { connections, testConnection, removeConnection } = useWorkspace();
  const spring = useSpring();

  const [editor, setEditor] = React.useState<Editor>({ kind: "none" });
  const [tests, setTests] = React.useState<Record<string, TestState>>({});
  const [confirming, setConfirming] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<string | null>(null);
  const [removeError, setRemoveError] = React.useState<string | null>(null);

  const rows: readonly ConnectionSummary[] = asyncData(connections) ?? [];
  const pending = connections.status === "idle" || connections.status === "loading";

  function test(id: string): void {
    setTests((previous) => ({ ...previous, [id]: { kind: "running" } }));
    void testConnection(id).then(
      (result) => setTests((previous) => ({ ...previous, [id]: { kind: "ok", test: result } })),
      (cause: unknown) =>
        setTests((previous) => ({
          ...previous,
          [id]: { kind: "error", message: cause instanceof Error ? cause.message : String(cause) },
        })),
    );
  }

  function remove(id: string): void {
    setRemoving(id);
    setRemoveError(null);
    void removeConnection(id).then(
      () => {
        setRemoving(null);
        setConfirming(null);
        if (editor.kind === "edit" && editor.id === id) setEditor({ kind: "none" });
      },
      (cause: unknown) => {
        setRemoving(null);
        setRemoveError(cause instanceof Error ? cause.message : String(cause));
      },
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">Saved</h3>

        {pending && (
          <ul aria-label="Loading connections" className="flex flex-col gap-1">
            {[0, 1].map((row) => (
              <li className="flex h-11 items-center gap-2 rounded-md border border-border px-2" key={row}>
                <Skeleton className="size-4" />
                <Skeleton className="h-3 w-40" />
              </li>
            ))}
          </ul>
        )}

        {connections.status === "error" && (
          <p className="text-destructive-foreground text-xs" role="alert">
            {connections.error}
          </p>
        )}

        {!pending && rows.length === 0 && (
          <p className="rounded-md border border-border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
            No connections yet
          </p>
        )}

        {rows.length > 0 && (
          <ul className="flex flex-col gap-1">
            {rows.map((connection) => (
              <ConnectionRow
                confirming={confirming === connection.id}
                connection={connection}
                editing={editor.kind === "edit" && editor.id === connection.id}
                key={connection.id}
                onConfirmRemove={() => remove(connection.id)}
                onEdit={() =>
                  setEditor(
                    editor.kind === "edit" && editor.id === connection.id
                      ? { kind: "none" }
                      : { kind: "edit", id: connection.id, initial: inputOf(connection) },
                  )
                }
                onRequestRemove={() => setConfirming(confirming === connection.id ? null : connection.id)}
                onTest={() => test(connection.id)}
                removing={removing === connection.id}
                test={tests[connection.id]}
              />
            ))}
          </ul>
        )}

        {removeError !== null && (
          <p className="text-destructive-foreground text-xs" role="alert">
            {removeError}
          </p>
        )}
      </section>

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

function ConnectionRow({
  connection,
  test,
  editing,
  confirming,
  removing,
  onTest,
  onEdit,
  onRequestRemove,
  onConfirmRemove,
}: {
  connection: ConnectionSummary;
  test: TestState | undefined;
  editing: boolean;
  confirming: boolean;
  removing: boolean;
  onTest: () => void;
  onEdit: () => void;
  onRequestRemove: () => void;
  onConfirmRemove: () => void;
}): React.ReactElement {
  const fade = useFade();

  return (
    <li
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-2 rounded-md border px-2 py-1",
        editing ? "border-primary" : "border-border",
      )}
    >
      <span
        aria-label={connection.status}
        className={cn(
          "size-1.5 shrink-0 rounded-full",
          connection.status === "connected"
            ? "bg-success"
            : connection.status === "error"
              ? "bg-destructive"
              : "bg-muted-foreground/40",
        )}
        role="img"
      />
      <DialectMark className="text-muted-foreground" dialect={connection.dialect} />
      <span className="min-w-0 truncate text-sm">{connection.name}</span>
      <span className="min-w-0 truncate text-muted-foreground text-xs">
        {connection.dialect} · {connection.host}:{connection.port}/{connection.database}
      </span>

      <span className="ml-auto flex shrink-0 items-center gap-1">
        <AnimatePresence initial={false} mode="wait">
          {test !== undefined && (
            <motion.span
              animate={{ opacity: 1 }}
              className={cn(
                "flex items-center gap-1 text-xs",
                test.kind === "error" ? "text-destructive-foreground" : "text-muted-foreground",
              )}
              exit={{ opacity: 0 }}
              initial={{ opacity: 0 }}
              key={test.kind}
              role={test.kind === "error" ? "alert" : undefined}
              transition={fade}
            >
              {test.kind === "running" && <Spinner className="size-3" />}
              {test.kind === "ok" && <CheckIcon className="size-3" />}
              {test.kind === "ok" && (
                <span className="tabular-nums">
                  {Math.round(test.test.latencyMs)} ms · {test.test.serverVersion}
                </span>
              )}
              {test.kind === "error" && <span className="max-w-48 truncate">{test.message}</span>}
            </motion.span>
          )}
        </AnimatePresence>

        <Button
          disabled={test?.kind === "running"}
          loading={test?.kind === "running"}
          onClick={onTest}
          size="xs"
          variant="ghost"
        >
          Test
        </Button>
        <Button aria-label={`Edit ${connection.name}`} onClick={onEdit} size="icon-xs" variant="ghost">
          <PencilIcon />
        </Button>
        {/* Removing a connection throws away a stored password, so it asks once. The second
            click is on a button that has changed colour and label — not on the same target. */}
        {confirming ? (
          <Button loading={removing} onClick={onConfirmRemove} size="xs" variant="destructive">
            Remove
          </Button>
        ) : (
          <Button
            aria-label={`Remove ${connection.name}`}
            onClick={onRequestRemove}
            size="icon-xs"
            variant="ghost"
          >
            <TrashIcon />
          </Button>
        )}
      </span>
    </li>
  );
}
