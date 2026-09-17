"use client";

import type { ConnectionSummary } from "@perch/protocol";
import type * as React from "react";
import { Button } from "../ui/button";
import { DialectMark } from "./dialect-mark";

/** Connections this machine already has. Opening one is the shortest route past this screen. */
export function SavedConnections({
  connections,
  pending,
  onOpen,
}: {
  connections: readonly ConnectionSummary[];
  /** The id currently being dialled, if any — it shows the spinner. */
  pending: string | null;
  onOpen: (connectionId: string) => void;
}): React.ReactElement {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-medium text-muted-foreground text-xs">Already configured</h3>
      <ul className="flex flex-col gap-1">
        {connections.map((item) => (
          <li
            className="flex h-9 items-center gap-2 rounded-md border border-border px-2"
            key={item.id}
          >
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
          </li>
        ))}
      </ul>
    </section>
  );
}
