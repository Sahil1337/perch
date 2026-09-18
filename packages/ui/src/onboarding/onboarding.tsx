// The first run.
//
// One screen, not a wizard: get perch pointed at a database. Everything else the app can either
// work out or ask for at the moment it matters — a folder is an empty Files panel offering to open
// one, and the database is already named by the connection URL and switched from the topbar. The
// connection is the one thing without which nothing works at all.
//
// Discovery is the fast path, and it commits: pressing Connect on a server found on this machine
// saves it, dials it, and drops you into the workspace. When the dial fails — nearly always a
// password — the form opens with that server's details already in it and the error attached.
//
// This file owns what is on screen; the dialling itself is `use-onboarding-connect.ts`.

import type { Dialect, DiscoveredServer } from "@perch/protocol";
import { ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as React from "react";
import { cn } from "../lib/utils";
import { Alert, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import { useWorkspace } from "../workspace/context";
import { ConnectingScreen } from "./connecting-screen";
import { ConnectionBeam } from "./connection-beam";
import { ConnectionForm } from "./connection-form";
import { DiscoveredServers } from "./discovered-servers";
import { Collapse, Skip } from "./onboarding-motion";
import { preferDialect } from "./prefer-dialect";
import { SavedConnections } from "./saved-connections";
import { useMarkOnboarded } from "./use-onboarding";
import { useOnboardingConnect } from "./use-onboarding-connect";

/**
 * A ghost button on the card's content edge, pulled out by its own padding so the *text* lands on
 * the column everything else is aligned to while the pressable area keeps its size.
 */
const EDGE_LEFT = "-ml-2";

export type OnboardingProps = {
  /** Called once the user connects or skips. The flow marks itself done before calling it. */
  onDone: () => void;
};

export function Onboarding({ onDone }: OnboardingProps): React.ReactElement {
  const { connections } = useWorkspace();
  const markOnboarded = useMarkOnboarded();
  const { phase, prefill, pending, open, connectDiscovered } = useOnboardingConnect();

  const saved = connections.status === "ready" ? connections.data : [];

  /** What the scan came back with, or null while it is still running. */
  const [found, setFound] = React.useState<readonly DiscoveredServer[] | null>(null);
  const [manual, setManual] = React.useState(false);
  /** The dialect the open form is describing, which outranks anything the scan found. */
  const [chosen, setChosen] = React.useState<Dialect | null>(null);

  // With nothing found and nothing configured there is no fast path, so the form becomes the
  // screen rather than hiding behind a disclosure triangle.
  const nothingToPick = found !== null && found.length === 0 && saved.length === 0;
  const formOpen = manual || nothingToPick || prefill !== null;

  // Only hide the fast path when the user chose the form. When it opened itself on an empty scan,
  // the scan's result explains why — and owns Rescan — so that case keeps its list.
  const bypassed = manual || prefill !== null;

  /**
   * Whose mark goes on the far end of the link. While the form is open it is whichever card is
   * pressed; otherwise it is what is on this machine, by an explicit rule — answering beats merely
   * installed, and Postgres breaks the tie.
   */
  const dialect: Dialect = chosen ?? preferDialect(found, saved) ?? "postgres";
  const linked = saved.length > 0 || (found?.length ?? 0) > 0;

  function finish(): void {
    markOnboarded();
    onDone();
  }

  // Everything else unmounts: the handover screen is the app for as long as it is up.
  if (phase.kind === "opening") {
    return (
      <div className="fixed inset-0 z-50 bg-background">
        <ConnectingScreen dialect={phase.dialect} name={phase.name} onDone={finish} />
      </div>
    );
  }

  return (
    <div
      aria-label="Connect to a database"
      aria-modal
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-background p-6 outline-none"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        finish();
      }}
      role="dialog"
      tabIndex={-1}
    >
      <div className="my-auto flex w-full max-w-lg flex-col gap-5 rounded-lg border border-border bg-card p-6">
        {/* The picture makes the point the copy would otherwise have to, so one line is enough —
            and it leaves as soon as the form opens. */}
        <header className="flex flex-col items-center gap-3 text-center">
          <ConnectionBeam dialect={dialect} linked={linked} />
          <h2 className="font-medium text-base">Connect a database</h2>
          <AnimatePresence initial={false}>
            {!formOpen && (
              <Collapse key="lede">
                <p className="text-balance text-muted-foreground text-sm">
                  Perch never bundles one — point it at a server you already have.
                </p>
              </Collapse>
            )}
          </AnimatePresence>
        </header>

        {/* A failed dial is the reason someone is still on this screen, so it gets to look like
            one. It was a 12px red sentence, which is not what "your database refused you" reads
            like. */}
        {phase.kind === "failed" && (
          <Alert variant="error">
            <TriangleAlertIcon />
            <AlertTitle>That connection did not answer</AlertTitle>
            <AlertDescription>{phase.message}</AlertDescription>
          </Alert>
        )}

        <AnimatePresence initial={false}>
          {!bypassed && (
            <Collapse key="pick">
              <div className="flex flex-col gap-5">
                {saved.length > 0 && (
                  <SavedConnections
                    connections={saved}
                    onOpen={(id) => void open(id)}
                    pending={pending}
                  />
                )}

                <DiscoveredServers
                  onResult={setFound}
                  onSelect={(input, server) => void connectDiscovered(input, server)}
                  pending={pending}
                />
              </div>
            </Collapse>
          )}
        </AnimatePresence>

        {/* Seven fields, folded. Discovery is the fast path and it cannot be the fast path while
            the thing it saves you from is sitting open underneath it. The trigger disappears when
            there is nothing to discover, because then the form is not an alternative — it is the
            screen, and a disclosure around it would only be one more thing to press.

            Folded, the two ways past the fast path share this line: the form on the left, leaving
            on the right, which rhymes with the discovery header above — label left, action right.
            It is also where Skip stops being a button on a row of its own with nothing to line up
            against. Unfolded, the bottom of the screen moves into the form and Skip goes with it;
            see <Skip>. */}
        <Collapsible onOpenChange={setManual} open={formOpen}>
          {!nothingToPick && (
            <div className="flex items-center justify-between gap-2">
              <CollapsibleTrigger
                render={<Button className={EDGE_LEFT} size="xs" variant="ghost" />}
              >
                <ChevronRightIcon
                  className={cn("transition-transform duration-200", formOpen && "rotate-90")}
                />
                Enter details manually
              </CollapsibleTrigger>
              <Skip onClick={finish} show={!formOpen} />
            </div>
          )}
          <CollapsiblePanel>
            <div className={cn(!nothingToPick && "pt-3")}>
              <ConnectionForm
                defaultDialect={preferDialect(found, saved) ?? "postgres"}
                initial={prefill?.input}
                key={prefill?.seq ?? 0}
                onDialectChange={setChosen}
                onSaved={(connection, test) => {
                  // Unreachable keeps you here with the error on the field that caused it.
                  if (test !== null) void open(connection.id);
                }}
                submitLabel="Connect"
                trailing={<Skip onClick={finish} show={formOpen} />}
              />
            </div>
          </CollapsiblePanel>
        </Collapsible>
      </div>
    </div>
  );
}
