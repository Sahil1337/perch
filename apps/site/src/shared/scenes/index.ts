// The scenes every prototype imports. Each name points at the legacy custom element until its
// real @perch/ui version is verified, then at that one; the props never change, so a swap here is
// the only edit it takes.
//
// Every scene is animation only: it plays while in view, takes no pointer or key and has no tab
// stop. The one exception is a scene given `usable` (the hero passes it), which plays its demo once
// and then hands the real app to the visitor. Only the real workspace scenes (hero, completion,
// notebook) can be usable; the others ignore the prop.
import type { FC } from "react";
import { LegacyTerminalScene, LegacyWalkScene } from "./legacy/scenes";
import { RealCompletionScene, RealHeroScene, RealNotebookScene } from "./real/workspace";
import { RelationsScene as RealRelationsScene } from "./real/relations";
import type { SceneProps } from "./types";

export type { SceneAnchors, SceneProps } from "./types";

/** The workspace: a query typed with completion, run, results. */
export const HeroScene: FC<SceneProps> = RealHeroScene;
/** JOINs written with foreign-key completion, ON offered from the FK. */
export const CompletionScene: FC<SceneProps> = RealCompletionScene;
/** Query Walk, with its clause rail. */
// The real walk (./real/walk) works, but @perch/ui folds the rows WHERE drops by animating their
// height, which scores about 0.11 layout shift at desktop width. Legacy until that fold is a transform.
export const WalkScene: FC<SceneProps> = LegacyWalkScene;
/** The Relationship View, touring the tables a sighting touches. */
export const RelationsScene: FC<SceneProps> = RealRelationsScene;
/** A .sql notebook of `-- %%` cells, run one after another. */
export const NotebookScene: FC<SceneProps> = RealNotebookScene;
/** curl | sh, then `perch`, then the browser it opens. */
export const TerminalScene: FC<SceneProps> = LegacyTerminalScene;
