import { type Beat, press, track } from "../../materials";
import { PICK } from "./offers";

// Beats are written against the still frame, the moment the condition has been taken: a part with
// no offset is where the markup puts it.

const PERIOD = 8800;
const KEY_PITCH = 240;

const JOIN_AT = 400;
const UNFOLD_AT = JOIN_AT + 4 * KEY_PITCH;
const UNFOLD_MS = 560;
/** The popup opens with its first row selected; the highlight shows as the slip finishes opening. */
const HIGHLIGHT_AT = UNFOLD_AT + UNFOLD_MS - 160;
const HIGHLIGHT_MS = 240;
// The scene's own pace on this popup: a second to read the ranking, then a step every 420ms.
const READ_MS = 1000;
const STEP_PITCH = 420;
const STEP_MS = 260;
const PICK_AT = HIGHLIGHT_AT + READ_MS + PICK * STEP_PITCH;
const ON_AT = PICK_AT + 800;
const PRINT_AT = ON_AT + 2 * KEY_PITCH + 160;
const PRINT_MS = 700;
const ACCEPT_AT = PRINT_AT + PRINT_MS + 600;
/** The slips are put away the way they came: the condition back under the keys, then the tables folded up. */
const CLEAR_AT = PERIOD - 1300;
const CLEAR_MS = 480;
const CLEAR_PITCH = 160;

// The fold sits at the slip's top edge; a little perspective keeps it reading as paper turning down.
const FOLDED: Keyframe = { opacity: 0, transform: "perspective(480px) rotateX(-84deg)" };
const UNFOLDED: Keyframe = { opacity: 1, transform: "perspective(480px) rotateX(0deg)" };

const UNPRINTED: Keyframe = { opacity: 0, transform: "translateY(-10px)" };
const PRINTED: Keyframe = { opacity: 1, transform: "translateY(0)" };

function slipBeats(at: number, ms: number, clearAt: number, hidden: Keyframe, shown: Keyframe): Beat[] {
  return [
    [at, hidden],
    [at + ms, shown],
    [clearAt, shown],
    [clearAt + CLEAR_MS, hidden],
  ];
}

/** The highlight opens on the first row and steps down a row at a time to the pick. */
function highlightBeats(): Beat[] {
  const row = (r: number, opacity: number): Keyframe => ({
    opacity,
    transform: `translateY(${(r - PICK) * 100}%)`,
  });
  const beats: Beat[] = [
    [HIGHLIGHT_AT, row(0, 0)],
    [HIGHLIGHT_AT + HIGHLIGHT_MS, row(0, 1)],
  ];
  for (let r = 1; r <= PICK; r++) {
    const at = HIGHLIGHT_AT + READ_MS + (r - 1) * STEP_PITCH;
    beats.push([at, row(r - 1, 1)], [at + STEP_MS, row(r, 1)]);
  }
  return beats;
}

function key(root: HTMLElement, name: string, times: number[]): Animation[] {
  const el = root.querySelector(`[data-key="${name}"] [data-keycap]`);
  return el ? press(el, PERIOD, times) : [];
}

function part(root: HTMLElement, name: string, beats: Beat[]): Animation[] {
  const el = root.querySelector(`[data-part="${name}"]`);
  return el ? [track(el, PERIOD, beats)] : [];
}

/** J O I N, the tables offered, the pick taken with ⏎; then O N, and the condition offered and taken. */
export function completionLoop(root: HTMLElement): Animation[] {
  return [
    ...key(root, "J", [JOIN_AT]),
    ...key(root, "O", [JOIN_AT + KEY_PITCH, ON_AT]),
    ...key(root, "I", [JOIN_AT + 2 * KEY_PITCH]),
    ...key(root, "N", [JOIN_AT + 3 * KEY_PITCH, ON_AT + KEY_PITCH]),
    ...key(root, "return", [PICK_AT, ACCEPT_AT]),
    ...part(root, "tables", slipBeats(UNFOLD_AT, UNFOLD_MS, CLEAR_AT + CLEAR_PITCH, FOLDED, UNFOLDED)),
    ...part(root, "tables-highlight", highlightBeats()),
    ...part(root, "condition", slipBeats(PRINT_AT, PRINT_MS, CLEAR_AT, UNPRINTED, PRINTED)),
  ];
}
