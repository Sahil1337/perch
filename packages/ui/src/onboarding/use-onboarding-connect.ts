import type { ConnectionSummary, Dialect, DiscoveredServer } from "@perch/protocol";
import * as React from "react";
import { messageOf } from "../lib/errors";
import { useWorkspace } from "../workspace/context";
import type { ConnectionInput } from "../workspace/types";
import { serverKey } from "./discovered-servers";

/**
 * How far the one action on this screen has got. One value rather than three, because the three it
 * replaced could never be true at once and reading them together was the only way to know that:
 * a dial in flight has no error, and a dial that succeeded is no longer in flight.
 */
export type ConnectPhase =
  | { kind: "idle" }
  /** `target` is a connection id or a discovered row's key, whichever the spinner belongs to. */
  | { kind: "connecting"; target: string }
  | { kind: "failed"; message: string }
  /** The dial answered. The card unmounts and the handover screen takes over. */
  | { kind: "opening"; dialect: Dialect; name: string };

/**
 * What the form should start from after a failed fast path, and a counter that remounts it.
 *
 * Remounted on a pick rather than fed through props: the form owns its fields, and an effect
 * pushing values into them would fight whatever the user had typed. Kept out of `ConnectPhase`
 * because it outlives the failure that produced it — the form stays open and filled in while the
 * user tries something else.
 */
export type Prefill = { input: ConnectionInput; seq: number };

export function useOnboardingConnect(): {
  readonly phase: ConnectPhase;
  readonly prefill: Prefill | null;
  /** The id or key currently being dialled, for the row that should show a spinner. */
  readonly pending: string | null;
  open: (connectionId: string) => Promise<void>;
  connectDiscovered: (input: ConnectionInput, server: DiscoveredServer) => Promise<void>;
} {
  const { connections, addConnection, testConnection, connect } = useWorkspace();
  const [phase, setPhase] = React.useState<ConnectPhase>({ kind: "idle" });
  const [prefill, setPrefill] = React.useState<Prefill | null>(null);

  /**
   * Open a connection that already exists, and hand over to the connecting screen if it answers.
   *
   * Not `onDone`: the dial is done but the workspace is still fetching a schema, and the handover
   * screen exists to cover that. It finishes the flow itself when it is through.
   */
  async function open(connectionId: string): Promise<void> {
    setPhase({ kind: "connecting", target: connectionId });
    try {
      await connect(connectionId);
      const record =
        connections.status === "ready"
          ? connections.data.find((item) => item.id === connectionId)
          : undefined;
      setPhase({
        kind: "opening",
        dialect: record?.dialect ?? "postgres",
        name: record?.name ?? "",
      });
    } catch (cause) {
      setPhase({ kind: "failed", message: messageOf(cause) });
    }
  }

  /**
   * The discovery fast path: save what was found, dial it, and go. A failure is nearly always a
   * password, so it lands in the form with the details filled in. The connection stays saved and
   * `connectionId` points the form at it, so retrying fixes that record rather than making another.
   */
  async function connectDiscovered(
    input: ConnectionInput,
    server: DiscoveredServer,
  ): Promise<void> {
    setPhase({ kind: "connecting", target: serverKey(server) });
    let created: ConnectionSummary;
    try {
      created = await addConnection(input);
    } catch (cause) {
      setPhase({ kind: "failed", message: messageOf(cause) });
      return;
    }
    try {
      await testConnection(created.id);
      await connect(created.id);
      setPhase({ kind: "opening", dialect: created.dialect, name: created.name });
    } catch (cause) {
      setPhase({ kind: "failed", message: messageOf(cause) });
      setPrefill((previous) => ({ input, seq: (previous?.seq ?? 0) + 1 }));
    }
  }

  return {
    phase,
    prefill,
    pending: phase.kind === "connecting" ? phase.target : null,
    open,
    connectDiscovered,
  };
}
