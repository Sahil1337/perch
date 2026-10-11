import { MotionConfig } from "motion/react";
import { useCallback, useRef, useState } from "react";
import { BirdProvider } from "../shared/bird";
import { BirdDriverProvider } from "./bird/driver";
import type { RouteStep } from "./bird/route";
import { useBirdRoute } from "./bird/use-bird-route";
import { useFlutter } from "./bird/use-flutter";
import { useHop } from "./bird/use-hop";
import { BIRD_SIZE } from "./bird/size";
import { Landing } from "./landing/landing";
import { Nav } from "./chrome/nav";
import { BinarySection } from "./sections/binary";
import { BoxSection } from "./sections/box";
import { DownloadSection } from "./sections/download";
import { CompletionSection, NotebookSection, RelationsSection, WalkSection } from "./sections/features";
import { Footer } from "./sections/footer";
import { TrySection } from "./sections/try";
import { TryWindowProvider, useTryWindow } from "./sections/try/window";
import { Sky } from "./chrome/sky";

// Porcelain, from the app's own inks: the bird is the lightest thing on a dark page.
const BIRD_PALETTE = {
  body: "oklch(from var(--bui-ink) 93.5% c h)",
  wing: "oklch(from var(--bui-ink) 87% c h)",
  beak: "oklch(from var(--bui-ink-2) 76% c h)",
  eye: "var(--bui-tooltip-bg)",
};

function Page() {
  const { target } = useTryWindow();
  const completion = useRef<HTMLDivElement>(null);
  const walk = useRef<HTMLDivElement>(null);
  const relations = useRef<HTMLDivElement>(null);
  const notebook = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const binary = useRef<HTMLDivElement>(null);
  const download = useRef<HTMLDivElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const [settled, setSettled] = useState(false);
  const settle = useCallback(() => setSettled(true), []);

  // One perch per section, in page order: the home of the zone the bird roams while that section is
  // read, once the landing has handed it over at the try window. It ends its route around the
  // install command, coming back to it more often than not; on a phone, where the download section
  // outruns the view, the footer's branch catches it.
  const route: RouteStep[] = [
    { ref: target.perch, at: 0.84 },
    { ref: completion, at: 0.84 },
    { ref: walk, at: 0.16 },
    { ref: relations, at: 0.84 },
    { ref: notebook, at: 0.16 },
    { ref: box, at: 0.84 },
    { ref: binary, at: 0.84 },
    { ref: download, at: 0.9, homing: 0.55 },
    { ref: footer, at: 0.84 },
  ];
  useBirdRoute(route);

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
      {/* Branches run to the viewport's edges; nothing may scroll sideways because of them. */}
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
