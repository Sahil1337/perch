// Whether the welcome flow has anything to say.
//
// Two conditions have to agree. The first is factual: with no connection there is nothing to show
// but a setup screen. The second is consent — someone who has been through this (or skipped it)
// never sees it again, even after deleting every connection, because re-running onboarding at
// someone mid-cleanup is an interruption, not help.
//
// That consent is `settings.onboarded`, so it lives in ~/.perch/settings.json rather than in
// localStorage: onboarding is a property of the installation, not of one browser profile.

import * as React from "react";
import { useWorkspace } from "../workspace/context";

/**
 * True when the full-screen welcome flow should be mounted. False while settings load: an unloaded
 * settings object and a genuinely empty one look identical, and flashing a welcome screen over a
 * workspace that was about to render is the failure mode worth designing out.
 */
export function useNeedsOnboarding(): boolean {
  const { settings, connections } = useWorkspace();

  if (settings.status !== "ready" && settings.status !== "error") return false;
  if (settings.status === "error" && settings.data === undefined) return false;
  if (connections.status !== "ready") return false;

  // An error with a last-known value still says what it said; an unreadable file claims nothing.
  const onboarded = settings.data?.onboarded ?? false;

  // The flag is the whole condition: it is only false on a first run, or because someone asked for
  // this screen from the picker. Requiring "and no connections exist" on top would make the way back
  // silently do nothing. Workspaces are not asked for up front, so this screen is only about a
  // connection.
  return !onboarded;
}

/**
 * Records that the user has been through the flow, or chose not to. Idempotent, and fire-and-forget:
 * the flow is already closing, and losing the write costs one extra welcome screen.
 */
export function useMarkOnboarded(): () => void {
  const { updateSettings } = useWorkspace();
  return React.useCallback(() => {
    // Deliberately unobserved: see above. `catch` only so a rejection is not unhandled.
    void updateSettings({ onboarded: true }).catch(() => {});
  }, [updateSettings]);
}

/** Dispatch on `window` to reopen the setup screen over the workspace. */
const CONNECT_SETUP_EVENT = "perch:connect-setup";

/**
 * The way back to the setup screen — what the connection picker's "Connect a database…" calls.
 *
 * An event, not a settings write. Clearing `onboarded` to reopen the screen said something false
 * about the installation (this one has seen the welcome flow) and left it saying so on disk if the
 * window closed before the screen was dismissed. Wanting a second server is not un-onboarding.
 */
export function requestConnectSetup(): void {
  window.dispatchEvent(new CustomEvent(CONNECT_SETUP_EVENT));
}

/**
 * Whether to mount the flow, and how it reports being finished. The derived value only ever *starts*
 * it: the flow's job is to create a connection, so it would otherwise unmount itself mid-dial and
 * take the handover screen with it. Ending is the flow's call, and "Skip for now" is an ending too.
 */
export function useOnboardingFlow(): { readonly open: boolean; readonly done: () => void } {
  const needed = useNeedsOnboarding();
  const markOnboarded = useMarkOnboarded();
  const [finished, setFinished] = React.useState(false);

  // Latched, because the derived value only ever starts the flow. State rather than a ref: the
  // latch has to be visible on the render that first needed it — hence `needed ||` below rather
  // than an effect, which would leave a frame with the flow needed and nothing mounted — and a
  // render React discards must not be able to latch a flow the user never saw.
  const [started, setStarted] = React.useState(false);
  if (needed && !started) setStarted(true);

  // Asked for from the workspace, which is the one thing the latch above cannot express: the flow
  // is finished and the flag is set, and the answer to "connect another database" is still this
  // screen. It reopens without touching settings, and `done` closes it again.
  React.useEffect(() => {
    const listener = (): void => {
      setStarted(true);
      setFinished(false);
    };
    window.addEventListener(CONNECT_SETUP_EVENT, listener);
    return () => window.removeEventListener(CONNECT_SETUP_EVENT, listener);
  }, []);

  const done = React.useCallback((): void => {
    markOnboarded();
    setFinished(true);
  }, [markOnboarded]);

  return { open: (needed || started) && !finished, done };
}
