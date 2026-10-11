// Dev-only test page (not in the build inputs): every shared scene, the bird guiding between them,
// and the release components, so a change to any of them can be checked in one place.
import { StrictMode, useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { BirdProvider, useBird, useBirdGuide } from "../src/shared/bird";
import { Reveal } from "../src/shared/motion";
import { DownloadButton, InstallCommand, PlatformList, useRelease } from "../src/shared/release";
import {
  CompletionScene,
  HeroScene,
  NotebookScene,
  RelationsScene,
  type SceneAnchors,
  type SceneProps,
  TerminalScene,
  WalkScene,
} from "../src/shared/scenes";
import "../src/shared/styles/base.css";

const SCENES: [string, React.FC<SceneProps>][] = [
  ["hero", HeroScene],
  ["completion", CompletionScene],
  ["walk", WalkScene],
  ["relations", RelationsScene],
  ["notebook", NotebookScene],
  ["terminal", TerminalScene],
];

declare global {
  interface Window {
    __lab?: { ready: string[]; done: string[]; bird: string | null };
  }
}
window.__lab = { ready: [], done: [], bird: null };

function Section({ name, Scene, onAnchors }: { name: string; Scene: React.FC<SceneProps>; onAnchors: (name: string, a: SceneAnchors) => void }) {
  const [status, setStatus] = useState("loading");
  return (
    <section className="flex flex-col gap-3" data-scene-name={name}>
      <p className="font-mono text-xs text-muted-foreground">
        {name} · {status}
      </p>
      <Scene
        onReady={(anchors) => {
          setStatus(`ready (${Object.keys(anchors).join(", ")})`);
          window.__lab?.ready.push(name);
          onAnchors(name, anchors);
        }}
        onDone={() => {
          setStatus((s) => (s.includes("done") ? s : `${s} · done`));
          window.__lab?.done.push(name);
        }}
      />
    </section>
  );
}

function Lab() {
  const bird = useBird();
  const release = useRelease();
  const anchors = useRef<Record<string, SceneAnchors>>({});
  const [, rerender] = useState(0);
  const onAnchors = useCallback((name: string, a: SceneAnchors) => {
    anchors.current[name] = a;
    rerender((n) => n + 1);
  }, []);
  const download = useRef<HTMLDivElement>(null);
  if (window.__lab) window.__lab.bird = bird ? bird.renderer : null;

  useBirdGuide([
    ...SCENES.map(([name]) => ({ ref: () => anchors.current[name]?.titlebar ?? null, at: 0.8 })),
    { ref: download, at: 0.5 },
  ]);

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-24 px-4 py-16 sm:px-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Site lab</h1>
        <p className="font-mono text-xs text-muted-foreground">
          bird: {bird ? bird.renderer : "not yet"} · release: {release.status} {release.version ?? ""} · os: {release.os}
          {release.arch ? `/${release.arch}` : ""}
        </p>
      </header>
      {SCENES.map(([name, Scene]) => (
        <Section key={name} name={name} Scene={Scene} onAnchors={onAnchors} />
      ))}
      <Reveal className="flex flex-col gap-4">
        <div ref={download} className="flex flex-wrap items-center gap-3">
          <DownloadButton />
        </div>
        <InstallCommand onCopy={() => bird?.flutter()} />
        <PlatformList />
      </Reveal>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BirdProvider>
      <Lab />
    </BirdProvider>
  </StrictMode>,
);
