// Dev-only test page (not in the build inputs) for one scene at a time, at a given width.
// Query parameters:
//   scene=hero|completion|notebook|relations|walk|terminal|all   which scene(s) (default all)
//   width=<px>                           the column the scenes fill (default the page's width)
//   theme=dark                           the page in dark mode; the scenes are dark either way
//   autoplay=false                       the scenes' autoplay prop (shows the last frame)
//   spacer=<n>                           n screens of page above and below each scene, for scroll tests
// Everything a test script needs is on window.__real.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { RealCompletionScene } from "../src/shared/scenes/real/completion";
import { RealHeroScene } from "../src/shared/scenes/real/hero";
import { RelationsScene, TerminalScene, WalkScene } from "../src/shared/scenes";
import { RealNotebookScene } from "../src/shared/scenes/real/notebook";
import type { SceneAnchors, SceneProps } from "../src/shared/scenes/types";
import "../src/shared/styles/base.css";

type LabState = {
  ready: Record<string, number>;
  done: Record<string, number>;
  anchors: Record<string, SceneAnchors>;
};

declare global {
  interface Window {
    __real?: LabState;
  }
}

const lab: LabState = { ready: {}, done: {}, anchors: {} };
window.__real = lab;

const params = new URLSearchParams(location.search);
const which = params.get("scene") ?? "all";
const width = params.get("width");
const spacer = Number(params.get("spacer") ?? 0);
const autoplay = params.get("autoplay") !== "false";
if (params.get("theme") === "dark") document.documentElement.classList.add("dark");

const SCENES: [string, React.FC<SceneProps>][] = [
  ["hero", RealHeroScene],
  ["completion", RealCompletionScene],
  ["notebook", RealNotebookScene],
  ["relations", RelationsScene],
  ["walk", WalkScene],
  ["terminal", TerminalScene],
];

function Section({ name, Scene }: { name: string; Scene: React.FC<SceneProps> }) {
  const [status, setStatus] = useState("loading");
  return (
    <section className="flex flex-col gap-3" data-lab-scene={name}>
      <p className="font-mono text-muted-foreground text-xs">
        {name} · {status}
      </p>
      <Scene
        autoplay={autoplay}
        onDone={() => {
          lab.done[name] = (lab.done[name] ?? 0) + 1;
          setStatus(`done ×${lab.done[name]}`);
        }}
        onReady={(anchors) => {
          lab.ready[name] = performance.now();
          lab.anchors[name] = anchors;
          setStatus("ready");
        }}
      />
    </section>
  );
}

function Lab() {
  const shown = SCENES.filter(([name]) => which === "all" || which === name);
  return (
    <main className="mx-auto flex flex-col gap-16 px-4 py-10" data-lab-width={width ?? ""} ref={(el) => {
      if (el && width) el.style.maxWidth = `${width}px`;
    }}>
      {shown.map(([name, Scene]) => (
        <div className="flex flex-col gap-16" key={name}>
          {Array.from({ length: spacer }, (_, i) => <div className="h-svh" key={i} />)}
          <Section name={name} Scene={Scene} />
          {Array.from({ length: spacer }, (_, i) => <div className="h-svh" key={i} />)}
        </div>
      ))}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Lab />
  </StrictMode>,
);
