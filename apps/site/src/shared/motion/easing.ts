/** The curve every entrance uses: fast out of the gate, a long quiet settle, no overshoot. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** For things that move from one place to another, both ends eased. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

const css = (points: readonly number[]): string => `cubic-bezier(${points.join(", ")})`;
/** The same curves for CSS and the Web Animations API. */
export const EASE_OUT_CSS = css(EASE_OUT);
export const EASE_IN_OUT_CSS = css(EASE_IN_OUT);
