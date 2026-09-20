import type { ConnectionSummary } from "@perch/protocol";
import type * as React from "react";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import { ROW_COLUMN } from "./column";
import { DialectMark } from "./dialect-mark";
import { PasswordPrompt, type PasswordChallenge } from "./password-prompt";

/** Connections this machine already has. Opening one is the shortest route past this screen. */
export function SavedConnections({
  connections,
  pending,
  challenge = null,
  onDismissChallenge,
  onOpen,
}: {
  connections: readonly ConnectionSummary[];
  /** The id currently being dialled, if any — it shows the spinner. */
  pending: string | null;
  /**
   * The connection whose server asked for a password. A saved connection reaches this as often as
   * a discovered one does: the password lives in the server's config file, and the file is easy to
   * copy between machines without it.
   */
  challenge?: PasswordChallenge | null;
  onDismissChallenge?: () => void;
  onOpen: (connectionId: string, password?: string) => void;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h3 className={cn(ROW_COLUMN, "font-medium text-muted-foreground text-xs")}>
        Already configured
      </h3>
      <ul className="flex flex-col gap-1">
        {connections.map((item) => (
          <li className="rounded-md border border-border" key={item.id}>
            <div className="flex h-9 items-center gap-2 px-2">
              <DialectMark className="text-muted-foreground" dialect={item.dialect} />
              <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
              <span className="shrink-0 font-mono text-muted-foreground text-xs">
                {item.host}:{item.port}
              </span>
              <Button
                className="shrink-0"
                loading={pending === item.id}
                onClick={() => onOpen(item.id)}
                size="xs"
                variant="outline"
              >
                Connect
              </Button>
            </div>

            {challenge?.target === item.id && (
              <PasswordPrompt
                onCancel={() => onDismissChallenge?.()}
                onSubmit={(password) => onOpen(item.id, password)}
                pending={pending === item.id}
                refused={challenge.refused}
                user={challenge.user}
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
