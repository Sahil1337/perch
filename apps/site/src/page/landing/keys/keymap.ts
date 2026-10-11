export type KeyId = "j" | "o" | "i" | "n" | "tab" | "s" | "p" | "space" | "return";

/** One keycap, in key units: x right, z toward the viewer, the footprint's centre. */
export type KeySpec = { id: KeyId; x: number; z: number; w: number; d: number; h: number };

const H = 0.44;

/**
 * Three staggered rows that read as a keyboard without being one: the back row spells JOIN, the
 * middle row holds tab and the prefix the bird types, and return is the giant key at the end of
 * both rows, the one worth a running jump.
 */
export const KEYS: KeySpec[] = [
  { id: "j", x: -1.5, z: -1, w: 1, d: 1, h: H },
  { id: "o", x: -0.5, z: -1, w: 1, d: 1, h: H },
  { id: "i", x: 0.5, z: -1, w: 1, d: 1, h: H },
  { id: "n", x: 1.5, z: -1, w: 1, d: 1, h: H },
  { id: "tab", x: -1.25, z: 0, w: 1.5, d: 1, h: H },
  { id: "s", x: 0, z: 0, w: 1, d: 1, h: H },
  { id: "p", x: 1, z: 0, w: 1, d: 1, h: H },
  { id: "return", x: 2.85, z: -0.5, w: 1.7, d: 2, h: H * 1.2 },
  { id: "space", x: 0.5, z: 1, w: 4, d: 1, h: H },
];

/** Legends as printed: letters centred, the two wide keys named small in a corner. */
export const LEGEND: Record<KeyId, string> = {
  j: "J",
  o: "O",
  i: "I",
  n: "N",
  tab: "tab",
  s: "S",
  p: "P",
  space: "",
  return: "return",
};

/** What a visitor's KeyboardEvent.key means on the sculpture, if anything. */
export function keyFromEvent(key: string): KeyId | null {
  switch (key) {
    case "Tab":
      return "tab";
    case " ":
      return "space";
    case "Enter":
      return "return";
  }
  const lower = key.length === 1 ? key.toLowerCase() : "";
  return lower === "j" || lower === "o" || lower === "i" || lower === "n" || lower === "s" || lower === "p"
    ? lower
    : null;
}

/** Keys the bird may wander to from where it stands while idle. */
export function neighbours(from: KeyId): KeyId[] {
  const at = KEYS.find((k) => k.id === from);
  if (!at) return [];
  return KEYS
    .filter((k) => k.id !== from)
    .filter((k) => Math.abs(k.x - at.x) <= (k.w + at.w) / 2 + 0.6 && Math.abs(k.z - at.z) <= (k.d + at.d) / 2 + 0.2)
    .map((k) => k.id);
}
