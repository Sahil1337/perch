import {
  type BufferGeometry,
  type CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
} from "three";
import { KEYS, type KeyId } from "../keymap";
import type { SculptureColors } from "./colors";
import type { Key } from "./key-motion";
import { keycap } from "./keycap";
import { contactTexture, legendTexture } from "./textures";
import { CENTRE } from "./view";

// The key light, from the upper left, relative to the sculpture's centre.
const LIGHT_OFFSET = new Vector3(-5, 8, 4.5);
// The keys' soft contact shadows: how far past the key they spread, and how dark they are.
const CONTACT = { spread: 1.3, opacity: 0.7 };
// The bird's shadow on the key it stands on.
const PERCH_SHADOW_OPACITY = 0.34;

/** The sculpture's scene, and what to free when it goes. */
export type SculptureParts = {
  scene: Scene;
  keys: Map<KeyId, Key>;
  /** The bird's shadow, moved onto whichever key it stands on. */
  perchShadow: Mesh;
  dispose: () => void;
};

/** The nine keycaps on a floor that only takes shadows, under one warm key light and a soft sky. */
export function buildSculpture(colors: SculptureColors): SculptureParts {
  const geometries: BufferGeometry[] = [];
  const materials: Material[] = [];
  const textures: CanvasTexture[] = [];
  const mesh = (geometry: BufferGeometry, material: Material | Material[]) => {
    geometries.push(geometry);
    for (const m of [material].flat()) if (!materials.includes(m)) materials.push(m);
    return new Mesh(geometry, material);
  };

  const scene = new Scene();
  const group = new Group();
  const hemi = new HemisphereLight(new Color(colors.sky), new Color(colors.ground), 1.15);
  const light = new DirectionalLight(new Color(colors.light), 3.4);
  light.castShadow = true;
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -0.0004;
  light.shadow.normalBias = 0.02;
  light.shadow.radius = 14;
  light.shadow.blurSamples = 20;
  Object.assign(light.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
  light.target.position.copy(CENTRE);
  light.position.copy(CENTRE).add(LIGHT_OFFSET);
  scene.add(hemi, light, light.target, group);

  const floor = mesh(new PlaneGeometry(40, 40), new ShadowMaterial({ color: new Color(colors.shadow), opacity: 0.42 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  // Depth only: a key folded below the floor disappears into it instead of showing through.
  const mask = mesh(new PlaneGeometry(40, 40), new MeshBasicMaterial({ colorWrite: false }));
  mask.rotation.x = -Math.PI / 2;
  mask.position.y = -0.001;
  mask.renderOrder = -1;
  group.add(floor, mask);

  const contact = contactTexture();
  textures.push(contact);
  const porcelain = new MeshStandardMaterial({
    color: new Color(colors.porcelain),
    roughness: 0.78,
    metalness: 0,
    flatShading: true,
    side: DoubleSide,
  });
  const rows = [...new Set(KEYS.map((spec) => spec.z))].sort((a, b) => b - a);
  const keys = new Map<KeyId, Key>();
  for (const spec of KEYS) {
    const { geometry, face } = keycap(spec.w, spec.d, spec.h);
    const legend = legendTexture(spec.id, face, colors);
    textures.push(legend);
    const top = new MeshStandardMaterial({
      color: 0xffffff,
      map: legend,
      roughness: 0.74,
      metalness: 0,
      flatShading: true,
      side: DoubleSide,
    });
    const cap = mesh(geometry, [porcelain, top]);
    cap.castShadow = true;
    const body = new Group();
    body.add(cap);
    body.position.set(0, 0, -spec.d / 2);
    const pivot = new Group();
    pivot.position.set(spec.x, 0, spec.z + spec.d / 2);
    pivot.add(body);
    const shade = new MeshBasicMaterial({
      color: new Color(colors.shadow),
      alphaMap: contact,
      transparent: true,
      opacity: CONTACT.opacity,
      depthWrite: false,
    });
    const blob = mesh(new PlaneGeometry(spec.w * CONTACT.spread, spec.d * CONTACT.spread), shade);
    blob.rotation.x = -Math.PI / 2;
    blob.position.set(spec.x + 0.05, 0.002, spec.z + 0.08);
    group.add(pivot, blob);
    keys.set(spec.id, {
      spec,
      row: rows.indexOf(spec.z),
      pivot,
      body,
      legend,
      contact: shade,
      top: spec.h - 0.025,
      y: 0,
      v: 0,
      travel: spec.id === "return" ? 0.24 : 0.17,
      occupied: false,
      kicks: [],
    });
  }

  const perchShadow = mesh(
    new PlaneGeometry(1, 1),
    new MeshBasicMaterial({
      color: new Color(colors.shadow),
      alphaMap: contact,
      transparent: true,
      opacity: PERCH_SHADOW_OPACITY,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    }),
  );
  perchShadow.rotation.x = -Math.PI / 2;
  perchShadow.visible = false;

  return {
    scene,
    keys,
    perchShadow,
    dispose: () => {
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
      for (const t of textures) t.dispose();
    },
  };
}
