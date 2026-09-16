"use client";

// What the app is instead of a workspace when there is no server to be a workspace against.
//
// Everything below this gate assumes its data is real — the schema tree, the connection picker,
// the results grid. Mounting them against a server that is not answering produces eleven panels
// each rendering its own copy of the same failure, which is a lot of screen spent saying one
// thing badly. So the shell renders this instead, and it says the one thing once.
//
// There is only one failure to say: nothing is listening. The server has no auth — loopback is the
// boundary — so a reachable server is a usable one, and the fix is always the same command.

import { motion } from "motion/react";
import * as React from "react";
import { PerchBadge, PerchLogo } from "../brand/logo";
import { useFade, useSpring } from "../lib/motion";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { useWorkspace } from "./context";

/** Inline code, for the commands these screens exist to tell you to run. */
function Code({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <code className="whitespace-nowrap rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground">
      {children}
    </code>
  );
}

function Centered({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-background p-6">
      {children}
    </div>
  );
}

/**
 * The gate itself. Rendered by the shell whenever `server.status` is anything but `ready`, and
 * never alongside the workspace — the workspace is not mounted at all while this is up.
 */
export function ServerGate(): React.ReactElement {
  const { server } = useWorkspace();
  const spring = useSpring();
  const fade = useFade();

  // Pressing Retry puts the provider back into `connecting`, and swapping the card for the bare
  // mark would read as the screen having given up rather than as the button having worked. So the
  // card stays and the button spins, until the probe settles into something else.
  const [retrying, setRetrying] = React.useState(false);
  React.useEffect(() => {
    if (server.status !== "connecting") setRetrying(false);
  }, [server.status]);

  const showCard = server.status === "unreachable" || (retrying && server.status === "connecting");

  if (!showCard) {
    return (
      <Centered>
        <motion.div
          animate={{ opacity: 1 }}
          className="flex flex-col items-center gap-4"
          // Held back briefly: a server on loopback usually answers inside a frame or two, and a
          // spinner that appears only to vanish is worse than no spinner at all.
          initial={{ opacity: 0 }}
          transition={{ ...fade, delay: 0.25 }}
        >
          <PerchLogo />
          <Spinner className="size-4" />
        </motion.div>
      </Centered>
    );
  }

  return (
    <Centered>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className="flex w-full max-w-md flex-col gap-4 rounded-lg border border-border bg-card p-6"
        initial={{ opacity: 0, y: 6 }}
        role="alert"
        transition={spring}
      >
        <PerchBadge />
        <Unreachable
          onRetry={() => {
            setRetrying(true);
            server.retry();
          }}
          retrying={retrying}
          url={server.url}
        />
      </motion.div>
    </Centered>
  );
}

function Unreachable({
  url,
  retrying,
  onRetry,
}: {
  url: string;
  retrying: boolean;
  onRetry: () => void;
}): React.ReactElement {
  return (
    <>
      <header className="flex flex-col gap-1">
        <h1 className="font-medium text-base">
          Can&rsquo;t reach the server at <span className="break-all font-mono text-sm">{url}</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Start it from a terminal: <Code>perch</Code>
        </p>
      </header>
      {/* The provider is probing the whole time this is up, so the button is a courtesy for
          someone who has just started the server and does not want to wait out the backoff. */}
      <div className="flex justify-end">
        <Button loading={retrying} onClick={onRetry} size="sm" variant="outline">
          Retry
        </Button>
      </div>
    </>
  );
}
