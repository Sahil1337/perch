// The two things every part of the walk may need and none of them can change: the program, and the
// way to ask the database something.
//
// A context for the reason `walk-motion.ts` gives for its own: `probe` was drilled through five
// levels — the dialog, the player, a bound section, a bound walk, its hooks — for a value that is
// fixed for as long as the dialog is open, and `program` through three. Neither is a decision any
// component in between was making, and both were in the signature of every one of them.

import * as React from "react";
import type { Program } from "./program";
import type { Probe } from "./use-walk";

type Walk = {
  readonly program: Program;
  readonly probe: Probe;
};

const WalkContext = React.createContext<Walk | null>(null);

export function WalkProvider({
  children,
  program,
  probe,
}: {
  readonly children: React.ReactNode;
  readonly program: Program;
  readonly probe: Probe;
}): React.ReactElement {
  const value = React.useMemo(() => ({ program, probe }), [program, probe]);
  return <WalkContext.Provider value={value}>{children}</WalkContext.Provider>;
}

/** Throws outside the walk, which is a bug rather than a state to render: every reader of this is
 *  inside the dialog by construction. */
export function useWalk(): Walk {
  const value = React.useContext(WalkContext);
  if (value === null) throw new Error("useWalk must be called inside <WalkProvider>");
  return value;
}
