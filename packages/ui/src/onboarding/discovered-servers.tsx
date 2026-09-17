"use client";

// "Found on this machine". perch never bundles a database; it looks for the one you already have —
// on a default port, installed as a service, in a container, or on PATH — which turns the worst
// moment of a first run, a blank form asking for a host and port, into a row with a button on it.
//
// The scan is the async thing, so it carries the states: skeletons while it runs, an error with a
// retry, an empty state naming what was looked for. A server that answers a TCP probe still has to
// accept a password, so the caller falls back to the form when it will not.

import type { DiscoveredServer, DiscoveryResult, DiscoverySource } from "@perch/protocol";
import { RefreshCwIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import * as React from "react";
import { messageOf } from "../lib/errors";
import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "../ui/empty";
import { Skeleton } from "../ui/skeleton";
import { useWorkspace } from "../workspace/context";
import { StatusDot } from "../workspace/status-dot";
import {
  asyncData,
  asyncError,
  asyncLoading,
  asyncReady,
  asyncRefreshing,
  type Async,
  type ConnectionInput,
} from "../workspace/types";
import { DIALECT_DEFAULTS, DialectMark } from "./dialect-mark";

/**
 * A starting point for the connection form, from a server already there. Named `<dialect>-local`,
 * which is what it is; no password, because none was discovered and inventing one moves the failure.
 */
function connectionInputFromServer(server: DiscoveredServer, osUser: string): ConnectionInput {
  const fallback = DIALECT_DEFAULTS[server.dialect];
  let user = osUser;
  let database = fallback.database;

  try {
    const url = new URL(server.suggestedUrl);
    if (url.username) user = decodeURIComponent(url.username);
    const path = url.pathname.replace(/^\//, "");
    if (path) database = decodeURIComponent(path);
  } catch {
    // An unparseable URL is not worth failing over: host, port and dialect come from the
    // structured fields either way.
  }

  return {
    name: `${server.dialect}-local`,
    dialect: server.dialect,
    host: server.host,
    port: server.port,
    user,
    database,
  };
}

/** Service beats container beats binary beats "something answered" — the most specific wins. */
const SOURCE_RANK: Record<DiscoverySource, number> = {
  brew: 0,
  systemd: 1,
  windows: 2,
  docker: 3,
  binary: 4,
  port: 5,
};

function primarySource(server: DiscoveredServer): DiscoverySource | undefined {
  return [...server.sources].sort((a, b) => SOURCE_RANK[a] - SOURCE_RANK[b])[0];
}

/** Reachable first, then the more specific find, then a stable order by address. */
function order(servers: readonly DiscoveredServer[]): DiscoveredServer[] {
  return [...servers].sort((a, b) => {
    if (a.reachable !== b.reachable) return a.reachable ? -1 : 1;
    const rank =
      (SOURCE_RANK[primarySource(a) ?? "port"] ?? 9) -
      (SOURCE_RANK[primarySource(b) ?? "port"] ?? 9);
    if (rank !== 0) return rank;
    return `${a.host}:${a.port}`.localeCompare(`${b.host}:${b.port}`);
  });
}

/** Stable identity for a row: what the scan found at one address, for one dialect. */
export function serverKey(server: DiscoveredServer): string {
  return `${server.dialect}:${server.host}:${server.port}`;
}

export type DiscoveredServersProps = {
  /** Called with a filled-in `ConnectionInput` when the row's Connect button is pressed. */
  onSelect: (input: ConnectionInput, server: DiscoveredServer) => void;
  /** `serverKey` of the row currently being connected, if any — it shows the spinner. */
  pending?: string | null;
  /**
   * What a finished scan found, reported upward: with nothing on the machine there is no fast path,
   * and the manual form should already be open rather than folded behind a disclosure.
   */
  onResult?: (servers: readonly DiscoveredServer[]) => void;
  className?: string;
};

export function DiscoveredServers({
  onSelect,
  pending = null,
  onResult,
  className,
}: DiscoveredServersProps): React.ReactElement {
  const { discoverServers } = useWorkspace();

  // Starts loading rather than idle: the scan runs on mount, so there is no frame in which
  // nothing has been asked for.
  const [scanned, setScanned] = React.useState<Async<DiscoveryResult>>(asyncLoading);

  // In a ref, so a provider rebuilding its closures each render cannot restart the scan: it runs
  // on mount and when asked, and at no other time.
  const scan = React.useRef(discoverServers);
  scan.current = discoverServers;
  const report = React.useRef(onResult);
  report.current = onResult;

  const run = React.useCallback(() => {
    let cancelled = false;
    setScanned(asyncRefreshing);
    scan.current().then(
      (value) => {
        if (cancelled) return;
        setScanned(asyncReady(value));
        report.current?.(value.servers);
      },
      (cause: unknown) => {
        if (cancelled) return;
        setScanned((previous) => asyncError(messageOf(cause), previous));
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  React.useEffect(() => run(), [run]);

  const result = asyncData(scanned);
  const servers = result ? order(result.servers) : [];
  const error = scanned.status === "error" ? scanned.error : null;
  // The two states the header tells apart: a scan with nothing yet behind it fills the panel with
  // skeletons, while a rescan over a list already on screen is a spinner in the Rescan button.
  const first = scanned.status === "loading";
  const scanning = first || (scanned.status === "ready" && scanned.stale);

  return (
    <section className={cn("flex flex-col gap-2", className)}>
      <header className="flex h-6 items-center justify-between gap-2">
        <h3 className="font-medium text-muted-foreground text-xs">Found on this machine</h3>
        <Button
          aria-label="Rescan for database servers"
          // Shares the card's right-hand edge with the Skip button at the foot of the screen.
          className="-mr-2"
          disabled={scanning}
          loading={scanning && !first}
          onClick={() => void run()}
          size="xs"
          variant="ghost"
        >
          <RefreshCwIcon />
          Rescan
        </Button>
      </header>

      {first && <ScanSkeleton />}

      {!first && error !== null && (
        <Alert variant="error">
          <TriangleAlertIcon />
          <AlertTitle>The scan failed</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* The commonest first run that goes nowhere: no database on this machine at all. Saying
          what was actually looked for turns "nothing found" from a dead end into a thing the
          reader can check — the ports are the answer to "did it even look?". */}
      {!first && error === null && servers.length === 0 && (
        <Empty variant="outlined">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchXIcon />
            </EmptyMedia>
            <EmptyTitle>No database found here</EmptyTitle>
            <EmptyDescription>
              Nothing answered on {DIALECT_DEFAULTS.postgres.port} or {DIALECT_DEFAULTS.mysql.port},
              and no service or container turned up. Enter the details below if your server is
              somewhere else.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}

      {servers.length > 0 && (
        <ul className="flex flex-col gap-1">
          {servers.map((server) => (
            <ServerRow
              key={serverKey(server)}
              onSelect={() =>
                onSelect(connectionInputFromServer(server, result?.osUser ?? ""), server)
              }
              pending={pending === serverKey(server)}
              server={server}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function ServerRow({
  server,
  onSelect,
  pending,
}: {
  server: DiscoveredServer;
  onSelect: () => void;
  pending: boolean;
}): React.ReactElement {
  const source = primarySource(server);
  return (
    // The address identifies the row and must never truncate. The binary path says how the server
    // was found, not which server it is, so it lives in the tooltip.
    <li
      className="flex h-9 items-center gap-2 rounded-md border border-border px-2"
      title={server.label ?? undefined}
    >
      <DialectMark className="shrink-0 text-muted-foreground" dialect={server.dialect} />
      <StatusDot
        label={server.reachable ? "Reachable" : "Not answering"}
        status={server.reachable ? "connected" : "idle"}
      />
      <span className="shrink-0 font-mono text-xs">
        {server.host}:{server.port}
      </span>
      {server.version !== undefined && (
        <span className="min-w-0 flex-1 truncate text-muted-foreground text-xs">
          {server.version}
        </span>
      )}
      <span className="ml-auto shrink-0 text-muted-foreground text-xs">{source}</span>
      <Button className="shrink-0" loading={pending} onClick={onSelect} size="xs" variant="outline">
        Connect
      </Button>
    </li>
  );
}

function ScanSkeleton(): React.ReactElement {
  return (
    <ul aria-label="Scanning for database servers" className="flex flex-col gap-1">
      {[0, 1].map((row) => (
        <li className="flex h-9 items-center gap-2 rounded-md border border-border px-2" key={row}>
          <Skeleton className="size-4" />
          <Skeleton className="h-3 w-32" />
          <Skeleton className="ml-auto h-3 w-16" />
        </li>
      ))}
    </ul>
  );
}
