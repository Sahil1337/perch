import { type Mesh, NoToneMapping, PerspectiveCamera, type Scene, SRGBColorSpace, Vector3, VSMShadowMap, WebGLRenderer } from "three";
import { clamp, type Point } from "../../../../shared/math";
import type { KeyId } from "../keymap";
import { buildSculpture, type SculptureParts } from "./build-sculpture";
import type { SculptureColors } from "./colors";
import { type Key, poseKeys, stepKeys } from "./key-motion";
import { redrawLegend } from "./textures";
import { type Box, fitView, SPAN } from "./view";

// The bird's shadow on the key it stands on, as a share of the bird's length.
const PERCH_SHADOW = { length: 0.5, depth: 0.26 };
// Frames longer than this (a stall, a hidden tab) are taken as this long.
const MAX_FRAME = 0.05;

/**
 * The nine keys as one porcelain sculpture, on a canvas of its own inside `host`. It draws only
 * while a key moves, and `dispose` frees everything, the GL context included.
 */
export class Sculpture {
  /** After every drawn frame, so anchors on the page can follow the keys. */
  onFrame: (() => void) | null = null;
  private canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private camera = new PerspectiveCamera(30, 1, 0.1, 100);
  private parts: SculptureParts;
  private scene: Scene;
  private keys: Map<KeyId, Key>;
  private all: Key[];
  private perchShadow: Mesh;
  private birdLength: number;
  private scratch = new Vector3();
  private width = 1;
  private height = 1;
  private raf = 0;
  private last = 0;
  private clock = 0;
  private live = true;
  private disposed = false;
  private fold = 0;

  constructor(host: HTMLElement, colors: SculptureColors, birdLength: number) {
    this.birdLength = birdLength;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "block size-full";
    host.append(this.canvas);
    try {
      this.renderer = new WebGLRenderer({ canvas: this.canvas, alpha: true, antialias: true, powerPreference: "low-power" });
    } catch (error) {
      this.canvas.remove();
      throw error;
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.shadowMap.enabled = true;
    // variance shadows blur: one soft shadow per key, the way a diffuse studio light falls
    this.renderer.shadowMap.type = VSMShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    this.parts = buildSculpture(colors);
    this.scene = this.parts.scene;
    this.keys = this.parts.keys;
    this.all = [...this.keys.values()];
    this.perchShadow = this.parts.perchShadow;

    // Legends are drawn in Geist Mono; if it was still loading, draw them again once it is here.
    void document.fonts?.ready.then(() => {
      if (this.disposed) return;
      for (const key of this.all) redrawLegend(key.legend, key.spec.id, colors);
      this.invalidate();
    });
  }

  /** Sizes the canvas to `width` × `height` and fits the sculpture into `frame`, which has its aspect. */
  resize(width: number, height: number, frame: Box) {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.renderer.setSize(this.width, this.height, false);
    const bounds = fitView(this.camera, frame, this.width, this.height);
    const unit = bounds.w / SPAN;
    this.perchShadow.scale.set(
      (this.birdLength * PERCH_SHADOW.length) / unit,
      (this.birdLength * PERCH_SHADOW.depth) / unit,
      1,
    );
    this.invalidate();
  }

  /** Where the bird's feet go on a key: the middle of its top, in canvas CSS px. */
  anchor(id: KeyId, out: Point = { x: 0, y: 0 }): Point {
    const key = this.keys.get(id);
    if (!key) return out;
    const v = this.scratch.set(0, key.top, 0).applyMatrix4(key.body.matrixWorld).project(this.camera);
    out.x = ((v.x + 1) / 2) * this.width;
    out.y = ((1 - v.y) / 2) * this.height;
    return out;
  }

  /** Strike a key. `force` 1 is a hop landing; more drives it to the bottom and holds it longer. */
  press(id: KeyId, force = 1) {
    const key = this.keys.get(id);
    if (!key) return;
    key.v = Math.min(key.v, -3.6 * force);
    this.invalidate();
  }

  /** A shock running out through the sculpture from one key, nearest first. */
  ripple(from: KeyId, strength = 1) {
    const origin = this.keys.get(from);
    if (!origin) return;
    for (const key of this.all) {
      if (key === origin) continue;
      const d = Math.hypot(key.spec.x - origin.spec.x, key.spec.z - origin.spec.z);
      key.kicks.push({ at: this.clock + 0.03 + d * 0.045, v: -(1.6 * strength) / (1 + d * 0.35) });
    }
    this.invalidate();
  }

  /** The key the bird stands on, if any: it holds a little lower, with the bird's shadow on it. */
  setOccupied(id: KeyId | null) {
    for (const key of this.all) key.occupied = key.spec.id === id;
    const key = id ? this.keys.get(id) : undefined;
    if (key) {
      key.body.add(this.perchShadow);
      // a hair above the dish, and off to the side away from the light
      this.perchShadow.position.set(0.04, key.spec.h - 0.012, -0.06);
    }
    this.perchShadow.visible = key !== undefined;
    this.invalidate();
  }

  /** 0 standing, 1 gone: the keys tip and sink into their shadows, front row first. */
  setFold(p: number) {
    const next = clamp(p, 0, 1);
    if (next === this.fold) return;
    this.fold = next;
    this.invalidate();
  }

  /** The canvas's opacity, for the hand-over. */
  setOpacity(opacity: number) {
    this.canvas.style.opacity = String(opacity);
  }

  setLive(live: boolean) {
    this.live = live;
    if (live) this.invalidate();
    else if (this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  /** Draw now, without waiting for a frame: the first paint already has the sculpture in it. */
  renderNow() {
    poseKeys(this.all, this.fold);
    this.scene.updateMatrixWorld();
    this.renderer.render(this.scene, this.camera);
    this.onFrame?.();
  }

  /** Stops drawing and frees everything, the GL context included, and takes the canvas away. */
  dispose() {
    this.disposed = true;
    this.setLive(false);
    this.parts.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  private invalidate() {
    if (!this.raf && this.live && !this.disposed) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  private frame = (now: number) => {
    this.raf = 0;
    const dt = this.last ? Math.min(MAX_FRAME, (now - this.last) / 1000) : 1 / 60;
    this.last = now;
    this.clock += dt;
    const moving = stepKeys(this.all, this.clock, dt);
    this.renderNow();
    if (moving && this.live) this.raf = requestAnimationFrame(this.frame);
  };
}
