import type {
  ConnectFailureCode,
  ConnectionSummary,
  Dialect,
  DiscoveredServer,
} from "@perch/protocol";
import * as React from "react";
import { failureCodeOf, isPasswordFailure, messageOf } from "../lib/errors";
import { useWorkspace } from "../workspace/context";
import { asyncData, type ConnectionInput } from "../workspace/types";
import { suggestedName } from "./connection-name";
import { serverKey, type DiscoveredInput } from "./discovered-servers";
import type { PasswordChallenge } from "./password-prompt";

/**
 * How far the one action on this screen has got. One value rather than three, because the three it
 * replaced could never be true at once and reading them together was the only way to know that:
 * a dial in flight has no error, and a dial that succeeded is no longer in flight.
 */
export type ConnectPhase =
  | { kind: "idle" }
  /** `target` is a connection id or a discovered row's key, whichever the spinner belongs to. */
  | { kind: "connecting"; target: string }
  | { kind: "failed"; message: string; code: ConnectFailureCode }
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

/** The saved connection already pointing at this address, if there is one. */
function savedFor(
  server: DiscoveredServer,
  saved: readonly ConnectionSummary[],
): ConnectionSummary | undefined {
  return saved.find(
    (item) =>
      item.dialect === server.dialect && item.port === server.port && sameHost(item.host, server.host),
  );
}

/** `localhost` and `127.0.0.1` are the same machine, and discovery reports the latter. */
function sameHost(a: string, b: string): boolean {
  const local = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
  return a === b || (local.has(a) && local.has(b));
}

function failure(cause: unknown): ConnectPhase {
  return {
    kind: "failed",
    message: messageOf(cause),
    code: failureCodeOf(cause) ?? "connect_failed",
  };
}

export function useOnboardingConnect(): {
  readonly phase: ConnectPhase;
  readonly prefill: Prefill | null;
  readonly challenge: PasswordChallenge | null;
  /** The id or key currently being dialled, for the row that should show a spinner. */
  readonly pending: string | null;
  open: (connectionId: string, password?: string, user?: string) => Promise<void>;
  connectDiscovered: (
    input: DiscoveredInput,
    server: DiscoveredServer,
    password?: string,
  ) => Promise<void>;
  /** Drops the password prompt without dialling — the row goes back to a Connect button. */
  dismissChallenge: () => void;
} {
  const { connections, addConnection, updateConnection, connect } = useWorkspace();
  const [phase, setPhase] = React.useState<ConnectPhase>({ kind: "idle" });
  const [prefill, setPrefill] = React.useState<Prefill | null>(null);
  const [challenge, setChallenge] = React.useState<PasswordChallenge | null>(null);

  const saved = asyncData(connections) ?? [];

  /**
   * Open a connection that already exists, and hand over to the connecting screen if it answers.
   *
   * Not `onDone`: the dial is done but the workspace is still fetching a schema, and the handover
   * screen exists to cover that. It finishes the flow itself when it is through.
   */
  async function open(connectionId: string, password?: string, user?: string): Promise<void> {
    const record = saved.find((item) => item.id === connectionId);
    setPhase({ kind: "connecting", target: connectionId });
    try {
      // `user` is undefined unless the prompt corrected it, and an undefined field is one the
      // server leaves alone: this patches the login only when there is a new one to patch.
      if (password !== undefined) await updateConnection(connectionId, { password, user });
      await connect(connectionId);
      setChallenge(null);
      setPhase({
        kind: "opening",
        dialect: record?.dialect ?? "postgres",
        name: record?.name ?? "",
      });
    } catch (cause) {
      if (isPasswordFailure(cause)) {
        setChallenge({
          target: connectionId,
          user: user ?? record?.user ?? "",
          refused: password !== undefined,
        });
        setPhase({ kind: "idle" });
        return;
      }
      setChallenge(null);
      setPhase(failure(cause));
    }
  }

  /**
   * The discovery fast path: save what was found, dial it, and go.
   *
   * A server already on disk is reused rather than saved again — pressing Connect twice on the
   * same row is a retry, not a request for a second copy, and the name collision that made was
   * the commonest way this screen failed.
   *
   * A password is the likeliest reason the dial does not land, and it comes back as a prompt on
   * the row. Anything else falls through to the form with the details filled in; the connection
   * stays saved, so fixing it there fixes that record rather than making another.
   */
  async function connectDiscovered(
    input: DiscoveredInput,
    server: DiscoveredServer,
    password?: string,
  ): Promise<void> {
    const key = serverKey(server);
    setPhase({ kind: "connecting", target: key });

    const existing = savedFor(server, saved);
    let record: ConnectionSummary;
    try {
      record =
        existing === undefined
          ? await addConnection({ ...input, name: suggestedName(server, saved), password })
          : password === undefined
            ? existing
            : await updateConnection(existing.id, { password, user: input.user });
    } catch (cause) {
      setPhase(failure(cause));
      return;
    }

    try {
      await connect(record.id);
      setChallenge(null);
      setPhase({ kind: "opening", dialect: record.dialect, name: record.name });
    } catch (cause) {
      if (isPasswordFailure(cause)) {
        setChallenge({ target: key, user: input.user ?? "", refused: password !== undefined });
        setPhase({ kind: "idle" });
        return;
      }
      setChallenge(null);
      setPhase(failure(cause));
      setPrefill((previous) => ({
        input: { ...input, name: record.name },
        seq: (previous?.seq ?? 0) + 1,
      }));
    }
  }

  return {
    phase,
    prefill,
    challenge,
    pending: phase.kind === "connecting" ? phase.target : null,
    open,
    connectDiscovered,
    dismissChallenge: () => setChallenge(null),
  };
}
