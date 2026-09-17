"use client";

import type { ConnectionSummary } from "@perch/protocol";
import { CheckIcon, PencilIcon, TrashIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type * as React from "react";
import { useFade } from "../../lib/motion";
import { cn } from "../../lib/utils";
import { DialectMark } from "../../onboarding/dialect-mark";
import { Button } from "../../ui/button";
import { Spinner } from "../../ui/spinner";
import { StatusDot, dotStatusOf } from "../../workspace/status-dot";
import type { TestState } from "./use-connection-actions";

/** One saved connection, with Test, Edit and Remove all reporting into the row they belong to. */
export function ConnectionRow({
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
      <StatusDot label={connection.status} status={dotStatusOf(connection.status)} />
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
        <Button
          aria-label={`Edit ${connection.name}`}
          onClick={onEdit}
          size="icon-xs"
          variant="ghost"
        >
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
