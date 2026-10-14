import { IN_OUT, track } from "../../materials";

const PERIOD = 8000;

// The cells run one after another, each printing its slip out from under the strip; the slips come
// out straight and settle into their lean. Near the end they all slide back under together.
const RUN_AT = 600;
const RUN_GAP = 1500;
const PRINT_MS = 650;
const SETTLE_MS = 350;
const SHOW_MS = 180;
const TUCK_AT = 6600;
const TUCK_MS = 600;

function printing(slip: HTMLElement, index: number): Animation[] {
  const at = RUN_AT + index * RUN_GAP;
  // Straight while it feeds out: undo the lean the still frame gives it, then let it settle into it.
  const lean = Number.parseFloat(getComputedStyle(slip).rotate) || 0;
  const under: Keyframe = { transform: `translateX(-100%) rotate(${-lean}deg)` };
  const out: Keyframe = { transform: `translateX(0) rotate(${-lean}deg)` };
  const settled: Keyframe = { transform: "translateX(0) rotate(0deg)" };
  return [
    track(slip, PERIOD, [
      [at, under],
      [at + PRINT_MS, out],
      [at + PRINT_MS + SETTLE_MS, settled],
      [TUCK_AT, { ...settled, easing: IN_OUT }],
      [TUCK_AT + TUCK_MS, under],
    ]),
    track(slip, PERIOD, [
      [at, { opacity: 0 }],
      [at + SHOW_MS, { opacity: 1 }],
      [TUCK_AT + TUCK_MS - SHOW_MS, { opacity: 1 }],
      [TUCK_AT + TUCK_MS, { opacity: 0 }],
    ]),
  ];
}

/** The piece's loop: each cell prints its result in turn, and the slips go back under at the end. */
export function notebookLoop(root: HTMLElement): Animation[] {
  return [...root.querySelectorAll<HTMLElement>("[data-result]")].flatMap((slip, index) => printing(slip, index));
}
