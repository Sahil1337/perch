// Dev-only test page (not in the build inputs) for the real Relationship View and Query Walk
// scenes. Query parameters:
//   scene=relations|walk|both   which scene(s) to show (default both)
//   theme=light                 the page in light mode; the scenes stay dark
//   spacer=<n>                  n screens of page above and below each scene, for scroll tests
//   autoplay=false              the scenes' autoplay prop
//   native=1                    no max width: at a 1312px viewport the windows draw at scale 1
// Everything a test script needs is on window.__rw.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { RelationsScene } from "../src/shared/scenes/real/relations";
import { WalkScene } from "../src/shared/scenes/real/walk";
import type { SceneAnchors, SceneProps } from "../src/shared/scenes/types";
import "../src/shared/styles/base.css";

type LabState = {
  ready: Record<string, number>;
  done: Record<string, number>;
  anchors: Record<string, SceneAnchors>;
};

declare global {
  interface Window {
    __rw?: LabState;
  }
}

const lab: LabState = { ready: {}, done: {}, anchors: {} };
window.__rw = lab;

const params = new URLSearchParams(location.search);
const which = params.get("scene") ?? "both";
const spacer = Number(params.get("spacer") ?? 0);
const autoplay = params.get("autoplay") !== "false";
const native = params.get("native") === "1";
if (params.get("theme") === "light") document.documentElement.classList.remove("dark");

const SCENES: [string, React.FC<SceneProps>][] = [
  ["relations", RelationsScene],
  ["walk", WalkScene],
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
          lab.ready[name] = (lab.ready[name] ?? 0) + 1;
          lab.anchors[name] = anchors;
          setStatus("ready");
        }}
      />
    </section>
  );
}

function Lab() {
  return (
    <main className={native ? "flex flex-col gap-16 px-4 py-10" : "mx-auto flex max-w-6xl flex-col gap-16 px-4 py-10"}>
      <h1 className="font-medium text-lg">Real Relationship View and Query Walk</h1>
      {SCENES.filter(([name]) => which === "both" || which === name).map(([name, Scene]) => (
        <div className="flex flex-col gap-16" key={name}>
          {Array.from({ length: spacer }, (_, i) => <div className="h-screen" data-lab-spacer="" key={i} />)}
          <Section name={name} Scene={Scene} />
          {Array.from({ length: spacer }, (_, i) => <div className="h-screen" data-lab-spacer="" key={i} />)}
        </div>
      ))}
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Lab />
    </StrictMode>,
  );
}
