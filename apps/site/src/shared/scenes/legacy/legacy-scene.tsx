import { type ReactNode, useEffect, useLayoutEffect, useRef } from "react";
import { cn } from "../../cn";
import type { SceneAnchors, SceneProps } from "../types";
import "./legacy.css";

type LegacyElement = HTMLElement & {
  ready?: Promise<void>;
  anchors?: Record<string, unknown>;
};

export type LegacySceneDef = {
  /** The module under public/legacy/js/ that defines the element. */
  module: "workspace" | "relations" | "walk" | "terminal";
  tag: "perch-workspace" | "perch-relations" | "perch-walk" | "perch-terminal";
  attributes?: Record<string, string>;
  /** Holds the element's final height from first paint, so nothing moves when it mounts. */
  reserve: ReactNode;
};

const modules = new Map<string, Promise<void>>();

// The legacy modules are served as-is from public/ and resolve their markup, data and fonts against
// their own URL, so they load as plain module scripts: neither bundled nor seen by Vite's import
// analysis, which refuses an import() of anything under public/.
function load(module: LegacySceneDef["module"]): Promise<void> {
  let loading = modules.get(module);
  if (!loading) {
    loading = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.type = "module";
      script.src = `${import.meta.env.BASE_URL}legacy/js/${module}.js`;
      script.onload = () => resolve();
      script.onerror = () => {
        modules.delete(module);
        script.remove();
        reject(new Error(`could not load ${script.src}`));
      };
      document.head.append(script);
    });
    modules.set(module, loading);
  }
  return loading;
}

function anchorsOf(el: LegacyElement): SceneAnchors | null {
  const raw = el.anchors ?? {};
  const anchors: Record<string, HTMLElement | Record<string, HTMLElement>> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (value instanceof HTMLElement) anchors[name] = value;
    else if (value && typeof value === "object") {
      const group: Record<string, HTMLElement> = {};
      for (const [key, inner] of Object.entries(value)) if (inner instanceof HTMLElement) group[key] = inner;
      anchors[name] = group;
    }
  }
  if (!(anchors.window instanceof HTMLElement) || !(anchors.titlebar instanceof HTMLElement)) return null;
  return anchors as SceneAnchors;
}

export function LegacyScene({ def, className, autoplay = true, paused = false, onReady, onDone }: SceneProps & { def: LegacySceneDef }) {
  const host = useRef<HTMLDivElement>(null);
  const element = useRef<LegacyElement | null>(null);
  const callbacks = useRef({ onReady, onDone, autoplay });
  useLayoutEffect(() => {
    callbacks.current = { onReady, onDone, autoplay };
  });
  const { module, tag, attributes } = def;
  const attributeKey = JSON.stringify(attributes ?? {});

  useEffect(() => {
    const parent = host.current;
    if (!parent) return;
    let live = true;
    // Made here rather than rendered: the workspace reads its scene once, on first connection, so
    // every attribute has to be in place before the element is attached.
    const el = document.createElement(tag) as LegacyElement;
    for (const [name, value] of Object.entries(JSON.parse(attributeKey) as Record<string, string>)) {
      el.setAttribute(name, value);
    }
    if (!callbacks.current.autoplay) el.setAttribute("autoplay", "false");
    el.classList.add("block", "w-full");
    element.current = el;
    const done = () => callbacks.current.onDone?.();
    el.addEventListener("scene:done", done);
    parent.append(el);
    load(module)
      .then(() => customElements.whenDefined(tag))
      .then(() => el.ready)
      .then(() => {
        if (!live) return;
        const anchors = anchorsOf(el);
        if (anchors) callbacks.current.onReady?.(anchors);
      })
      .catch((error: unknown) => console.warn(`<${tag}> did not load:`, error));
    return () => {
      live = false;
      el.removeEventListener("scene:done", done);
      el.remove();
      element.current = null;
    };
  }, [module, tag, attributeKey]);

  useEffect(() => {
    const el = element.current;
    if (!el) return;
    if (autoplay) el.removeAttribute("autoplay");
    else el.setAttribute("autoplay", "false");
  }, [autoplay, module, tag, attributeKey]);

  useEffect(() => {
    element.current?.toggleAttribute("paused", paused);
  }, [paused, module, tag, attributeKey]);

  // Animation only: the pointer passes through to the page, as it does over the real scenes.
  return (
    <div className={cn("dark @container pointer-events-none grid w-full min-w-0 grid-cols-1 select-none", className)}>
      <div aria-hidden className="pointer-events-none invisible col-start-1 row-start-1">
        {def.reserve}
      </div>
      <div ref={host} className="col-start-1 row-start-1 min-w-0" />
    </div>
  );
}
