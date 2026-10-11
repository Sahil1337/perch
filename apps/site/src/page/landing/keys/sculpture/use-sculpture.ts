import { type RefObject, useLayoutEffect, useState } from "react";
import { birdLength } from "../../../bird/size";
import type { CopyParts } from "../../types";
import { KEYS } from "../keymap";
import { arrange, type SceneLayout } from "../layout";
import type { Rig } from "../rig";
import { readSculptureColors } from "./colors";
import { Sculpture } from "./sculpture";
import { ASPECT } from "./view";

// An anchor is w-6; its middle sits on the key.
const ANCHOR_HALF = 12;

/**
 * Lays the scene out for the landing's size and draws the sculpture into it, before the first paint
 * and again whenever the landing or its copy changes size. Returns the layout, null until the first.
 */
export function useSculpture(rig: Rig, stage: RefObject<HTMLElement | null>, copy: CopyParts): SceneLayout | null {
  const [layout, setLayout] = useState<SceneLayout | null>(null);

  useLayoutEffect(() => {
    const section = stage.current;
    const host = rig.host.current;
    if (!section || !host) return;
    let sculpture: Sculpture | null = null;
    try {
      sculpture = new Sculpture(host, readSculptureColors(section), birdLength());
    } catch (error) {
      console.warn("The key sculpture could not start; the page goes on without it.", error);
    }
    rig.sculpture.current = sculpture;
    const at = { x: 0, y: 0 };
    const follow = () => {
      for (const { id } of KEYS) {
        const anchor = rig.anchors.current[id];
        if (!anchor || !sculpture) continue;
        sculpture.anchor(id, at);
        anchor.style.translate = `${at.x - ANCHOR_HALF}px ${at.y}px`;
      }
    };
    if (sculpture) sculpture.onFrame = follow;

    const fit = () => {
      const column = rig.column.current;
      const query = rig.query.current;
      const text = copy.root.current;
      if (!column || !query || !text) return;
      const box = section.getBoundingClientRect();
      const across = column.getBoundingClientRect();
      const next = arrange({
        stage: { w: box.width, h: box.height },
        column: { x: across.left - box.left, w: across.width },
        copyBottom: text.getBoundingClientRect().bottom - box.top,
        query: { w: query.offsetWidth, h: query.offsetHeight },
        aspect: ASPECT,
        bird: birdLength(),
      });
      rig.layout.current = next;
      query.style.translate = `${next.query.x}px ${next.query.y}px`;
      sculpture?.resize(box.width, box.height, next.keys);
      sculpture?.renderNow();
      setLayout(next);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(section);
    // the copy reflows when its font arrives, which moves everything under it
    if (copy.root.current) observer.observe(copy.root.current);
    return () => {
      observer.disconnect();
      sculpture?.dispose();
      rig.sculpture.current = null;
      rig.layout.current = null;
    };
  }, [rig, stage, copy]);

  return layout;
}
