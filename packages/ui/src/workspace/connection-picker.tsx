"use client";

import { CheckIcon, ChevronDownIcon, PlusIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import * as React from "react";
import { useSpring } from "../lib/motion";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";
import { CONNECT_MS, CONNECT_STAGES } from "../onboarding/connecting-screen";
import { useResetOnboarded } from "../onboarding/use-onboarding";
import { useConnecting } from "./connecting-overlay";
import { useWorkspace } from "./context";

/**
 * Which server, and which database on it — the one control that changes the meaning of every other
 * surface, so it sits in the topbar rather than behind a settings screen.
 *
 * One menu, not two: picking a connection is almost always followed by picking a database, and two
 * adjacent dropdowns make one job look like two. A separator keeps them distinguishable, and each
 * list renders its own loading and error state, so a schema that will not introspect never blanks
 * the connection you are on.
 */
export function ConnectionPicker({
  compact = false,
  className,
}: {
  /** Renders `name · database` on one line, for bars too tight for the dialect. */
  compact?: boolean;
  className?: string;
}): React.ReactElement {
  const { connections, connection, database, databases, connect, selectDatabase } = useWorkspace();
  // Both picks invalidate every pane behind this menu, so both go behind the handover screen.
  const { cover } = useConnecting();
  // The way back to the setup screen, after "Skip for now" or to add another server.
  const showSetup = useResetOnboarded();

  const connected = connection?.status === "connected";
  const currentDatabase = database ?? connection?.database ?? null;
  const pending = connections.status === "loading" || connections.status === "idle";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button className={cn("max-w-64", className)} size="sm" variant="outline" />}
      >
        <StatusDot animate connected={connected} />
        {connection ? (
          <span className="min-w-0 truncate">
            {compact && currentDatabase ? `${connection.name} · ${currentDatabase}` : connection.name}
          </span>
        ) : pending ? (
          <Skeleton className="h-3.5 w-24" />
        ) : (
          <span className="text-muted-foreground">No connection</span>
        )}
        {!compact && connection && (
          <span className="text-muted-foreground">{connection.dialect}</span>
        )}
        <ChevronDownIcon />
      </DropdownMenuTrigger>

      {/* Each section is one group, and each label lives *inside* the group it names. Base UI
          enforces that: `Menu.GroupLabel` reads its group's context to label it, and a label with
          no group above it threw — which took the whole page down the moment this menu opened. */}
      <DropdownMenuContent align="start" className="w-72" sideOffset={6}>
        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="flex items-center gap-1.5">
              Connections
              {connections.status === "ready" && connections.stale && <RefreshingHint />}
            </span>
          </DropdownMenuLabel>

          {(connections.status === "loading" || connections.status === "idle") && <RowSkeletons />}

          {connections.status === "error" && <ErrorRow message={connections.error} />}

          {(connections.status === "ready" || connections.status === "error") &&
            connections.data !== undefined &&
            (connections.data.length === 0 ? (
              <DropdownMenuItem onClick={showSetup}>
                <PlusIcon />
                <span>Connect a database…</span>
              </DropdownMenuItem>
            ) : (
              connections.data.map((item) => (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => {
                    // Already on it: re-dialling would cover the screen to change nothing.
                    if (item.id === connection?.id) return;
                    void cover(
                      {
                        dialect: item.dialect,
                        durationMs: CONNECT_MS,
                        name: item.name,
                        stages: CONNECT_STAGES,
                      },
                      () => connect(item.id),
                    ).catch(() => {});
                  }}
                >
                  <StatusDot connected={item.status === "connected"} />
                  <span className="truncate">{item.name}</span>
                  <span className="ml-auto truncate text-muted-foreground">{item.host}</span>
                </DropdownMenuItem>
              ))
            ))}

          {/* Always here, not only when the list is empty: "connect to something else" is the
              same question as "connect to something", and it has the same answer. */}
          {connections.status === "ready" && connections.data.length > 0 && (
            <DropdownMenuItem onClick={showSetup}>
              <PlusIcon />
              <span>Connect a database…</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>
            <span className="flex items-center gap-1.5">
              Databases
              {databases.status === "ready" && databases.stale && <RefreshingHint />}
            </span>
          </DropdownMenuLabel>

          {(databases.status === "loading" || databases.status === "idle") && <RowSkeletons />}

          {databases.status === "error" && <ErrorRow message={databases.error} />}

          {(databases.status === "ready" || databases.status === "error") &&
            databases.data !== undefined &&
            (databases.data.length === 0 ? (
              <EmptyRow>No databases</EmptyRow>
            ) : (
              databases.data.map((name) => (
                <DropdownMenuItem
                  key={name}
                  onClick={() => {
                    if (name === currentDatabase) return;
                    void cover(
                      {
                        dialect: connection?.dialect ?? "postgres",
                        name,
                        title: `Switching to ${name}`,
                      },
                      () => selectDatabase(name),
                    ).catch(() => {});
                  }}
                >
                  <CheckIcon className={cn(name !== currentDatabase && "invisible")} />
                  <span className="truncate">{name}</span>
                </DropdownMenuItem>
              ))
            ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusDot({
  connected,
  animate = false,
}: {
  connected: boolean;
  /** Pops the dot on a status change. Only the trigger: the same dot repeats down the list. */
  animate?: boolean;
}): React.ReactElement {
  const spring = useSpring();

  const dot = (
    <span
      aria-hidden
      className={cn(
        "size-1.5 shrink-0 rounded-full",
        connected ? "bg-success" : "bg-muted-foreground/40",
      )}
    />
  );

  if (!animate) return dot;

  // Connecting is slow and invisible, and a dot that simply *is* green throws away the only
  // feedback the topbar can give for work that just landed.
  return (
    <span className="relative inline-flex size-1.5 shrink-0 items-center justify-center">
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          animate={{ scale: 1, opacity: 1 }}
          className="absolute inset-0 inline-flex items-center justify-center"
          exit={{ scale: 0.4, opacity: 0 }}
          initial={{ scale: 0.4, opacity: 0 }}
          key={connected ? "connected" : "disconnected"}
          transition={spring}
        >
          {dot}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** A refetch is in flight over data already on screen — quiet on purpose. */
function RefreshingHint(): React.ReactElement {
  return <Spinner aria-label="Refreshing" className="size-3" />;
}

function RowSkeletons(): React.ReactElement {
  return (
    <div className="flex flex-col gap-1 p-1">
      <Skeleton className="h-5 w-full" />
      <Skeleton className="h-5 w-4/5" />
    </div>
  );
}

function ErrorRow({ message }: { message: string }): React.ReactElement {
  return (
    <p className="px-2 py-1 text-destructive-foreground text-xs" role="alert">
      {message}
    </p>
  );
}

function EmptyRow({ children }: { children: React.ReactNode }): React.ReactElement {
  return <p className="px-2 py-1 text-muted-foreground text-xs">{children}</p>;
}
