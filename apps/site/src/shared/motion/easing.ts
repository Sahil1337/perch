/** The curve every entrance uses: fast out of the gate, a long quiet settle, no overshoot. */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
/** For things that move from one place to another, both ends eased. */
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;
