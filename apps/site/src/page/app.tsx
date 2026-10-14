import { MotionConfig } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { BirdProvider } from "../shared/bird";
import { BirdRoute } from "./bird/bird-route";
import { BirdDriverProvider } from "./bird/driver";
import type { RouteStep } from "./bird/route";
import { useFlutter } from "./bird/use-flutter";
import { useHop } from "./bird/use-hop";
import { BIRD_SIZE } from "./bird/size";
import { WhyPerch } from "./bird/why-perch/why-perch";
import { Landing } from "./landing/landing";
import { Nav } from "./chrome/nav";
import { BinarySection } from "./sections/binary";
import { BoxSection } from "./sections/box";
import { DownloadSection } from "./sections/download";
import { CompletionSection } from "./sections/completion";
import { Footer } from "./sections/footer";
import { NotebookSection } from "./sections/notebooks";
import { RelationsSection } from "./sections/relations";
import { TrySection } from "./sections/try";
import { TryWindowProvider, useTryWindow } from "./sections/try/window";
import { WalkSection } from "./sections/walk";
import { Sky } from "./chrome/sky";

// The share of the bird's moves in a section that end back on its piece.
const PIECE_HOMING = 0.5;

// Porcelain, from the app's own inks: the bird is the lightest thing on a dark page.
const BIRD_PALETTE = {
  body: "oklch(from var(--bui-ink) 93.5% c h)",
  wing: "oklch(from var(--bui-ink) 87% c h)",
  beak: "oklch(from var(--bui-ink-2) 76% c h)",
  eye: "var(--bui-tooltip-bg)",
};

function Page() {
  const { target } = useTryWindow();
  const completion = useRef<HTMLElement>(null);
  const walk = useRef<HTMLElement>(null);
  const relations = useRef<HTMLElement>(null);
  const notebook = useRef<HTMLElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const binary = useRef<HTMLElement>(null);
  const download = useRef<HTMLElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false);
  const settle = useCallback(() => setSettled(true), []);

  // One perch per section, in page order: the home of the zone the bird roams while that section is
  // read, once the landing has handed it over at the try window. From there its home is each
  // section's piece, as the keys were in the first view, and it comes back to it about every other
  // move; "Also in the box" has no piece, so there it stands on the heading. It ends its route on the
  // return key; on a phone, where the download section outruns the view, the footer's brand catches it.
  const route: RouteStep[] = [
    { ref: target.perch, at: 0.84 },
    { ref: completion, at: 0.5, homing: PIECE_HOMING },
    { ref: walk, at: 0.5, homing: PIECE_HOMING },
    { ref: relations, at: 0.5, homing: PIECE_HOMING },
    { ref: notebook, at: 0.5, homing: PIECE_HOMING },
    { ref: box, at: 0.84 },
    { ref: binary, at: 0.5, homing: PIECE_HOMING },
    { ref: download, at: 0.5, homing: 0.55 },
    { ref: footer, at: 0.5 },
  ];

  const flutter = useFlutter();
  const hopCompletion = useHop(completion);
  const hopWalk = useHop(walk);
  const hopRelations = useHop(relations);
  const hopNotebook = useHop(notebook);
  const hopBinary = useHop(binary);

  return (
    <>
      <Sky />
      <Nav />
      <BirdRoute steps={route} />
      <WhyPerch settled={settled} />
      {/* The landing's slips flutter out past the page's edges; nothing may scroll sideways for them. */}
      <div className="overflow-x-clip">
        <main>
          <Landing onSettled={settle} />
          <TrySection settled={settled} />
          <CompletionSection perchRef={completion} onSceneDone={hopCompletion} />
          <WalkSection perchRef={walk} onSceneDone={hopWalk} />
          <RelationsSection perchRef={relations} onSceneDone={hopRelations} />
          <NotebookSection perchRef={notebook} onSceneDone={hopNotebook} />
          <BoxSection perchRef={box} />
          <BinarySection perchRef={binary} onSceneDone={hopBinary} />
          <DownloadSection perchRef={download} onCopy={flutter} />
        </main>
        <Footer perchRef={footer} />
      </div>
    </>
  );
}

export function App() {
  return (
    <MotionConfig reducedMotion="user">
      <BirdProvider look="porcelain" palette={BIRD_PALETTE} size={BIRD_SIZE}>
        <TryWindowProvider>
          <BirdDriverProvider>
            <Page />
          </BirdDriverProvider>
        </TryWindowProvider>
      </BirdProvider>
    </MotionConfig>
  );
}
